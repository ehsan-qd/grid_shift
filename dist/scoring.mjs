/** Grading against perfect hindsight, medals, coaching and share text. Runs only after a shift is complete. */
import {HOURS, FLEET, STAR_THRESHOLDS, CARBON_TARGET_SHARE} from './config.mjs';
import {STATES, NUCLEAR, solve, settle, summarize, dispatch, startupCost, changeCost, availableUnits, leadTime, isOn} from './engine.mjs';
import {clockLabel} from './world.mjs';

const settleSchedule = (schedule, hours, plan = schedule) => {
  let previousMask = 0;
  return schedule.map((mask, t) => {
    const row = settle({hour: t, mask, previousMask, planMask: plan[t], actual: hours[t]});
    previousMask = row.mask;
    return row;
  });
};

/** Cheapest possible shift with perfect knowledge of the day (no plan-change charges, no notice limits). */
export function hindsight(day, actualHours) {
  const {schedule} = solve({paths: [actualHours], rules: day.rules});
  const ledger = settleSchedule(schedule, actualHours);
  return {schedule, ledger, total: summarize(ledger).total};
}

/** Carbon medal target, set by the actual weather like the efficiency grade. */
export const carbonTarget = bestLedger => Math.round(summarize(bestLedger).emissions * CARBON_TARGET_SHARE);

/** Public estimate of the carbon target before the shift: the same rule applied to the forecast. */
export function carbonEstimate(day) {
  const {schedule} = solve({paths: [day.forecast.hours], rules: day.rules});
  return Math.round(summarize(settleSchedule(schedule, day.forecast.hours)).emissions * CARBON_TARGET_SHARE);
}

export const starsFor = efficiency => STAR_THRESHOLDS.filter(t => efficiency >= t - 1e-9).length;

export function scoreShift({ledger, best, budget}) {
  const total = summarize(ledger), efficiency = Math.min(1, best / Math.max(1, total.total));
  return {total: total.total, best, efficiency, stars: starsFor(efficiency), emissions: total.emissions, budget,
    medals: {reliability: total.shortage < 1e-6, carbon: total.emissions <= budget + 1e-9}, blackout: total.blackout, brownout: total.brownout};
}

const describeMove = (from, to, t, rules) => FLEET.flatMap((u, i) => {
  if (!isOn(from ^ to, i)) return [];
  if (!isOn(to, i)) return [`stand down ${u.id}`];
  const lead = leadTime(i, rules);
  return [`run ${u.id}${Number.isFinite(lead) && lead > 0 && t - lead >= 0 ? ` (order it by ${clockLabel(t - lead)})` : ''}`];
});

function conditionNote(day, a, t) {
  const f = day.forecast.hours[t], parts = [];
  if (Math.abs(a.wind - f.wind) >= 30) parts.push(`wind was ${Math.round(Math.abs(a.wind - f.wind))} MW ${a.wind < f.wind ? 'below' : 'above'} forecast`);
  if (Math.abs(a.solar - f.solar) >= 30) parts.push(`solar was ${Math.round(Math.abs(a.solar - f.solar))} MW ${a.solar < f.solar ? 'below' : 'above'} forecast`);
  if (Math.abs(a.demand - f.demand) >= 25) parts.push(`demand was ${Math.round(Math.abs(a.demand - f.demand))} MW ${a.demand > f.demand ? 'above' : 'below'} forecast`);
  if (a.outage) parts.push(`${FLEET.filter((u, i) => isOn(a.outage, i)).map(u => u.id).join(', ')} had tripped`);
  return parts.join(', ');
}

/** Per-hour regret against the hindsight-optimal continuation from the player's own state.
 * Regrets telescope: plan regret + Σ hourly regret = your total − hindsight total. */
