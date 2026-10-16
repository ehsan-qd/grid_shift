/** Grid Shift physics and accounting: deterministic, browser-local. Money is illustrative GBP. */
import {HOURS, FLEET, SHORTAGE, DEFAULT_RULES, PRESET_LOOKAHEAD} from './config.mjs';

export const STATES = 1 << FLEET.length;
export const ALL_UNITS = STATES - 1;
const typeMask = type => FLEET.reduce((m, u, i) => (u.type === type ? m | (1 << i) : m), 0);
export const NUCLEAR = typeMask('Nuclear');
export const COAL = typeMask('Coal');
export const GAS = typeMask('Gas');

export const isOn = (mask, i) => ((mask >> i) & 1) === 1;
export const validMask = m => Number.isInteger(m) && m >= 0 && m < STATES;
export const capacity = m => FLEET.reduce((s, u, i) => s + (isOn(m, i) ? u.capacity : 0), 0);
export const changeCost = (m, p) => FLEET.reduce((s, u, i) => s + (isOn(m ^ p, i) ? u.change : 0), 0);
export const startupCost = (m, p) => FLEET.reduce((s, u, i) => s + (isOn(m & ~p, i) ? u.startup : 0), 0);
export const unitNames = mask => FLEET.filter((u, i) => isOn(mask, i)).map(u => u.id).join(' + ') || 'None';
export const availableUnits = (rules = DEFAULT_RULES) => ALL_UNITS & ~(rules.disabled ?? 0);

/** Hours of notice unit i needs during the shift (Infinity = fixed for the shift). */
export function leadTime(i, rules = DEFAULT_RULES) {
  const lead = FLEET[i].lead;
  if (lead === null) return Infinity;
  return rules.leadTimes === false ? 0 : lead;
}
/** Earliest hour unit i can be changed when hour h is live. */
export const editableFrom = (i, h, rules) => h + leadTime(i, rules);
/** Bits that may no longer change at hour t when hour h is live. */
export const lockedBits = (t, h, rules) => FLEET.reduce((m, u, i) => (t < editableFrom(i, h, rules) ? m | (1 << i) : m), 0);

/** Renewables first, then ascending variable cost. Tripped units produce nothing. */
export function dispatch(mask, actual) {
  if (!validMask(mask)) throw Error('Invalid commitment mask');
  for (const k of ['demand', 'wind', 'solar']) if (!Number.isFinite(actual[k]) || actual[k] < 0) throw Error('Invalid conditions');
  const effective = mask & ~(actual.outage ?? 0);
  const available = actual.wind + actual.solar, renewable = Math.min(actual.demand, available);
  const windUsed = available ? renewable * actual.wind / available : 0, solarUsed = renewable - windUsed;
  let remaining = actual.demand - renewable, running = 0, emissions = 0;
  const outputs = FLEET.map((u, i) => {
    if (!isOn(effective, i)) return 0;
    const p = Math.min(remaining, u.capacity);
    remaining -= p; running += u.fixed + p * u.rate; emissions += p * u.co2;
    return p;
  });
  const shortage = Math.max(0, remaining), brownout = Math.min(shortage, SHORTAGE.brownoutShare * actual.demand), blackout = shortage - brownout;
  const conventional = outputs.reduce((s, v) => s + v, 0);
  return {effective, outputs, windUsed, solarUsed, renewable, conventional, served: renewable + conventional, shortage, brownout, blackout,
    curtailment: available - renewable, spare: Math.max(0, capacity(effective) - conventional), running, emissions,
    penalty: brownout * SHORTAGE.brownoutPrice + blackout * SHORTAGE.blackoutPrice};
}

/** One settled hour. `mask` in the record is what actually ran (tripped units removed). */
export function settle({hour, mask, previousMask = 0, planMask = mask, actual}) {
  const d = dispatch(mask, actual), out = actual.outage ?? 0;
  const startup = startupCost(d.effective, previousMask), adjustment = changeCost(mask & ~out, planMask & ~out);
  return {hour, ...d, mask: d.effective, requested: mask, planMask, previousMask, actual: {...actual}, startup, adjustment,
    total: d.running + startup + adjustment + d.penalty};
}

export function summarize(ledger) {
  const keys = ['running', 'startup', 'adjustment', 'penalty', 'total', 'shortage', 'brownout', 'blackout', 'emissions', 'curtailment', 'served', 'renewable'];
  return Object.fromEntries(keys.map(k => [k, ledger.reduce((s, l) => s + l[k], 0)]));
}

export function validatePlan(plan, rules = DEFAULT_RULES) {
  if (!Array.isArray(plan) || plan.length !== HOURS || !plan.every(validMask)) throw Error('Invalid plan');
  if (plan.some(m => m & ~availableUnits(rules))) throw Error('Invalid plan: unit not in service');
  if (plan.some(m => (m & NUCLEAR) !== (plan[0] & NUCLEAR))) throw Error('Invalid plan: nuclear runs all shift or not at all');
}

/** Rejects edits to hours that are inside a unit's notice period. */
export function checkSchedule(next, current, h, rules = DEFAULT_RULES) {
  if (!Array.isArray(next) || next.length !== HOURS) throw Error('Invalid schedule');
  for (let t = h; t < HOURS; t++) {
    if (!validMask(next[t])) throw Error('Invalid schedule');
    if (next[t] & ~availableUnits(rules)) throw Error('Unit not in service');
    if ((next[t] ^ current[t]) & lockedBits(t, h, rules)) throw Error('Locked: that change needs more notice');
  }
}

