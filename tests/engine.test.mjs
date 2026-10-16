import test from 'node:test';
import assert from 'node:assert/strict';
import {FLEET, HOURS, SHORTAGE} from '../dist/config.mjs';
import {STATES, NUCLEAR, COAL, GAS, capacity, changeCost, startupCost, dispatch, settle, summarize, solve, starterPlan, gasCover, lockedBits, editableFrom, checkSchedule, flipRun, validatePlan} from '../dist/engine.mjs';
import {makeDay} from '../dist/world.mjs';

const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} ≠ ${b}`);
export function validateRow(l) {
  assert.equal(l.outputs.length, FLEET.length);
  l.outputs.forEach((p, i) => { assert.ok(p >= -1e-7 && p <= FLEET[i].capacity + 1e-7); if (!(l.mask & (1 << i))) assert.equal(p, 0); });
  assert.equal(l.mask & (l.actual.outage ?? 0), 0, 'Tripped units never run');
  near(l.served + l.shortage, l.actual.demand, 'Demand balance');
  near(l.windUsed + l.solarUsed + l.conventional, l.served, 'Generation balance');
  near(l.renewable + l.curtailment, l.actual.wind + l.actual.solar, 'Renewable balance');
  near(l.brownout + l.blackout, l.shortage, 'Shortage tiers');
  near(l.penalty, l.brownout * SHORTAGE.brownoutPrice + l.blackout * SHORTAGE.blackoutPrice, 'Penalty');
  near(l.total, l.running + l.startup + l.adjustment + l.penalty, 'Objective');
  near(l.startup, startupCost(l.mask, l.previousMask));
  near(l.running, FLEET.reduce((s, u, i) => s + l.outputs[i] * u.rate + (l.mask & (1 << i) ? u.fixed : 0), 0));
  near(l.emissions, FLEET.reduce((s, u, i) => s + l.outputs[i] * u.co2, 0));
}

test('Dispatch uses renewables, then merit order within capacity', () => {
  const d = dispatch(63, {demand: 800, wind: 70, solar: 30});
  assert.deepEqual(d.outputs, [240, 180, 140, 140, 0, 0]);
  near(d.shortage, 0); near(d.spare, 250);
  assert.deepEqual(dispatch(GAS, {demand: 280, wind: 0, solar: 0}).outputs, [0, 0, 0, 180, 100, 0]);
});

test('Excess renewables are curtailed proportionally; idle online units still pay their online charge', () => {
  const d = dispatch(1, {demand: 100, wind: 200, solar: 300});
  near(d.windUsed, 40); near(d.solarUsed, 60); near(d.curtailment, 400); near(d.running, FLEET[0].fixed); near(d.outputs[0], 0);
});

test('Unserved demand is a cheap brownout up to the band, then an expensive blackout', () => {
  const small = dispatch(0, {demand: 500, wind: 490, solar: 0});
  near(small.shortage, 10); near(small.brownout, 10); near(small.blackout, 0); near(small.penalty, 10 * SHORTAGE.brownoutPrice);
  const big = dispatch(0, {demand: 500, wind: 25, solar: 25}), band = 500 * SHORTAGE.brownoutShare;
  near(big.served, 50); near(big.brownout, band); near(big.blackout, 450 - band);
  near(big.penalty, band * SHORTAGE.brownoutPrice + (450 - band) * SHORTAGE.blackoutPrice); near(big.running, 0);
});

test('Tripped units produce nothing, pay nothing and are not charged for deviating from plan', () => {
  const actual = {demand: 300, wind: 0, solar: 0, outage: 1 << 1};
  const l = settle({hour: 3, mask: 1 | (1 << 1), previousMask: 1 | (1 << 1), planMask: 1 | (1 << 1), actual});
  assert.equal(l.mask, 1); assert.equal(l.requested, 3); near(l.outputs[1], 0); near(l.adjustment, 0); near(l.shortage, 60);
  const back = settle({hour: 4, mask: 3, previousMask: l.mask, planMask: 3, actual: {demand: 300, wind: 0, solar: 0}});
  near(back.startup, FLEET[1].startup, 'Restarting after a trip costs a start-up');
});

test('Start-ups charge off-to-on edges; each hour off-plan costs the change charge', () => {
  const a = {demand: 230, wind: 0, solar: 0};
  near(settle({hour: 0, mask: 1, previousMask: 0, planMask: 1, actual: a}).startup, FLEET[0].startup);
  near(settle({hour: 1, mask: 1, previousMask: 1, planMask: 1, actual: a}).startup, 0);
  near(changeCost(0, 63), FLEET.reduce((s, u) => s + u.change, 0)); near(changeCost(63, 63), 0);
  const l = settle({hour: 2, mask: 1 | (1 << 5), previousMask: 1, planMask: 1, actual: a});
  near(l.adjustment, FLEET[5].change); near(l.startup, FLEET[5].startup);
  near(capacity(63), FLEET.reduce((s, u) => s + u.capacity, 0));
});

test('Notice periods: nuclear is fixed, coal needs 2h (C1) and 1h (C2), gas is instant; campaign rules can lift notice', () => {
  const rules = makeDay('LOCK').rules;
  assert.equal(editableFrom(0, 3, rules), Infinity);
  assert.equal(editableFrom(1, 3, rules), 5); assert.equal(editableFrom(2, 3, rules), 4); assert.equal(editableFrom(3, 3, rules), 3);
  assert.equal(lockedBits(3, 3, rules), NUCLEAR | COAL);
  assert.equal(lockedBits(4, 3, rules), NUCLEAR | (1 << 1));
  assert.equal(lockedBits(5, 3, rules), NUCLEAR);
  assert.equal(lockedBits(3, 3, {...rules, leadTimes: false}), NUCLEAR);
  const current = Array(HOURS).fill(1);
  assert.throws(() => checkSchedule(current.map((m, t) => (t === 4 ? m | 2 : m)), current, 3, rules), /notice/);
  assert.doesNotThrow(() => checkSchedule(current.map((m, t) => (t >= 5 ? m | 2 : m)), current, 3, rules));
  assert.throws(() => checkSchedule(current.map(m => m & ~1), current, 3, rules), /notice/);
  assert.throws(() => checkSchedule(current.map((m, t) => (t === 3 ? m | 2 : m)), current, 3, {...rules, disabled: 2}), /service/);
});

test('flipRun switches a unit until the schedule already had it that way', () => {
  const s = [0, 0, 0, 8, 8, 0, 0, 0, 8, 8, 8, 8];
  assert.deepEqual(flipRun(s, 3, 0, true), [8, 8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8]);
  assert.deepEqual(flipRun(s, 3, 3, false), [0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8]);
  assert.deepEqual(flipRun(s, 3, 5, true), [0, 0, 0, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
});

test('Plans must keep nuclear constant and leave out-of-service units off', () => {
  assert.throws(() => validatePlan([1]), /Invalid plan/);
  assert.throws(() => validatePlan(Array(HOURS).fill(1).map((m, t) => (t === 5 ? 0 : m))), /nuclear/);
  assert.throws(() => validatePlan(Array(HOURS).fill(3), {disabled: 2}), /service/);
  assert.doesNotThrow(() => validatePlan(Array(HOURS).fill(9)));
});

test('The DP solves a genuine scheduling problem with start-up economics and nuclear held constant', () => {
  const hours = Array.from({length: HOURS}, (_, h) => ({hour: h, demand: 500, wind: 0, solar: 0}));
  const {schedule, expectedCost} = solve({paths: [hours]});
  assert.ok(expectedCost > 0);
  assert.ok(schedule.every(m => m >= 0 && m < STATES && (m & NUCLEAR) === (schedule[0] & NUCLEAR)));
  assert.ok(schedule.every(m => dispatch(m, hours[0]).shortage < 1e-9));
  let brute = Infinity;
  for (let m = 0; m < STATES; m++) {
    let prev = 0, cost = 0;
    for (const a of hours) { const r = settle({hour: a.hour, mask: m, previousMask: prev, actual: a}); cost += r.total; prev = r.mask; }
    brute = Math.min(brute, cost);
  }
  assert.ok(expectedCost <= brute + 1e-6, 'DP is at least as good as any constant schedule');
});

test('Recourse valuation never values a schedule above its unpatched cost', () => {
  const day = makeDay('RECOURSE');
  const paths = [day.forecast.hours.map(a => ({...a, wind: 0}))];
  const plain = solve({paths, rules: day.rules}), patched = solve({paths, rules: day.rules, recourseFrom: 0});
  assert.ok(patched.expectedCost <= plain.expectedCost + 1e-6);
});

test('Starter plans differ by margin, cover forecast plus margin and are valid plans', () => {
  const day = makeDay('STARTER');
  const plans = [0, 50, 110].map(m => starterPlan(day, m));
  plans.forEach(p => validatePlan(p, day.rules));
  plans.forEach((p, k) => p.forEach((m, h) => {
    const a = day.forecast.hours[h];
    assert.ok(dispatch(m, {...a, demand: a.demand + [0, 50, 110][k]}).shortage < 1e-6 || capacity(m) + a.wind + a.solar >= a.demand);
  }));
  assert.notDeepEqual(plans[0], plans[2]);
});

test('Gas cover adds only gas, never removes units, and picks the cheapest covering set', () => {
  const actual = {demand: 620, wind: 70, solar: 180};
  const mask = gasCover({mask: 1, actual, previousMask: 1, planMask: 1});
  assert.equal(mask & 1, 1); assert.equal(mask & ~(1 | GAS), 0);
  near(dispatch(mask, actual).shortage, 0);
  const chosen = settle({hour: 0, mask, previousMask: 1, planMask: 1, actual}).total;
  for (let add = GAS; add; add = (add - 1) & GAS) assert.ok(chosen <= settle({hour: 0, mask: 1 | add, previousMask: 1, planMask: 1, actual}).total + 1e-7);
  assert.equal(gasCover({mask: 63, actual}), 63);
  assert.equal(gasCover({mask: 1, actual, rules: {disabled: GAS}}), 1);
});

test('Invalid inputs fail explicitly', () => {
  assert.throws(() => dispatch(64, {demand: 1, wind: 0, solar: 0}), /mask/);
  assert.throws(() => dispatch(1, {demand: -1, wind: 0, solar: 0}), /conditions/);
  near(summarize([]).total, 0);
});
