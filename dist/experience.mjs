/** Player-facing model: chart rows, uncertainty, decision options, alerts and run control. Public inputs only. */
import {HOURS, FLEET, ALERTS, RUN, SCENARIOS} from './config.mjs';
import {dispatch, settle, gasCover, flipRun, editableFrom, availableUnits, isOn, unitNames, NUCLEAR, COAL, GAS} from './engine.mjs';
import {makeScenarios, clockLabel} from './world.mjs';

/** Outages already announced (a trip in progress) for hour t. */
export const knownOutage = (warnings, t) => warnings.reduce((m, w) => (w.kind === 'trip' && (w.status === 'active' || w.status === 'over') && t >= w.start && t < w.end ? m | (1 << w.unit) : m), 0);

/** Twelve chart rows. Settled hours use what ran; the live hour previews the draft; later hours use the live schedule at forecast. */
export function timelineData({day, schedule, history = [], ledger = [], warnings = []}) {
  return day.forecast.hours.map((expected, h) => {
    const revealed = h < history.length, row = ledger[h] ?? null;
    const conditions = revealed ? history[h] : {...expected, outage: knownOutage(warnings, h)};
    const mask = row ? row.requested : schedule[h], d = dispatch(mask, conditions);
    return {hour: h, kind: row ? 'settled' : revealed ? 'live' : 'forecast', mask, demand: conditions.demand, forecastDemand: expected.demand,
      actualDemand: revealed ? history[h].demand : null, windAvailable: conditions.wind, solarAvailable: conditions.solar, outage: conditions.outage ?? 0,
      generation: [d.outputs[0], d.outputs[1] + d.outputs[2], d.outputs[3] + d.outputs[4] + d.outputs[5], d.windUsed, d.solarUsed],
      served: d.served, spare: d.spare, shortage: d.shortage, blackout: d.blackout, curtailment: d.curtailment};
  });
}

/** p10–p90 of the demand that firm units may have to meet, drawn on the forecast-demand scale. Narrows as hours reveal. */
export function needBand(day, history = [], warnings = [], count = SCENARIOS.band) {
  const paths = makeScenarios(day, history, warnings, count, 'band'), h = history.length - 1;
  return day.forecast.hours.map((f, t) => {
    if (t <= h) return null;
    const deltas = paths.map(p => (p[t].demand - p[t].wind - p[t].solar) - (f.demand - f.wind - f.solar)).sort((a, b) => a - b);
    const q = k => f.demand + deltas[Math.round(k * (deltas.length - 1))];
    return {lo: q(0.1), mid: q(0.5), hi: q(0.9)};
  });
}

/** Expected cost from hour h to the end, assuming future gaps get patched with gas. */
export function project({day, h, schedule, plan, previousMask, paths}) {
  let total = 0;
  for (const path of paths) {
    let prev = previousMask;
    for (let t = h; t < HOURS; t++) {
      const mask = t > h ? gasCover({mask: schedule[t], actual: path[t], previousMask: prev, planMask: plan[t], rules: day.rules}) : schedule[t];
      const row = settle({hour: t, mask, previousMask: prev, planMask: plan[t], actual: path[t]});
      total += row.total;
      prev = row.mask;
    }
  }
  return total / paths.length;
}

/** Cheapest gas to serve every megawatt this hour; falls back to the cheapest partial cover if gas can't close the gap. */
function fullCover({mask, actual, previousMask, planMask, rules}) {
  const free = availableUnits(rules) & GAS & ~mask & ~(actual.outage ?? 0);
  let best = null, bestCost = Infinity;
  for (let add = free; add; add = (add - 1) & free) {
    const row = settle({hour: 0, mask: mask | add, previousMask, planMask, actual});
    if (row.shortage < 1e-9 && row.total < bestCost) { best = mask | add; bestCost = row.total; }
  }
  return best ?? gasCover({mask, actual, previousMask, planMask, rules});
}

/** Concrete moves for the live hour, each priced now and to the end of the shift. They inform; they do not optimise. */
export function decisionOptions({day, h, actual, schedule, plan, previousMask, history, warnings}) {
  const rules = day.rules, paths = makeScenarios(day, history, warnings, SCENARIOS.options, 'options');
  const evaluate = s => ({schedule: s, now: settle({hour: h, mask: s[h], previousMask, planMask: plan[h], actual}), rest: project({day, h, schedule: s, plan, previousMask, paths})});
  const hold = {kind: 'hold', ...evaluate(schedule)}, options = [hold];
  const cover = hold.now.shortage > 1e-9 ? fullCover({mask: schedule[h], actual, previousMask, planMask: plan[h], rules}) : schedule[h], added = cover & ~schedule[h];
  if (added) {
    let s = schedule;
    FLEET.forEach((u, i) => { if (isOn(added, i)) s = flipRun(s, i, h, true); });
    options.push({kind: 'gas', units: added, ...evaluate(s)});
  }
  const coal = FLEET.flatMap((u, i) => {
    const t0 = editableFrom(i, h, rules);
    if (!isOn(COAL & availableUnits(rules), i) || t0 >= HOURS || isOn(schedule[t0], i)) return [];
    let s = flipRun(schedule, i, t0, true);
    if (added && t0 > h) s = s.map((m, t) => (t >= h && t < t0 ? m | added : m));
    return [{kind: 'coal', units: 1 << i, from: t0, bridge: t0 > h ? added : 0, ...evaluate(s)}];
  });
  if (coal.length) options.push(coal.reduce((a, b) => (b.rest < a.rest ? b : a)));
  const standDown = FLEET.flatMap((u, i) => {
    const t0 = editableFrom(i, h, rules);
    if (isOn(NUCLEAR, i) || t0 >= HOURS || !isOn(schedule[t0], i)) return [];
    return [{kind: 'standdown', units: 1 << i, from: t0, ...evaluate(flipRun(schedule, i, t0, false))}];
  }).filter(o => o.now.blackout < 1e-9 && o.rest < hold.rest - 50);
  if (standDown.length) options.push(standDown.reduce((a, b) => (b.rest < a.rest ? b : a)));
  return options.map(o => ({...o, nowDelta: o.now.total - hold.now.total, restDelta: o.rest - hold.rest}))
    .map(o => ({...o, ...describeOption(o, h)}));
}

