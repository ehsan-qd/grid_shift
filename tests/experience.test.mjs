import test from 'node:test';
import assert from 'node:assert/strict';
import {HOURS, FLEET} from '../dist/config.mjs';
import {starterPlan, dispatch, settle, checkSchedule, isOn, COAL} from '../dist/engine.mjs';
import {makeDay, makeRealization, warningsAt} from '../dist/world.mjs';
import {createSession} from '../dist/session.mjs';
import {timelineData, needBand, decisionOptions, project, weatherAlerts, warningChanges, needsIntervention, createProgression, streakFor} from '../dist/experience.mjs';
import {makeScenarios} from '../dist/world.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);

test('Chart rows use only revealed values; later hours show the live schedule at forecast', () => {
  const s = createSession({seed: 'CHART-12'}), plan = starterPlan(s.day, 50);
  s.start(plan);
  const v = s.settle(s.view().schedule);
  const safeHistory = new Proxy(v.history, {get(t, k) { if (/^\d+$/.test(String(k)) && Number(k) >= t.length) throw Error('Future access'); return Reflect.get(t, k); }});
  const draft = v.schedule.map((m, t) => (t >= 4 ? m | (1 << 5) : m));
  const rows = timelineData({day: s.day, schedule: draft, history: safeHistory, ledger: v.ledger, warnings: v.warnings});
  assert.equal(rows.length, HOURS); assert.equal(rows[0].kind, 'settled'); assert.equal(rows[1].kind, 'live'); assert.equal(rows[2].kind, 'forecast');
  rows.forEach((r, h) => {
    near(r.served + r.shortage, r.demand); near(r.generation.reduce((a, b) => a + b, 0), r.served);
    assert.equal(r.actualDemand, h < 2 ? v.history[h].demand : null);
    if (h >= 2) { assert.equal(r.mask, draft[h]); near(r.windAvailable, s.day.forecast.hours[h].wind); }
  });
  assert.ok(rows[5].spare > timelineData({day: s.day, schedule: v.schedule, history: v.history, ledger: v.ledger})[5].spare);
});

test('The uncertainty band covers only unrevealed hours and narrows as hours are revealed', () => {
  const day = makeDay('BAND', {archetypes: []}), {hours, outcomes} = makeRealization(day);
  const before = needBand(day, [], warningsAt(day, outcomes, -1)), later = needBand(day, hours.slice(0, 6), warningsAt(day, outcomes, 5));
  assert.ok(before.every(b => b && b.lo <= b.mid && b.mid <= b.hi));
  assert.ok(later.slice(0, 6).every(b => b === null));
  const width = b => b.hi - b.lo;
  assert.ok(width(later[6]) < width(before[6]), 'The next hour is far more certain once its predecessor is revealed');
});

test('Decision options are distinct, valid under notice rules and priced now and to the end of the shift', () => {
  for (const seed of ['OPT-1', 'EVENT-16', 'EVENT-72']) {
    const s = createSession({seed}), plan = starterPlan(s.day, 0);
    let v = s.start(plan);
    for (let h = 0; h < 6; h++) {
      const opts = decisionOptions({day: s.day, h: v.hour, actual: v.actual, schedule: v.schedule, plan: v.plan, previousMask: v.ledger.at(-1)?.mask ?? 0, history: v.history, warnings: v.warnings});
      assert.equal(opts[0].kind, 'hold'); near(opts[0].nowDelta, 0); near(opts[0].restDelta, 0);
      assert.equal(new Set(opts.map(o => o.schedule.join())).size, opts.length, 'No two options are the same move');
      for (const o of opts) {
        checkSchedule(o.schedule, v.schedule, v.hour, s.day.rules);
        near(o.now.total, settle({hour: v.hour, mask: o.schedule[v.hour], previousMask: v.ledger.at(-1)?.mask ?? 0, planMask: v.plan[v.hour], actual: v.actual}).total);
        assert.ok(o.title && o.detail);
        if (o.kind === 'gas') { assert.ok(o.now.shortage < opts[0].now.shortage); assert.equal(o.detail.startsWith('Costs more'), o.nowDelta > 0); }
        if (o.kind === 'coal') assert.ok(o.from >= v.hour && isOn(o.schedule[o.from], Math.log2(o.units)) && (o.units & COAL));
        if (o.kind === 'standdown') assert.ok(o.restDelta < 0);
      }
      v = s.settle(opts.find(o => o.kind === 'gas')?.schedule ?? v.schedule);
    }
  }
});

