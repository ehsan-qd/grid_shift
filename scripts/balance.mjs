/** Balance harness: simulates many shifts with scripted players and checks the fun targets.
 * Usage: node scripts/balance.mjs [days=60]. Change dist/config.mjs, rerun, compare. */
import {PRESETS, RUN} from '../dist/config.mjs';
import {starterPlan} from '../dist/engine.mjs';
import {createSession} from '../dist/session.mjs';
import {createOpponent} from '../dist/opponents.mjs';
import {hindsight, scoreShift, carbonTarget} from '../dist/scoring.mjs';
import {decisionOptions, needsIntervention} from '../dist/experience.mjs';

const DAYS = Number(process.argv[2]) || 60;
const seeds = Array.from({length: DAYS}, (_, i) => `BAL-${i}`);
const pct = v => `${(v * 100).toFixed(1)}%`;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const quantile = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];

/** Player policies: each returns the schedule to settle for the live hour. */
const policies = {
  passive: ctx => ctx.view.schedule,
  oneClick: ctx => (options(ctx).find(o => o.kind === 'gas') ?? options(ctx)[0]).schedule,
  smart: ctx => options(ctx).reduce((a, b) => (b.rest < a.rest ? b : a)).schedule,
  expert: ctx => ctx.expert.decide({warnings: ctx.view.warnings, history: ctx.view.history, schedule: ctx.view.schedule, previousMask: ctx.previousMask, plan: ctx.view.plan}).schedule,
};
function options(ctx) {
  ctx.cache ??= decisionOptions({day: ctx.session.day, h: ctx.view.hour, actual: ctx.view.actual, schedule: ctx.view.schedule, plan: ctx.view.plan,
    previousMask: ctx.previousMask, history: ctx.view.history, warnings: ctx.view.warnings});
  return ctx.cache;
}

function play(seed, presetKey, policyKey, opponent = 'orbit') {
  const session = createSession({seed, opponent}), day = session.day;
  const plan = presetKey === 'orbitPlan' ? createOpponent('orbit', day).plan(session.view().warnings) : starterPlan(day, PRESETS[presetKey].margin);
  const expert = createOpponent('orbit', day);
  let view = session.start(plan), stops = 0, quiet = 0, prev = null;
  while (!view.complete) {
    const h = view.hour, f = day.forecast.hours[h];
    if (h > 0) {
      const stop = needsIntervention({actual: view.actual, forecast: f, mask: view.schedule[h], previousActual: prev.actual, previousForecast: day.forecast.hours[h - 1],
        warnings: view.warnings, previousWarnings: prev.warnings, previousShortage: view.ledger.at(-1).shortage});
      if (stop || ++quiet >= RUN.checkInHours) { stops++; quiet = 0; }
    }
    prev = view;
    view = session.settle(policies[policyKey]({session, view, expert, previousMask: view.ledger.at(-1)?.mask ?? 0}));
  }
  const ideal = hindsight(day, view.actualDay), best = ideal.total, budget = carbonTarget(ideal.ledger);
  return {you: scoreShift({ledger: view.ledger, best, budget}), rival: scoreShift({ledger: view.rivalLedger, best, budget}), stops};
}

const started = Date.now(), results = {};
const strategies = [['lean', 'oneClick'], ['balanced', 'oneClick'], ['reserve', 'oneClick'], ['balanced', 'passive'], ['balanced', 'smart'], ['reserve', 'smart'],
  ['balanced', 'expert'], ['orbitPlan', 'oneClick'], ['orbitPlan', 'expert']];
for (const [preset, policy] of strategies) results[`${preset}+${policy}`] = seeds.map(seed => play(seed, preset, policy));
const rivals = Object.fromEntries(['rookie', 'operator'].map(level => [level, seeds.map(seed => play(seed, 'balanced', 'oneClick', level).rival)]));
rivals.orbit = results['balanced+oneClick'].map(r => r.rival);