function describeOption(o, h) {
  const gap = o.now.shortage, names = unitNames(o.units ?? 0);
  if (o.kind === 'hold') return {title: 'Hold course', detail: gap > 1e-9 ? `${o.now.blackout > 1e-9 ? 'Blackout' : 'Brownout'}: ${Math.round(gap)} MW unserved this hour` : `${Math.round(o.now.spare)} MW spare this hour`};
  if (o.kind === 'gas') return {title: `Fire up ${names}`, detail: o.nowDelta > 0 ? 'Costs more than the brownout, but keeps every light on.' : 'Instant. Stays on until you stand it down.'};
  if (o.kind === 'coal') return {title: `Order ${names} for ${clockLabel(o.from)}`, detail: o.bridge ? `${unitNames(o.bridge)} bridges until ${clockLabel(o.from)}, then ${names} takes over` : `Cheaper fuel than gas once it is running`};
  return {title: `Stand down ${names}${o.from > h ? ` from ${clockLabel(o.from)}` : ''}`, detail: 'Saves standby charges if the forecast holds'};
}

export function weatherAlerts(actual, forecast) {
  const events = [];
  if (actual.wind - forecast.wind <= ALERTS.wind) events.push({kind: 'wind', title: 'Wind drop', delta: actual.wind - forecast.wind, detail: 'Wind below forecast'});
  if (actual.solar - forecast.solar <= ALERTS.solar) events.push({kind: 'cloud', title: 'Solar dip', delta: actual.solar - forecast.solar, detail: 'Solar below forecast'});
  if (actual.demand - forecast.demand >= ALERTS.demand) events.push({kind: 'demand', title: 'Demand surge', delta: actual.demand - forecast.demand, detail: 'Demand above forecast'});
  return events;
}

/** Status changes worth stopping the clock for. */
export function warningChanges(previous = [], current = []) {
  return current.flatMap(w => {
    const before = previous.find(p => p.id === w.id)?.status ?? 'possible';
    if (before === w.status) return [];
    if (w.status === 'confirmed') return [{warning: w, change: 'confirmed'}];
    if (w.status === 'active') return [{warning: w, change: w.kind === 'trip' ? 'tripped' : 'started'}];
    if (w.status === 'cleared') return [{warning: w, change: 'cleared'}];
    return [];
  });
}

export function hourStatus(actual, forecast, mask) {
  const d = dispatch(mask, actual);
  return {events: weatherAlerts(actual, forecast), shortage: d.shortage, blackout: d.blackout, brownout: d.brownout, spare: d.spare};
}

/** Persistent covered weather does not interrupt again; blackouts, new brownouts, warnings and worsening shocks do. */
export function needsIntervention({actual, forecast, mask, previousActual = null, previousForecast = null, warnings = [], previousWarnings = [], previousShortage = 0}) {
  const now = hourStatus(actual, forecast, mask);
  if (now.blackout > 1e-9) return true;
  if (now.shortage > 1e-9 && previousShortage < 1e-9) return true;
  if (warningChanges(previousWarnings, warnings).length) return true;
  if (!previousActual || !previousForecast) return now.events.length > 0;
  const prior = weatherAlerts(previousActual, previousForecast);
  return now.events.some(e => {
    const before = prior.find(p => p.kind === e.kind);
    return !before || Math.abs(e.delta) >= Math.abs(before.delta) + ALERTS.worsen;
  });
}

/** Timer-independent controller: every callback carries a generation AND hour token. */
export function createProgression({checkInHours = RUN.checkInHours} = {}) {
  let running = false, generation = 0, expectedHour = null, quietHours = 0, checkIns = true;
  return {
    get running() { return running; },
    pause() { running = false; generation++; expectedHour = null; },
    /** `checkIn: false` (Skip) runs until a real decision instead of pausing after quiet hours. */
    run(hour, {checkIn = true} = {}) {
      if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS) throw new Error('Invalid hour');
      running = true; generation++; expectedHour = hour; quietHours = 0; checkIns = checkIn;
    },
    ticket(hour) { return running && expectedHour === hour ? Object.freeze({generation, hour}) : null; },
    consume(ticket, hour) {
      if (!ticket || !running || ticket.generation !== generation || ticket.hour !== hour || expectedHour !== hour) return false;
      expectedHour = hour + 1; generation++; quietHours++;
      return true;
    },
    arrived(hour, {needsDecision = false, complete = false} = {}) {
      if (complete || needsDecision || (checkIns && quietHours >= checkInHours) || hour !== expectedHour) this.pause();
      return running;
    },
  };
}

export function streakFor(ledger) {
  let streak = 0;
  for (let i = ledger.length - 1; i >= 0 && ledger[i].shortage < 1e-7; i--) streak++;
  return streak;
}

