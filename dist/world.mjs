/** Days, weather and events. Public: the day (forecast, rules, event warnings). Hidden: the realization. */
import {HOURS, START_HOUR, WIND_CAPACITY, SOLAR_CAPACITY, FLEET, DEFAULT_RULES, ARCHETYPES, ARCHETYPE_ODDS} from './config.mjs';

export function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = hash(seed);
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noise = r => (r() + r() + r() + r() - 2) * 1.73;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = v => Math.round(v * 10) / 10;
const between = (r, a, b) => a + r() * (b - a);
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const fivePercent = v => Math.round(v * 20) / 20;
export const clockLabel = h => `${String(START_HOUR + h).padStart(2, '0')}:00`;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function pickArchetypes(r, rules) {
  const pool = Object.keys(ARCHETYPES).filter(id => (id !== 'storm' || rules.wind) && (id !== 'fog' || rules.solar));
  if (r() < ARCHETYPE_ODDS.calm) return [];
  const chosen = [pool.splice(Math.floor(r() * pool.length), 1)[0]];
  if (r() < ARCHETYPE_ODDS.second) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return chosen;
}

/** Public event specs. `notice` is how many hours ahead an occurring event is confirmed. */
function makeEvent(kind, r, rules, overrides = {}) {
  const tripUnit = rules.disabled & (1 << 1) ? 3 : 1;
  const build = {
    storm: () => {
      const a = int(r, 3, 6);
      return {title: 'Storm front', icon: '≈', prob: fivePercent(between(r, 0.5, 0.8)), window: [a, a + 3], duration: [2, 5], notice: 2,
        windFactor: 0.08, detail: 'Gale-force winds shut turbines down. Confirmed 2 hours ahead.'};
    },
    trip: () => {
      const a = int(r, 2, 5);
      return {title: `Faulty pump at ${FLEET[tripUnit].name}`, icon: '⚠', unit: tripUnit, prob: fivePercent(between(r, 0.35, 0.6)),
        window: [a, a + 4], duration: [2, 4], notice: 1, detail: `${FLEET[tripUnit].id} may trip offline. A vibration alarm gives 1 hour's notice.`};
    },
    fog: () => ({title: 'Morning fog', icon: '☁', prob: fivePercent(between(r, 0.5, 0.8)), window: [0, 0], duration: [2, 4], notice: 0,
      solarFactor: 0.2, detail: 'Fog smothers solar output until it lifts.'}),
    surge: () => ({title: 'Cup final', icon: '⚑', prob: 1, window: [10, 11], duration: [1, 1], notice: 2, amount: [70, 110],
      detail: 'Final whistle at 18:00 sends demand surging; extra time pushes it to 19:00.'}),
  }[kind];
  return {kind, ...build(), ...overrides};
}

export function makeForecast(seed, archetypes = [], rules = DEFAULT_RULES) {
  const r = rng(`${seed}:forecast:v3`);
  const phase = r() * 4, windBase = 100 + r() * 75, cloud = 0.65 + r() * 0.3, demandScale = 0.93 + r() * 0.14;
  const peak = 18.1 + r() * 0.8, morningAmp = 75 + r() * 60, heat = archetypes.includes('heatwave');
  const hours = Array.from({length: HOURS}, (_, index) => {
    const h = START_HOUR + index;
    const morning = morningAmp * Math.exp(-(((h - 8) / 2.5) ** 2));
    const evening = (heat ? 300 : 240) * Math.exp(-(((h - (heat ? 19 : peak)) / 3.1) ** 2));
    const afternoon = heat ? 60 * Math.exp(-(((h - 15) / 2.5) ** 2)) : 0;
    const demand = round(clamp((455 + morning + evening + afternoon + 30 * Math.sin((h - 5) / 24 * Math.PI * 2)) * demandScale * rules.demandScale, 300, 900));
    const wind = rules.wind ? round(clamp(windBase + 48 * Math.sin((h + phase) / 24 * Math.PI * 2) + 20 * Math.cos(h / 9), 30, 250)) : 0;
    const solar = rules.solar ? round(Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) * SOLAR_CAPACITY * (heat ? 0.95 : cloud)) : 0;
    return {hour: index, clockHour: h, demand, wind, solar, outage: 0};
  });
  return {seed: String(seed), hours};
}