/** Switch unit i to `value` from hour `from` until the schedule already had it that way. */
export function flipRun(schedule, i, from, value) {
  const next = [...schedule];
  for (let t = from; t < HOURS && isOn(next[t], i) !== value; t++) next[t] ^= 1 << i;
  return next;
}

/** Hour cost of every mask on one path; with `recourse`, each mask is first patched with the cheapest instant gas. */
function maskCosts(actual, planMask, allowed, recourse) {
  const out = actual.outage ?? 0, raw = new Float64Array(STATES).fill(Infinity);
  for (let m = 0; m < STATES; m++) {
    if (m & ~allowed) continue;
    const d = dispatch(m, actual);
    raw[m] = d.running + d.penalty + (planMask === null ? 0 : changeCost(m & ~out, planMask & ~out));
  }
  if (!recourse) return raw;
  const patched = new Float64Array(raw), gas = GAS & allowed & ~out;
  for (let m = 0; m < STATES; m++) {
    if (raw[m] === Infinity) continue;
    const free = gas & ~m;
    for (let add = free; add; add = (add - 1) & free) patched[m] = Math.min(patched[m], raw[m | add] + startupCost(add, 0));
  }
  return patched;
}

/** Exact DP over the 64 commitment states, averaging hour costs across `paths`.
 * `fixed[t]` = {bits, value} pins bits at hour t. Plan-change charges apply when `plan` is given.
 * From hour `recourseFrom` on, each schedule is valued as if gaps on a path will be patched with gas
 * (a two-stage approximation); earlier hours are already known, so nothing patches them. */
function dp({paths, from, to = HOURS, previousMask, plan, fixed, allowed, recourseFrom}) {
  let cost = new Float64Array(STATES).fill(Infinity);
  cost[previousMask] = 0;
  const back = [];
  for (let t = from; t < to; t++) {
    const stage = new Float64Array(STATES).fill(Infinity), out = paths[0][t].outage ?? 0, outBefore = t > from ? paths[0][t - 1].outage ?? 0 : 0;
    const perPath = paths.map(p => maskCosts(p[t], plan ? plan[t] : null, allowed, t >= recourseFrom));
    for (let m = 0; m < STATES; m++) {
      if (m & ~allowed || (fixed?.[t] && (m & fixed[t].bits) !== fixed[t].value)) continue;
      stage[m] = perPath.reduce((s, c) => s + c[m], 0) / paths.length;
    }
    const next = new Float64Array(STATES).fill(Infinity), via = new Int8Array(STATES);
    for (let m = 0; m < STATES; m++) {
      if (stage[m] === Infinity) continue;
      for (let p = 0; p < STATES; p++) {
        if (cost[p] === Infinity) continue;
        const c = cost[p] + startupCost(m & ~out, p & ~outBefore) + stage[m];
        if (c < next[m]) { next[m] = c; via[m] = p; }
      }
    }
    back.push(via);
    cost = next;
  }
  let best = 0;
  for (let m = 1; m < STATES; m++) if (cost[m] < cost[best]) best = m;
  const expectedCost = cost[best], schedule = Array(HOURS).fill(0);
  for (let i = back.length - 1; i >= 0; i--) { schedule[from + i] = best; best = back[i][best]; }
  return {schedule, expectedCost};
}

/** Best schedule for the given paths. At the start of a shift it also chooses whether nuclear runs. */
export function solve({paths, from = 0, to = HOURS, previousMask = 0, plan = null, fixed = null, rules = DEFAULT_RULES, recourseFrom = Infinity}) {
  const allowed = availableUnits(rules);
  if (from > 0 || fixed) return dp({paths, from, to, previousMask, plan, fixed, allowed, recourseFrom});
  const options = [0, NUCLEAR].filter(n => (n & allowed) === n).map(n =>
    dp({paths, from, to, previousMask, plan, allowed, recourseFrom, fixed: Array.from({length: HOURS}, () => ({bits: NUCLEAR, value: n}))}));
  return options.reduce((a, b) => (b.expectedCost < a.expectedCost ? b : a));
}

/** Starter plans: a simple aid that looks only PRESET_LOOKAHEAD hours ahead at the central forecast plus a margin.
 * Nuclear is decided once for the shift. No scenarios, no events. */
export function starterPlan(day, margin = 50, lookahead = PRESET_LOOKAHEAD) {
  const padded = day.forecast.hours.map(a => ({...a, demand: a.demand + margin}));
  const n = solve({paths: [padded], rules: day.rules}).schedule[0] & NUCLEAR, plan = [];
  const fixed = Array.from({length: HOURS}, () => ({bits: NUCLEAR, value: n}));
  for (let t = 0, prev = 0; t < HOURS; t++) {
    plan[t] = dp({paths: [padded], from: t, to: Math.min(HOURS, t + lookahead), previousMask: prev, fixed, allowed: availableUnits(day.rules), recourseFrom: Infinity}).schedule[t];
    prev = plan[t];
  }
  return plan;
}

/** Cheapest set of gas units to add this hour (instant start). Never removes a unit. */
export function gasCover({mask, actual, previousMask = 0, planMask = mask, rules = DEFAULT_RULES}) {
  if (dispatch(mask, actual).shortage < 1e-9) return mask;
  const free = availableUnits(rules) & GAS & ~mask & ~(actual.outage ?? 0);
  let best = mask, bestCost = settle({hour: 0, mask, previousMask, planMask, actual}).total;
  for (let add = free; add; add = (add - 1) & free) {
    const cost = settle({hour: 0, mask: mask | add, previousMask, planMask, actual}).total;
    if (cost < bestCost - 1e-9) { best = mask | add; bestCost = cost; }
  }
  return best;
}
