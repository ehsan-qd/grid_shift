import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {VERSION, HOURS} from '../dist/config.mjs';
import {starterPlan, dispatch, summarize} from '../dist/engine.mjs';
import {restoreSaved, savedSnapshot, exportCsv, buildTourExample, sessionFor} from '../dist/support.mjs';
import {CAMPAIGN, campaignTrack, nextCampaignDay, goalMet, describeGoal, dailyCode, campaignDay} from '../dist/campaign.mjs';
import {createSession} from '../dist/session.mjs';

function gameAt(seed, hours, extra = {}) {
  const session = sessionFor({seed, opponent: 'orbit', ...extra}), plan = starterPlan(session.day, 50);
  let view = session.start(plan);
  const settled = [];
  for (let h = 0; h < hours; h++) { settled.push([...view.schedule]); view = session.settle(view.schedule); }
  return {mode: extra.campaignId ? 'campaign' : 'free', campaignId: extra.campaignId ?? null, seed, opponent: 'orbit', session, plan, phase: view.complete ? 'results' : 'play', preset: 'balanced', settled, view, draft: view.complete ? null : [...view.schedule], selected: 0};
}

test('Saves restore play, plan and results; drafts that break notice rules fall back to the live schedule', () => {
  const game = gameAt('SAVE', 3), draft = game.draft.map((m, t) => (t >= 5 ? m | (1 << 5) : m));
  const restored = restoreSaved(savedSnapshot({...game, draft}));
  assert.equal(restored.phase, 'play'); assert.equal(restored.view.hour, 3);
  assert.deepEqual(restored.view.ledger, game.view.ledger); assert.deepEqual(restored.draft, draft);
  assert.equal(restored.view.rivalLedger, undefined, 'Opponent stays hidden after a reload');
  const illegal = game.draft.map((m, t) => (t === 3 ? m ^ (1 << 1) : m));
  assert.deepEqual(restoreSaved(savedSnapshot({...game, draft: illegal})).draft, game.view.schedule);
  const plan = restoreSaved({...savedSnapshot(game), phase: 'plan', settled: [], selected: 11});
  assert.equal(plan.phase, 'plan'); assert.equal(plan.selected, 11); assert.equal(plan.view.started, false);
  const done = restoreSaved(savedSnapshot(gameAt('SAVE-DONE', HOURS)));
  assert.equal(done.phase, 'results'); assert.equal(done.view.rivalLedger.length, HOURS);
});

test('Old, malformed or tampered saves are rejected', () => {
  const good = savedSnapshot(gameAt('SAVE-BAD', 1));
  assert.equal(restoreSaved({...good, version: 2}), null);
  assert.equal(restoreSaved({...good, seed: 'bad seed!'}), null);
  assert.equal(restoreSaved({...good, plan: Array(24).fill(3)}), null);
  assert.equal(restoreSaved({...good, opponent: 'cheater'}), null);
  assert.equal(restoreSaved({...good, mode: 'campaign', campaignId: 'C99'}), null);
  assert.equal(restoreSaved({...good, settled: [[1]]}), null);
  assert.equal(restoreSaved({...good, settled: [good.plan.map(m => m ^ 1)]}), null, 'A settled schedule that breaks nuclear rules is rejected');
  assert.equal(restoreSaved(null), null);
  assert.equal(VERSION, 3);
});

test('Campaign saves rebuild the campaign day, not a free day with the same code', () => {
  const day = CAMPAIGN[0], g = gameAt(day.seed, 2, {campaignId: day.id});
  const restored = restoreSaved(savedSnapshot(g));
  assert.equal(restored.session.day.title, day.title);
  assert.equal(restored.session.day.rules.wind, false);
});

