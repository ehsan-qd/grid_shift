/** A shift. The hidden realization and the opponent's plan live only inside this closure. */
import {HOURS} from './config.mjs';
import {settle, validatePlan, checkSchedule} from './engine.mjs';
import {makeDay, makeRealization, warningsAt} from './world.mjs';
import {createOpponent} from './opponents.mjs';

const copyRow = l => ({...l, actual: {...l.actual}, outputs: [...l.outputs]});

export function createSession({seed, config = null, opponent = 'orbit'} = {}) {
  const day = makeDay(seed, config), {hours: actual, outcomes} = makeRealization(day), rival = createOpponent(opponent, day);
  let plan = null, schedule = null, ledger = [], history = [], hour = 0;
  let rivalPlan = null, rivalSchedule = null, rivalLedger = [], rivalNotes = [];
  const revealedHour = () => (plan ? hour : -1);

  function view() {
    const complete = Boolean(plan) && hour === HOURS;
    return {
      hour, complete, started: Boolean(plan),
      actual: plan && hour < HOURS ? {...actual[hour]} : null,
      history: history.map(a => ({...a})),
      warnings: warningsAt(day, outcomes, revealedHour()),
      plan: plan ? [...plan] : null,
      schedule: schedule ? [...schedule] : null,
      ledger: ledger.map(copyRow),
      opponent: {level: rival.level, name: rival.name},
      ...(complete ? {rivalPlan: [...rivalPlan], rivalLedger: rivalLedger.map(copyRow), rivalNotes: [...rivalNotes], actualDay: actual.map(a => ({...a}))} : {}),
    };
  }

  return {
    day,
    view,
    start(submitted) {
      if (plan) throw Error('Already started');
      validatePlan(submitted, day.rules);
      plan = Object.freeze([...submitted]);
      schedule = [...plan];
      rivalPlan = Object.freeze(rival.plan(warningsAt(day, outcomes, -1)));
      rivalSchedule = [...rivalPlan];
      history = [{...actual[0]}];
      return view();
    },
    /** Accepts a full schedule (hours before the live hour are ignored) or one mask for the live hour. */
    settle(next) {
      if (!plan || hour >= HOURS) throw Error('No active hour');
      const proposed = Array.isArray(next) ? schedule.map((m, t) => (t < hour ? m : next[t])) : schedule.map((m, t) => (t === hour ? next : m));
      checkSchedule(proposed, schedule, hour, day.rules);
      const previous = ledger.at(-1)?.mask ?? 0, rivalPrevious = rivalLedger.at(-1)?.mask ?? 0;
      const decision = rival.decide({warnings: warningsAt(day, outcomes, hour), history: history.map(a => ({...a})),
        schedule: [...rivalSchedule], previousMask: rivalPrevious, plan: rivalPlan});
      checkSchedule(decision.schedule, rivalSchedule, hour, day.rules);
      schedule = proposed;
      rivalSchedule = decision.schedule;
      ledger.push(settle({hour, mask: schedule[hour], previousMask: previous, planMask: plan[hour], actual: actual[hour]}));
      rivalLedger.push(settle({hour, mask: rivalSchedule[hour], previousMask: rivalPrevious, planMask: rivalPlan[hour], actual: actual[hour]}));
      rivalNotes.push(decision.reason);
      hour++;
      if (hour < HOURS) history.push({...actual[hour]});
      return view();
    },
  };
}
