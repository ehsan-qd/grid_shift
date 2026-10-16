import test from 'node:test';
import assert from 'node:assert/strict';
import {STAR_THRESHOLDS, HOURS} from '../dist/config.mjs';
import {starterPlan, summarize} from '../dist/engine.mjs';
import {createSession} from '../dist/session.mjs';
import {hindsight, starsFor, scoreShift, coach, carbonTarget, carbonEstimate, shareText} from '../dist/scoring.mjs';

function finished(seed, margin = 50, opponent = 'orbit') {
  const s = createSession({seed, opponent});
  let v = s.start(starterPlan(s.day, margin));
  while (!v.complete) v = s.settle(v.schedule);
  return {s, v};
}

test('Perfect hindsight is a lower bound for every player, so efficiency never exceeds 100%', () => {
  for (const seed of ['HS-1', 'HS-2', 'EVENT-16', 'EVENT-72']) {
    const {s, v} = finished(seed), best = hindsight(s.day, v.actualDay);
    assert.ok(best.total <= summarize(v.ledger).total + 1e-6);
    assert.ok(best.total <= summarize(v.rivalLedger).total + 1e-6);
    assert.equal(best.ledger.length, HOURS);
    assert.ok(Math.abs(best.total - summarize(best.ledger).total) < 1e-6);
    const score = scoreShift({ledger: v.ledger, best: best.total, budget: carbonTarget(best.ledger)});
    assert.ok(score.efficiency > 0 && score.efficiency <= 1);
  }
});

test('Stars follow the configured efficiency thresholds', () => {
  assert.equal(starsFor(STAR_THRESHOLDS[0] - 0.001), 0);
  assert.equal(starsFor(STAR_THRESHOLDS[0]), 1);
  assert.equal(starsFor(STAR_THRESHOLDS[1]), 2);
  assert.equal(starsFor(STAR_THRESHOLDS[2]), 3);
  assert.equal(starsFor(1), 3);
});

test('Medals: Lights on needs zero unserved demand; Carbon compares with the hindsight shift', () => {
  const {s, v} = finished('MEDALS'), best = hindsight(s.day, v.actualDay), target = carbonTarget(best.ledger);
  const score = scoreShift({ledger: v.ledger, best: best.total, budget: target});
  assert.equal(score.medals.reliability, summarize(v.ledger).shortage < 1e-6);
  assert.equal(score.medals.carbon, summarize(v.ledger).emissions <= target + 1e-9);
  const dirty = v.ledger.map(l => ({...l, emissions: l.emissions + 1000, shortage: l.shortage + 1}));
  const worse = scoreShift({ledger: dirty, best: best.total, budget: target});
  assert.equal(worse.medals.carbon, false); assert.equal(worse.medals.reliability, false);
  assert.ok(carbonEstimate(s.day) > 0);
});

test('Coaching regrets reconcile exactly: plan regret + in-shift regret = your total − hindsight', () => {
  for (const [seed, margin] of [['COACH-1', 0], ['COACH-2', 110], ['EVENT-16', 50]]) {
    const {s, v} = finished(seed, margin), c = coach({day: s.day, plan: v.plan, ledger: v.ledger, actualHours: v.actualDay});
    const gap = summarize(v.ledger).total - c.best;
    assert.ok(Math.abs(c.planRegret + c.playRegret - gap) < 1e-3, `${seed}: ${c.planRegret} + ${c.playRegret} ≠ ${gap}`);
    assert.ok(c.planRegret >= -1e-6 && c.playRegret >= -1e-6);
    assert.ok(Math.abs(c.hours.reduce((sum, h) => sum + h.regret, 0) - c.playRegret) < 1e-3);
    if (c.worst) { assert.ok(c.worst.regret > 100); assert.ok(Array.isArray(c.worst.moves)); }
    assert.ok(c.tips.length <= 3);
    assert.equal(c.bestLedger.length, HOURS);
  }
});

test('Share text carries the code, stars, efficiency and medals', () => {
  const text = shareText({seed: 'DAY-2026-10-16', title: 'Storm front', score: {stars: 2, efficiency: 0.9781, medals: {reliability: true, carbon: false}}, rival: {name: 'ORBIT', efficiency: 0.986}});
  assert.match(text, /DAY-2026-10-16/); assert.match(text, /★★☆ 97\.8%/); assert.match(text, /Lights on/); assert.doesNotMatch(text, /carbon/); assert.match(text, /ORBIT: 98\.6%/);
});