test('Projection is deterministic and equals the settled cost when every path is the truth', () => {
  const s = createSession({seed: 'PROJECT'}), plan = starterPlan(s.day, 50), v = s.start(plan);
  const paths = makeScenarios(s.day, v.history, v.warnings, 4, 'options');
  const a = project({day: s.day, h: 0, schedule: v.schedule, plan, previousMask: 0, paths});
  assert.equal(a, project({day: s.day, h: 0, schedule: v.schedule, plan, previousMask: 0, paths}));
  const truth = [s.day.forecast.hours.map((f, t) => (t === 0 ? v.actual : f))];
  let prev = 0, total = 0;
  for (let t = 0; t < HOURS; t++) { const r = settle({hour: t, mask: v.schedule[t], previousMask: prev, planMask: plan[t], actual: truth[0][t]}); total += r.total; prev = r.mask; }
  const projected = project({day: s.day, h: 0, schedule: v.schedule, plan, previousMask: 0, paths: truth});
  assert.ok(projected <= total + 1e-6, 'Gas patching can only lower the projected cost');
});

test('Alerts describe realized surprises; warning changes stop the clock; covered persistent weather does not', () => {
  const f = {hour: 1, demand: 600, wind: 180, solar: 180, outage: 0};
  assert.deepEqual(weatherAlerts({...f, demand: 650, wind: 70, solar: 100}, f).map(e => e.kind), ['wind', 'cloud', 'demand']);
  const prior = {...f, wind: 100};
  assert.equal(needsIntervention({actual: {...f, wind: 95}, forecast: f, mask: 63, previousActual: prior, previousForecast: f}), false);
  assert.equal(needsIntervention({actual: {...f, wind: 60}, forecast: f, mask: 63, previousActual: prior, previousForecast: f}), true);
  assert.equal(needsIntervention({actual: {...f, wind: 95}, forecast: f, mask: 0, previousActual: prior, previousForecast: f}), true, 'Blackouts always stop');
  const possible = [{id: 0, kind: 'storm', status: 'possible'}], confirmed = [{id: 0, kind: 'storm', status: 'confirmed', start: 5, end: 7}];
  assert.deepEqual(warningChanges(possible, confirmed).map(c => c.change), ['confirmed']);
  assert.deepEqual(warningChanges(confirmed, [{...confirmed[0], status: 'active'}]).map(c => c.change), ['started']);
  assert.deepEqual(warningChanges(possible, possible), []);
  assert.equal(needsIntervention({actual: f, forecast: f, mask: 63, previousActual: f, previousForecast: f, warnings: confirmed, previousWarnings: possible}), true);
});

test('Run tickets cannot skip or double-settle an hour; pause and resume invalidate stale callbacks', () => {
  const c = createProgression({checkInHours: 3});
  assert.equal(c.ticket(0), null);
  c.run(0);
  const old = c.ticket(0);
  c.pause();
  assert.equal(c.consume(old, 0), false);
  c.run(0);
  assert.equal(c.consume(old, 0), false);
  const fresh = c.ticket(0);
  assert.equal(c.consume(fresh, 1), false); assert.equal(c.consume(fresh, 0), true); assert.equal(c.consume(fresh, 0), false);
  assert.equal(c.arrived(1), true); assert.equal(c.consume(c.ticket(1), 1), true); assert.equal(c.arrived(2), true);
  assert.equal(c.consume(c.ticket(2), 2), true); assert.equal(c.arrived(3), false, 'Check-in after the quiet-hour limit');
  c.run(3);
  assert.equal(c.consume(c.ticket(3), 3), true); assert.equal(c.arrived(4, {needsDecision: true}), false);
  c.run(4, {checkIn: false});
  for (let h = 4; h < 9; h++) { assert.equal(c.consume(c.ticket(h), h), true); assert.equal(c.arrived(h + 1), true, 'Skip ignores quiet-hour check-ins'); }
  assert.equal(c.consume(c.ticket(9), 9), true); assert.equal(c.arrived(10, {needsDecision: true}), false, 'Skip still stops for decisions');
});

test('Streaks count consecutive fully served hours', () => {
  assert.equal(streakFor([{shortage: 1}, {shortage: 0}, {shortage: 0}]), 2);
  assert.equal(streakFor([{shortage: 0}, {shortage: 2}]), 0);
  assert.equal(FLEET.length, 6);
  assert.ok(dispatch(63, {demand: 0, wind: 0, solar: 0}).shortage === 0);
});
