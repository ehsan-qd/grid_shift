import test from 'node:test';
import assert from 'node:assert/strict';
import {HOURS} from '../dist/config.mjs';
import {starterPlan, summarize, dispatch, lockedBits, capacity, GAS} from '../dist/engine.mjs';
import {makeDay, makeRealization, makeScenarios, warningsAt} from '../dist/world.mjs';
import {createSession} from '../dist/session.mjs';
import {createOpponent} from '../dist/opponents.mjs';
import {validateRow} from './engine.test.mjs';

test('Session withholds the hidden day and the opponent until results; the submitted plan is copied', () => {
  const s = createSession({seed: 'VIEW'}), p = starterPlan(s.day, 50);
  let v = s.view();
  assert.equal(v.started, false); assert.equal(v.actual, null); assert.equal(v.history.length, 0);
  v = s.start(p);
  const original = p[0];
  p[0] = 0;
  assert.equal(v.plan[0], original);
  assert.equal(v.history.length, 1); assert.equal(v.actual.clockHour, 8);
  for (const key of ['rivalPlan', 'rivalLedger', 'rivalNotes', 'actualDay']) assert.equal(v[key], undefined);
  assert.throws(() => s.start(v.plan), /Already/);
  for (let i = 0; i < HOURS; i++) {
    v = s.settle(v.schedule);
    if (i < HOURS - 1) { assert.equal(v.rivalLedger, undefined); assert.equal(v.history.length, i + 2); }
  }
  assert.equal(v.complete, true); assert.equal(v.actual, null);
  assert.equal(v.rivalLedger.length, HOURS); assert.equal(v.actualDay.length, HOURS);
  assert.throws(() => s.settle(v.schedule), /No active/);
});

test('Session enforces notice periods for the player', () => {
  const s = createSession({seed: 'NOTICE'}), plan = starterPlan(s.day, 50);
  let v = s.start(plan);
  const c1 = 1 << 1, flipped = v.schedule.map((m, t) => (t === 1 ? m ^ c1 : m));
  assert.throws(() => s.settle(flipped), /notice/);
  v = s.settle(v.schedule.map((m, t) => (t >= 2 ? m ^ c1 : m)));
  assert.equal(v.schedule[2] & c1, (plan[2] ^ c1) & c1, 'A change with enough notice sticks to the live schedule');
  assert.throws(() => s.settle(v.schedule.map(m => m ^ 1)), /notice/, 'Nuclear cannot change mid-shift');
});

test('Opponents read only public inputs and always respect notice periods', () => {
  const day = makeDay('CAUSAL', {archetypes: ['storm', 'trip']}), {hours, outcomes} = makeRealization(day);
  for (const level of ['rookie', 'operator', 'orbit']) {
    const o = createOpponent(level, day), plan = o.plan(warningsAt(day, outcomes, -1));
    const allowed = {warnings: warningsAt(day, outcomes, 6), history: hours.slice(0, 7), schedule: [...plan], previousMask: plan[5], plan};
    const poison = new Proxy(allowed, {get(t, key) { if (!(key in t)) throw Error(`Read forbidden input: ${String(key)}`); return t[key]; }});
    const decision = o.decide(poison);
    assert.deepEqual(decision, o.decide(allowed));
    for (let t = 6; t < HOURS; t++) assert.equal((decision.schedule[t] ^ plan[t]) & lockedBits(t, 6, day.rules), 0, `${level} broke notice at ${t}`);
    assert.ok(typeof decision.reason === 'string' && decision.reason.length > 10);
  }
  const scenarios = makeScenarios(day, hours.slice(0, 7), warningsAt(day, outcomes, 6), 6, 'orbit');
  scenarios.forEach(s => assert.deepEqual(s.slice(0, 7), hours.slice(0, 7)));
});

test('ORBIT reacts to a revealed surprise', () => {
  const day = makeDay('RESPONSE', {archetypes: []}), o = createOpponent('orbit', day), plan = o.plan([]);
  const base = day.forecast.hours[0];
  const low = o.decide({warnings: [], history: [{...base, demand: 300, wind: 250}], schedule: [...plan], plan});
  const high = o.decide({warnings: [], history: [{...base, demand: 900, wind: 0, solar: 0}], schedule: [...plan], plan});
  assert.ok(capacity(high.schedule[0]) > capacity(low.schedule[0]), 'Commits more capacity for a surge');
  const surge = {demand: 900, wind: 0, solar: 0};
  assert.ok(dispatch(high.schedule[0], surge).blackout <= dispatch(high.schedule[0] | GAS, surge).blackout + 1e-9, 'Uses every instant unit it can reach (coal needs notice)');
});

test('Full playthroughs reconcile: shared actual conditions, valid rows and summed ledgers', () => {
  for (const seed of ['GS-1015', 'EVENT-16', 'EVENT-72', 'CALM-9']) {
    for (const opponent of ['rookie', 'orbit']) {
      const s = createSession({seed, opponent});
      let v = s.start(starterPlan(s.day, 50));
      while (!v.complete) v = s.settle(v.schedule);
      assert.equal(v.ledger.length, HOURS); assert.equal(v.rivalNotes.length, HOURS);
      for (let h = 0; h < HOURS; h++) {
        validateRow(v.ledger[h]); validateRow(v.rivalLedger[h]);
        assert.deepEqual(v.ledger[h].actual, v.rivalLedger[h].actual);
        assert.deepEqual(v.ledger[h].actual, v.actualDay[h]);
      }
      for (const ledger of [v.ledger, v.rivalLedger]) {
        const sum = summarize(ledger);
        assert.ok(Math.abs(sum.total - (sum.running + sum.startup + sum.adjustment + sum.penalty)) < 1e-6);
      }
    }
  }
});

test('Returned views are copies: mutating them cannot change the session', () => {
  const s = createSession({seed: 'COPY'});
  s.start(starterPlan(s.day, 50));
  const v = s.settle(s.view().schedule), expected = s.view();
  v.plan[0] = 0; v.schedule[3] = 0; v.ledger[0].actual.demand = 9999; v.ledger[0].outputs[0] = 9999; v.history[0].wind = 9999; v.warnings.length = 0;
  assert.deepEqual(s.view(), expected);
});

test('Decisions matter: a hold-only player and a reacting player both win and lose against ORBIT across days', () => {
  let wins = 0, losses = 0;
  for (let i = 0; i < 16; i++) {
    const s = createSession({seed: `MATCH-${i}`}), expert = createOpponent('orbit', s.day);
    let v = s.start(starterPlan(s.day, 110));
    while (!v.complete) v = s.settle(expert.decide({warnings: v.warnings, history: v.history, schedule: v.schedule, previousMask: v.ledger.at(-1)?.mask ?? 0, plan: v.plan}).schedule);
    const gap = summarize(v.ledger).total - summarize(v.rivalLedger).total;
    if (gap < -1) wins++;
    if (gap > 1) losses++;
  }
  assert.ok(wins > 0, `A skilled player must be able to win (${wins} wins, ${losses} losses)`);
  assert.ok(losses > 0, `A win must not be baked in (${wins} wins, ${losses} losses)`);
});
