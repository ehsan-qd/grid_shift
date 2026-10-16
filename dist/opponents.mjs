/** Opponents receive only public information: the day, warnings, revealed history and their own schedule. */
import {HOURS, FLEET, OPPONENTS, SCENARIOS} from './config.mjs';
import {STATES, NUCLEAR, dispatch, solve, gasCover, lockedBits, availableUnits, isOn} from './engine.mjs';
import {makeScenarios} from './world.mjs';

/** Each hour's cheapest mix at the forecast, ignoring start-ups: the classic beginner plan that cycles units. */
function rookiePlan(day) {
  const allowed = availableUnits(day.rules), n = allowed & NUCLEAR;
  return day.forecast.hours.map(a => {
    let pick = n, cost = Infinity;
    for (let m = 0; m < STATES; m++) {
      if (m & ~allowed || (m & NUCLEAR) !== n) continue;
      const d = dispatch(m, a), c = d.running + d.penalty;
      if (c < cost) { cost = c; pick = m; }
    }
    return pick;
  });
}

function dayAheadPlan(day, warnings, count) {
  return solve({paths: makeScenarios(day, [], warnings, count, 'planner'), rules: day.rules, recourseFrom: 0}).schedule;
}

function describe(day, history, next, before, plan) {
  const h = history.length - 1, a = history[h], f = day.forecast.hours[h], mask = next[h];
  const net = a.demand - a.wind - a.solar, forecastNet = f.demand - f.wind - f.solar, d = dispatch(mask, a);
  const changes = FLEET.flatMap((u, i) => (isOn(mask ^ plan[h], i) ? [`${u.id} ${isOn(mask, i) ? 'on' : 'off'}`] : []));
  const ordered = FLEET.flatMap((u, i) => (u.lead && next.some((m, t) => t > h && isOn(m ^ before[t], i)) ? [u.id] : []));
  return `Net demand ${Math.round(net)} MW (${net >= forecastNet ? '+' : ''}${Math.round(net - forecastNet)} vs forecast). `
    + `${changes.length ? `Changed ${changes.join(', ')} from its plan.` : 'Kept its plan.'} `
    + `${ordered.length ? `Re-ordered ${ordered.join(', ')} for later hours. ` : ''}${Math.round(d.spare)} MW spare.`;
}

/** `decide` returns the opponent's full schedule from the current hour on, honouring notice periods. */
export function createOpponent(level, day) {
  if (!OPPONENTS[level]) throw Error('Unknown opponent');
  const patcher = ({history, schedule, previousMask, plan}) => {
    const h = history.length - 1, next = [...schedule];
    next[h] = gasCover({mask: schedule[h], actual: history[h], previousMask, planMask: plan[h], rules: day.rules});
    return next;
  };
  return {
    level,
    name: OPPONENTS[level].name,
    plan(warnings) {
      if (level === 'rookie') return rookiePlan(day);
      return dayAheadPlan(day, warnings, level === 'operator' ? SCENARIOS.operator : SCENARIOS.orbit);
    },
    decide({warnings, history, schedule, previousMask = 0, plan}) {
      if (!history.length || history.length > HOURS) throw Error('Reveal a valid current hour first');
      const h = history.length - 1;
      let next;
      if (level === 'orbit') {
        const fixed = Array.from({length: HOURS}, (_, t) => {
          const bits = t >= h ? lockedBits(t, h, day.rules) : 0;
          return {bits, value: schedule[t] & bits};
        });
        const paths = makeScenarios(day, history, warnings, SCENARIOS.orbit, 'orbit');
        const solved = solve({paths, from: h, previousMask, plan, fixed, rules: day.rules, recourseFrom: h + 1}).schedule;
        next = schedule.map((m, t) => (t < h ? m : solved[t]));
      } else next = patcher({history, schedule, previousMask, plan});
      return {schedule: next, reason: describe(day, history, next, schedule, plan)};
    },
  };
}