const table = {};
for (const [name, rows] of Object.entries(results)) {
  const eff = rows.map(r => r.you.efficiency);
  table[name] = {meanEff: pct(mean(eff)), p10: pct(quantile(eff, 0.1)), p90: pct(quantile(eff, 0.9)),
    stars: [0, 1, 2, 3].map(s => rows.filter(r => r.you.stars === s).length).join('/'),
    beatsOrbit: pct(rows.filter(r => r.you.total < r.rival.total - 1).length / rows.length),
    lightsOn: pct(rows.filter(r => r.you.medals.reliability).length / rows.length), carbon: pct(rows.filter(r => r.you.medals.carbon).length / rows.length),
    stops: mean(rows.map(r => r.stops)).toFixed(1)};
}
for (const [level, rows] of Object.entries(rivals)) {
  const eff = rows.map(r => r.efficiency);
  table[`opponent: ${level}`] = {meanEff: pct(mean(eff)), p10: pct(quantile(eff, 0.1)), p90: pct(quantile(eff, 0.9)), stars: [0, 1, 2, 3].map(s => rows.filter(r => r.stars === s).length).join('/'),
    beatsOrbit: '', lightsOn: pct(rows.filter(r => r.medals.reliability).length / rows.length), carbon: pct(rows.filter(r => r.medals.carbon).length / rows.length), stops: ''};
}
console.log(`Grid Shift balance · ${DAYS} days · ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.table(table);

const bestPreset = {lean: 0, balanced: 0, reserve: 0};
seeds.forEach((_, i) => {
  const winner = ['lean', 'balanced', 'reserve'].reduce((a, b) => (results[`${b}+oneClick`][i].you.total < results[`${a}+oneClick`][i].you.total ? b : a));
  bestPreset[winner]++;
});
const effOf = key => mean(results[key].map(r => r.you.efficiency));
const vs = (key, level) => results[key].filter((r, i) => r.you.total < (level === 'orbit' ? r.rival.total : rivals[level][i].total) - 1).length / DAYS;
const checks = [
  ['Every preset is the best choice on ≥20% of days', Object.values(bestPreset).every(n => n / DAYS >= 0.2), Object.entries(bestPreset).map(([k, n]) => `${k} ${pct(n / DAYS)}`).join(', ')],
  // One-click play leaves ~3.4 points in-shift versus hindsight; ~1.6 of that is irreducible uncertainty.
  ['In-shift skill: expert beats one-click by ≥1.5 efficiency points', effOf('balanced+expert') - effOf('balanced+oneClick') >= 0.015, `${pct(effOf('balanced+expert') - effOf('balanced+oneClick'))}`],
  ['Planning skill: ORBIT plan beats Balanced preset by ≥1 point', effOf('orbitPlan+oneClick') - effOf('balanced+oneClick') >= 0.01, pct(effOf('orbitPlan+oneClick') - effOf('balanced+oneClick'))],
  ['Pauses per shift between 4 and 8', mean(results['balanced+oneClick'].map(r => r.stops)) >= 4 && mean(results['balanced+oneClick'].map(r => r.stops)) <= 8, mean(results['balanced+oneClick'].map(r => r.stops)).toFixed(1)],
  ['Rookie is beatable: Balanced + one-click wins ≥60%', vs('balanced+oneClick', 'rookie') >= 0.6, pct(vs('balanced+oneClick', 'rookie'))],
  ['ORBIT is beatable by skilled play: expert wins 20–60%', vs('balanced+expert', 'orbit') >= 0.2 && vs('balanced+expert', 'orbit') <= 0.6, pct(vs('balanced+expert', 'orbit'))],
  ['Stars spread: one-click averages 1–2★, ORBIT ≥2★', (() => { const a = mean(results['balanced+oneClick'].map(r => r.you.stars)), b = mean(rivals.orbit.map(r => r.stars)); return a >= 1 && a <= 2 && b >= 2; })(),
    `one-click ${mean(results['balanced+oneClick'].map(r => r.you.stars)).toFixed(2)}★, ORBIT ${mean(rivals.orbit.map(r => r.stars)).toFixed(2)}★`],
  ['Carbon medal is a real trade-off: ORBIT earns it on 20–70% of days', (() => { const c = rivals.orbit.filter(r => r.medals.carbon).length / DAYS; return c >= 0.2 && c <= 0.7; })(), pct(rivals.orbit.filter(r => r.medals.carbon).length / DAYS)],
];
for (const [label, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
process.exitCode = checks.every(c => c[1]) ? 0 : 1;
