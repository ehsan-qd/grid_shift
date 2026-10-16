/** Save/restore, CSV export and the isolated tour example. */
import {VERSION, HOURS, FLEET, OPPONENTS} from './config.mjs';
import {validMask, unitNames, starterPlan, settle, summarize, gasCover, checkSchedule} from './engine.mjs';
import {makeDay, makeRealization, clockLabel} from './world.mjs';
import {createSession} from './session.mjs';
import {createOpponent} from './opponents.mjs';
import {hindsight, scoreShift, carbonTarget} from './scoring.mjs';
import {campaignDay} from './campaign.mjs';
import {decisionOptions} from './experience.mjs';

const validSchedule = s => Array.isArray(s) && s.length === HOURS && s.every(validMask);
export const sessionFor = ({seed, campaignId = null, opponent}) => createSession({seed, config: campaignDay(campaignId)?.config ?? null, opponent});

/** Rebuilds a game by replaying its settled schedules. Returns null for anything malformed or from older versions. */
export function restoreSaved(saved) {
  try {
    if (!saved || saved.version !== VERSION || !/^[A-Z0-9-]{1,24}$/.test(saved.seed) || !OPPONENTS[saved.opponent]) return null;
    if (!['free', 'daily', 'campaign'].includes(saved.mode) || (saved.mode === 'campaign') !== Boolean(campaignDay(saved.campaignId))) return null;
    if (!validSchedule(saved.plan) || !['plan', 'play', 'results'].includes(saved.phase)) return null;
    const session = sessionFor(saved), base = {mode: saved.mode, campaignId: saved.campaignId ?? null, seed: saved.seed, opponent: saved.opponent, session, preset: saved.preset ?? 'custom'};
    const selected = Math.min(HOURS - 1, Math.max(0, Math.floor(saved.selected) || 0));
    if (saved.phase === 'plan') {
      const plan = [...saved.plan];
      return {...base, phase: 'plan', plan, settled: [], view: session.view(), draft: null, selected};
    }
    if (!Array.isArray(saved.settled) || saved.settled.length > HOURS || !saved.settled.every(validSchedule)) return null;
    let view = session.start(saved.plan);
    for (const s of saved.settled) view = session.settle(s);
    let draft = view.complete ? null : [...view.schedule];
    if (!view.complete && validSchedule(saved.draft)) {
      try { checkSchedule(saved.draft, view.schedule, view.hour, session.day.rules); draft = view.schedule.map((m, t) => (t < view.hour ? m : saved.draft[t])); } catch { /* keep the live schedule */ }
    }
    return {...base, phase: view.complete ? 'results' : 'play', plan: [...saved.plan], settled: saved.settled.map(s => [...s]), view, draft, selected: view.complete ? 0 : view.hour};
  } catch {
    return null;
  }
}

export function savedSnapshot(game) {
  return {version: VERSION, mode: game.mode, campaignId: game.campaignId ?? null, seed: game.seed, opponent: game.opponent, phase: game.phase, preset: game.preset,
    plan: [...game.plan], settled: game.settled.map(s => [...s]), draft: game.draft ? [...game.draft] : null, selected: game.selected};
}

export function exportCsv(seed, human, rival, rivalName = 'Opponent') {
  const head = ['player', 'day_code', 'shift_hour', 'clock_time', 'planned_units', 'requested_units', 'settled_units', 'tripped_units', 'demand_MW', 'wind_available_MW', 'solar_available_MW',
    ...FLEET.map(u => `${u.id}_MW`), 'wind_used_MW', 'solar_used_MW', 'spare_MW', 'brownout_MWh', 'blackout_MWh', 'curtailed_MWh', 'emissions_tCO2',
    'running_GBP', 'startup_GBP', 'adjustment_GBP', 'penalty_GBP', 'total_GBP'];
  const rows = [head];
  for (const [player, ledger] of [['You', human], [rivalName, rival]]) for (const l of ledger) {
    rows.push([player, seed, l.hour + 1, clockLabel(l.hour), unitNames(l.planMask), unitNames(l.requested), unitNames(l.mask), unitNames(l.actual.outage ?? 0), l.actual.demand, l.actual.wind, l.actual.solar,
      ...l.outputs, l.windUsed, l.solarUsed, l.spare, l.brownout, l.blackout, l.curtailment, l.emissions, l.running, l.startup, l.adjustment, l.penalty, l.total]);
  }
  return rows.map(r => r.map(v => (typeof v === 'number' ? v.toFixed(4) : `"${String(v).replaceAll('"', '""')}"`)).join(',')).join('\r\n');
}

/** A separate teaching example. No live game, storage or DOM is passed into it. */
export function buildTourExample() {
  const base = makeDay('TOUR-12', {archetypes: [], title: 'Example shift', brief: 'An example day.'});
  const hours = base.forecast.hours.map(a => ({...a}));
  hours[0] = {...hours[0], demand: 600, wind: 180, solar: 180};
  const day = {...base, forecast: {seed: base.seed, hours}};
  const real = makeRealization(day).hours.map(a => ({...a}));
  const surprise = {hour: 0, clockHour: 8, demand: 620, wind: 70, solar: 180, outage: 0};
  real[0] = surprise;
  const plan = starterPlan(day, 50).map(m => m | 1);
  plan[0] = 1;
  const options = decisionOptions({day, h: 0, actual: surprise, schedule: [...plan], plan, previousMask: 0, history: [surprise], warnings: []});
  const fix = options.find(o => o.kind === 'coal') ?? options.find(o => o.kind === 'gas');
  const human = [], orbitRows = [], orbit = createOpponent('orbit', day), orbitPlan = orbit.plan([]);
  let schedule = fix.schedule, orbitSchedule = [...orbitPlan];
  for (let h = 0; h < HOURS; h++) {
    const prev = human.at(-1)?.mask ?? 0, orbitPrev = orbitRows.at(-1)?.mask ?? 0;
    if (h > 0) schedule = schedule.map((m, t) => (t === h ? gasCover({mask: m, actual: real[h], previousMask: prev, planMask: plan[h], rules: day.rules}) : m));
    human.push(settle({hour: h, mask: schedule[h], previousMask: prev, planMask: plan[h], actual: real[h]}));
    orbitSchedule = orbit.decide({warnings: [], history: real.slice(0, h + 1), schedule: orbitSchedule, previousMask: orbitPrev, plan: orbitPlan}).schedule;
    orbitRows.push(settle({hour: h, mask: orbitSchedule[h], previousMask: orbitPrev, planMask: orbitPlan[h], actual: real[h]}));
  }
  const ideal = hindsight(day, real), best = ideal.total, budget = carbonTarget(ideal.ledger);
  return {day, expected: hours[0], surprise, plan, fixed: fix.schedule, options, human, orbit: orbitRows, best: ideal.ledger,
    humanScore: scoreShift({ledger: human, best, budget}), orbitScore: scoreShift({ledger: orbitRows, best, budget}), humanTotal: summarize(human), orbitTotal: summarize(orbitRows)};
}