export function coach({day, plan, ledger, actualHours}) {
  const ideal = hindsight(day, actualHours), idealSum = summarize(ideal.ledger);
  const n = plan[0] & NUCLEAR, allowed = availableUnits(day.rules);
  const masks = Array.from({length: STATES}, (_, m) => m).filter(m => !(m & ~allowed) && (m & NUCLEAR) === n);
  const base = actualHours.map((a, t) => {
    const row = new Float64Array(STATES).fill(Infinity);
    for (const m of masks) {
      const d = dispatch(m, a), out = a.outage ?? 0;
      row[m] = d.running + d.penalty + changeCost(m & ~out, plan[t] & ~out);
    }
    return row;
  });
  const eff = (m, t) => m & ~(actualHours[t].outage ?? 0);
  const q = (t, prev, m) => base[t][m] + startupCost(eff(m, t), prev) + V[t + 1][eff(m, t)];
  const V = Array.from({length: HOURS + 1}, () => new Float64Array(STATES));
  for (let t = HOURS - 1; t >= 0; t--) for (let prev = 0; prev < STATES; prev++) V[t][prev] = Math.min(...masks.map(m => q(t, prev, m)));
  const hours = ledger.map((l, t) => {
    const took = l.requested, regret = q(t, l.previousMask, took) - V[t][l.previousMask];
    const better = masks.reduce((a, m) => (q(t, l.previousMask, m) < q(t, l.previousMask, a) ? m : a), took);
    return {hour: t, regret, took, better};
  });
  const worst = hours.reduce((a, b) => (b.regret > a.regret ? b : a));
  const you = summarize(ledger);
  const tips = [
    {amount: you.startup - idealSum.startup, text: amount => `Starting units cost £${fmt(amount)} more than the best possible day. Fewer on/off cycles pay.`},
    {amount: you.adjustment, text: amount => `Plan changes cost £${fmt(amount)}. A plan closer to the day avoids these.`},
    {amount: you.penalty - idealSum.penalty, text: amount => `Brownouts and blackouts cost £${fmt(amount)}. Order slow units earlier when warnings firm up.`},
    {amount: idleCost(ledger) - idleCost(ideal.ledger), text: amount => `Units sat online at 0 MW for £${fmt(amount)} in standby charges.`},
    {amount: gasSpend(ledger) - gasSpend(ideal.ledger), text: amount => `You burned £${fmt(amount)} more on gas than needed; coal ordered earlier would have covered it for less.`},
  ].filter(t => t.amount > 400).sort((a, b) => b.amount - a.amount).slice(0, 3).map(t => t.text(t.amount));
  return {
    best: ideal.total, bestLedger: ideal.ledger, planRegret: V[0][0] - ideal.total, playRegret: you.total - V[0][0], hours,
    worst: worst.regret > 100 ? {...worst, moves: describeMove(worst.took, worst.better, worst.hour, day.rules), note: conditionNote(day, actualHours[worst.hour], worst.hour)} : null,
    tips,
  };
}
const fmt = n => Math.round(n).toLocaleString('en-GB');
const idleCost = ledger => ledger.reduce((s, l) => s + FLEET.reduce((a, u, i) => a + (isOn(l.mask, i) && l.outputs[i] < 1e-9 ? u.fixed : 0), 0), 0);
const gasSpend = ledger => ledger.reduce((s, l) => s + FLEET.reduce((a, u, i) => a + (u.type === 'Gas' ? l.outputs[i] * u.rate : 0), 0), 0);

export function shareText({seed, title, score, rival}) {
  const stars = '★'.repeat(score.stars) + '☆'.repeat(3 - score.stars);
  const medals = [score.medals.reliability ? 'Lights on' : null, score.medals.carbon ? 'Under carbon budget' : null].filter(Boolean);
  return [`⚡ Grid Shift · ${seed} (${title})`, `${stars} ${(score.efficiency * 100).toFixed(1)}% efficient${medals.length ? ` · ${medals.join(' · ')}` : ''}`,
    rival ? `${rival.name}: ${(rival.efficiency * 100).toFixed(1)}%` : ''].filter(Boolean).join('\n');
}