test('CSV export has 24 records with real clocks, shared conditions and reconciled costs', () => {
  const g = gameAt('CSV', HOURS), lines = exportCsv('CSV', g.view.ledger, g.view.rivalLedger, 'ORBIT').split('\r\n');
  assert.equal(lines.length, 25);
  const rows = lines.map(l => l.split(',').map(s => s.replace(/^"|"$/g, ''))), head = rows[0], col = k => head.indexOf(k);
  assert.equal(rows[1][col('clock_time')], '08:00'); assert.equal(rows[12][col('clock_time')], '19:00'); assert.equal(rows[13][col('player')], 'ORBIT');
  for (let h = 0; h < 12; h++) for (const key of ['demand_MW', 'wind_available_MW', 'solar_available_MW', 'tripped_units']) assert.equal(rows[h + 1][col(key)], rows[h + 13][col(key)]);
  for (const group of [rows.slice(1, 13), rows.slice(13)]) {
    const total = group.reduce((s, r) => s + Number(r[col('total_GBP')]), 0);
    const parts = group.reduce((s, r) => s + ['running_GBP', 'startup_GBP', 'adjustment_GBP', 'penalty_GBP'].reduce((a, k) => a + Number(r[col(k)]), 0), 0);
    assert.ok(Math.abs(total - parts) < 0.01);
  }
});

test('Tour example computes a real shortage and recovery and never touches a live game', () => {
  const s = createSession({seed: 'LIVE'});
  s.start(starterPlan(s.day, 50));
  s.settle(s.view().schedule);
  const before = s.view(), demo = buildTourExample();
  assert.ok(dispatch(demo.plan[0], demo.surprise).shortage > 100);
  assert.ok(dispatch(demo.fixed[0], demo.surprise).shortage < 1e-9);
  assert.ok(demo.options.length >= 2 && demo.options[0].kind === 'hold');
  assert.equal(demo.human.length, HOURS); assert.equal(demo.orbit.length, HOURS);
  assert.ok(demo.humanScore.efficiency <= 1 && demo.orbitScore.efficiency <= 1);
  assert.ok(Math.abs(demo.humanTotal.total - summarize(demo.human).total) < 1e-6);
  assert.deepEqual(s.view(), before);
  assert.deepEqual(buildTourExample().human, demo.human, 'The tour is deterministic');
});

test('Campaign unlocks in order, goals combine stars and medals, and the daily code is date based', () => {
  assert.equal(CAMPAIGN.length, 10);
  assert.equal(new Set(CAMPAIGN.map(d => d.seed)).size, 10);
  let track = campaignTrack({});
  assert.equal(track.filter(d => d.unlocked).length, 1);
  assert.equal(nextCampaignDay({}).id, 'C01');
  track = campaignTrack({C01: {done: true, stars: 2}, C02: {done: false, stars: 0}});
  assert.deepEqual(track.filter(d => d.unlocked).map(d => d.id), ['C01', 'C02']);
  assert.equal(nextCampaignDay({C01: {done: true}}).id, 'C02');
  const score = {stars: 2, medals: {reliability: true, carbon: false}};
  assert.equal(goalMet({stars: 2}, score), true);
  assert.equal(goalMet({stars: 2, carbon: true}, score), false);
  assert.equal(goalMet({stars: 3}, score), false);
  assert.match(describeGoal({stars: 2, reliability: true}), /★★ or better · Lights on/);
  assert.equal(dailyCode(new Date(2026, 9, 6)), 'DAY-2026-10-06');
  assert.ok(/^[A-Z0-9-]{1,24}$/.test(dailyCode()));
  assert.equal(campaignDay('C05').config.rules.leadTimes, undefined, 'Day 5 introduces notice periods');
  assert.equal(campaignDay('C04').config.rules.leadTimes, false);
});

test('The standalone build inlines every module and asset with no external references', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['scripts/build-local.mjs'], {encoding: 'utf8'}));
  assert.equal(out.externalAssets, 0);
  assert.equal(out.modules.at(-1), 'app.mjs');
  const html = readFileSync(out.output, 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="[\w-]+\.(?:mjs|css|svg)"/);
  assert.doesNotMatch(html, /^\s*import\s*\{/m);
  assert.match(html, /const __app_mjs = \(\(\) =>/);
});