/** A day is everything public before the shift. `config` (campaign) can fix archetypes, rules and event details. */
export function makeDay(seed, config = null) {
  const rules = {...DEFAULT_RULES, ...(config?.rules ?? {})};
  const archetypes = config?.archetypes ? [...config.archetypes] : pickArchetypes(rng(`${seed}:archetypes:v3`), rules);
  const r = rng(`${seed}:events:v3`);
  const events = archetypes.filter(id => id !== 'heatwave').map(kind => makeEvent(kind, r, rules, config?.events?.[kind]));
  const title = config?.title ?? (archetypes.length ? archetypes.map(id => ARCHETYPES[id].title).join(' + ') : 'Ordinary day');
  const mission = config?.brief ?? (archetypes.length ? archetypes.map(id => ARCHETYPES[id].mission).join(' ') : 'A quiet forecast. Win it with a tight plan and careful calls.');
  return deepFreeze({seed: String(seed), title, mission, archetypes, rules, forecast: makeForecast(seed, archetypes, rules), events});
}

/** AR(1) forecast errors. `start` continues from revealed errors; null draws a fresh day-ahead path. */
function basePath(day, r, start = null) {
  const f = day.forecast.hours, s = day.rules.errorScale, heat = day.archetypes.includes('heatwave') ? 1.4 : 1;
  let ed, ew, es, biasD = 0, biasW = 0;
  if (start) ({ed, ew, es} = start);
  else {
    ed = noise(r) * 18 * s * heat; ew = noise(r) * 32 * s; es = noise(r) * 20 * s;
    biasD = noise(r) * 12 * s; biasW = noise(r) * 22 * s;
  }
  const out = [];
  for (let h = start ? start.h + 1 : 0; h < HOURS; h++) {
    ed = 0.82 * ed + noise(r) * 12 * s * heat + biasD * 0.18;
    ew = 0.88 * ew + noise(r) * 23 * s + biasW * 0.12;
    es = 0.85 * es + noise(r) * 11 * s;
    out[h] = {hour: h, clockHour: START_HOUR + h, demand: round(clamp(f[h].demand + ed, 300, 950)),
      wind: day.rules.wind ? round(clamp(f[h].wind + ew, 0, WIND_CAPACITY)) : 0,
      solar: day.rules.solar ? round(clamp(f[h].solar * (1 + es / 75), 0, SOLAR_CAPACITY)) : 0, outage: 0};
  }
  return out;
}

function drawOutcome(ev, r) {
  const occurs = r() < ev.prob, start = int(r, ev.window[0], ev.window[1]), duration = int(r, ev.duration[0], ev.duration[1]);
  const amount = ev.amount ? round(between(r, ev.amount[0], ev.amount[1])) : 0;
  return {occurs, start, duration, amount};
}

function applyEvent(hours, ev, o, fromHour = 0) {
  if (!o.occurs) return;
  for (let t = Math.max(o.start, fromHour); t < Math.min(HOURS, o.start + o.duration); t++) {
    const a = hours[t];
    if (ev.kind === 'storm') a.wind = round(a.wind * ev.windFactor);
    else if (ev.kind === 'fog') a.solar = round(a.solar * ev.solarFactor);
    else if (ev.kind === 'surge') a.demand = round(Math.min(950, a.demand + o.amount));
    else if (ev.kind === 'trip') a.outage |= 1 << ev.unit;
  }
}

/** The hidden day. Only the session closure holds this. */
export function makeRealization(day) {
  const hours = basePath(day, rng(`${day.seed}:hidden:v3`));
  const outcomes = day.events.map((ev, i) => drawOutcome(ev, rng(`${day.seed}:hidden-event:${i}:v3`)));
  day.events.forEach((ev, i) => applyEvent(hours, ev, outcomes[i]));
  return {hours: deepFreeze(hours), outcomes: deepFreeze(outcomes)};
}

/** Start hours an unresolved event could still have after hour h has been revealed. */
export function eligibleStarts(ev, h) {
  const starts = [];
  for (let s = ev.window[0]; s <= ev.window[1]; s++) if (s - ev.notice > h) starts.push(s);
  return starts;
}

function posterior(ev, h) {
  if (ev.prob >= 1) return 1;
  const frac = eligibleStarts(ev, h).length / (ev.window[1] - ev.window[0] + 1);
  return ev.prob * frac / (1 - ev.prob + ev.prob * frac);
}

/** Public warnings after hour h is revealed (h = -1 before the shift). Same for both players. */
export function warningsAt(day, outcomes, h) {
  return day.events.map((ev, i) => {
    const o = outcomes[i], end = Math.min(HOURS, o.start + o.duration);
    const base = {id: i, kind: ev.kind, title: ev.title, icon: ev.icon, detail: ev.detail, window: [...ev.window], notice: ev.notice, unit: ev.unit ?? null};
    if (o.occurs && h >= o.start) return {...base, status: h < end ? 'active' : 'over', prob: 1, start: o.start, end, amount: o.amount};
    if (o.occurs && ev.notice > 0 && h >= o.start - ev.notice) return {...base, status: 'confirmed', prob: 1, start: o.start, end};
    if (!o.occurs && h >= ev.window[1] - ev.notice) return {...base, status: 'cleared', prob: 0};
    return {...base, status: 'possible', prob: posterior(ev, h)};
  });
}

/** Latest revealed forecast errors, skipping hours a known event distorted. */
function revealedErrors(day, history, warnings) {
  const h = history.length - 1, f = day.forecast.hours;
  const hit = (kind, t) => warnings.some(w => w.kind === kind && (w.status === 'active' || w.status === 'over') && t >= w.start && t < w.end);
  const latest = (kind, persistence, error) => {
    for (let t = h; t >= 0; t--) if (!hit(kind, t)) return error(t) * persistence ** (h - t);
    return 0;
  };
  return {h,
    ed: latest('surge', 0.82, t => history[t].demand - f[t].demand),
    ew: latest('storm', 0.88, t => history[t].wind - f[t].wind),
    es: latest('fog', 0.85, t => (f[t].solar > 20 ? (history[t].solar / f[t].solar - 1) * 75 : 0))};
}

/** Plausible paths given only public information: forecast, revealed history and warnings. */
export function makeScenarios(day, history = [], warnings = [], count = 12, tag = 'planner') {
  const h = history.length - 1, start = h >= 0 ? revealedErrors(day, history, warnings) : null;
  return Array.from({length: count}, (_, i) => {
    const path = basePath(day, rng(`${day.seed}:${tag}:${h}:${i}:v3`), start);
    for (let t = 0; t <= h; t++) path[t] = {...history[t]};
    const r = rng(`${day.seed}:${tag}-events:${h}:${i}:v3`);
    warnings.forEach(w => {
      const ev = day.events[w.id], draw = drawOutcome(ev, r), occurs = r() < w.prob, pick = r();
      if (w.status === 'possible') {
        const starts = eligibleStarts(ev, h);
        if (starts.length) applyEvent(path, ev, {...draw, occurs, start: starts[Math.floor(pick * starts.length)]}, h + 1);
      } else if (w.status === 'confirmed' || w.status === 'active') {
        applyEvent(path, ev, {occurs: true, start: w.start, duration: w.end - w.start, amount: w.amount ?? draw.amount}, h + 1);
      }
    });
    return path;
  });
}
