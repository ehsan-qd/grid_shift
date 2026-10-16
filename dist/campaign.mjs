/** Ten hand-made days that introduce one mechanic at a time, plus the daily shared code. */
import {FLEET} from './config.mjs';

const bit = id => 1 << FLEET.findIndex(u => u.id === id);
const NO_COAL = bit('C1') | bit('C2');

export const CAMPAIGN = Object.freeze([
  {id: 'C01', seed: 'CAMPAIGN-01', title: 'First light', opponent: 'rookie', goal: {stars: 1},
    lesson: 'Plan the shift, commit, then cover any gap with gas.',
    brief: 'Just nuclear and gas, no wind or sun. Demand is predictable. Learn to plan, commit and cover.',
    config: {archetypes: [], rules: {disabled: NO_COAL, wind: false, solar: false, leadTimes: false, errorScale: 0.4, demandScale: 0.8}}},
  {id: 'C02', seed: 'CAMPAIGN-02', title: 'Coal comes online', opponent: 'rookie', goal: {stars: 1},
    lesson: 'Coal is cheap to run but expensive to start. Start it once and keep it.',
    brief: 'Two coal plants join the fleet. Cheap fuel, costly start-ups: decide early which ones run.',
    config: {archetypes: [], rules: {wind: false, solar: false, leadTimes: false, errorScale: 0.6}}},
  {id: 'C03', seed: 'CAMPAIGN-03', title: 'Wind on the wires', opponent: 'rookie', goal: {stars: 2},
    lesson: 'Wind is free but misses its forecast. Watch the shaded band.',
    brief: 'The wind farms connect. Their output is free, but forecasts drift for hours at a time.',
    config: {archetypes: [], rules: {solar: false, leadTimes: false, errorScale: 0.9}}},
  {id: 'C04', seed: 'CAMPAIGN-04', title: 'Sun and fog', opponent: 'operator', goal: {stars: 2},
    lesson: 'Warnings carry probabilities. Plan for the likely case, keep a way out for the other.',
    brief: 'Solar arrives, and so does a fog warning. If it settles, the morning sun is lost.',
    config: {archetypes: ['fog'], rules: {leadTimes: false, errorScale: 1}, events: {fog: {prob: 0.7}}}},
  {id: 'C05', seed: 'CAMPAIGN-05', title: 'Slow coal', opponent: 'operator', goal: {stars: 2},
    lesson: 'Coal needs notice: Moorfield one hour, Ironbridge two. Gas is instant but dear.',
    brief: 'From today, coal plants need notice to switch. Gas stays instant. Think one move ahead.',
    config: {archetypes: [], rules: {}}},
  {id: 'C06', seed: 'CAMPAIGN-06', title: 'Heatwave', opponent: 'operator', goal: {stars: 2, reliability: true},
    lesson: 'Big peaks need capacity committed before they arrive.',
    brief: 'Air-conditioning pushes the evening peak later and higher. Keep every light on.',
    config: {archetypes: ['heatwave'], rules: {}}},
  {id: 'C07', seed: 'CAMPAIGN-07-1', title: 'Faulty pump', opponent: 'operator', goal: {stars: 2},
    lesson: 'When a plant may trip, know which unit replaces it and how much notice it needs.',
    brief: 'Ironbridge is running on a faulty pump. A vibration alarm gives one hour before it trips.',
    config: {archetypes: ['trip'], rules: {}, events: {trip: {prob: 0.65}}}},
  {id: 'C08', seed: 'CAMPAIGN-08-1', title: 'Storm warning', opponent: 'orbit', goal: {stars: 2},
    lesson: 'A confirmed storm gives two hours. Ironbridge needs exactly two.',
    brief: 'A storm front could shut the wind farms down. It will be confirmed two hours ahead.',
    config: {archetypes: ['storm'], rules: {}, events: {storm: {prob: 0.75}}}},
  {id: 'C09', seed: 'CAMPAIGN-09', title: 'Cup final', opponent: 'orbit', goal: {stars: 2, reliability: true},
    lesson: 'Known surges are planning problems, not surprises.',
    brief: 'A heatwave evening and a cup final. The final whistle sends demand surging.',
    config: {archetypes: ['heatwave', 'surge'], rules: {}}},
  {id: 'C10', seed: 'CAMPAIGN-10-16', title: 'The full grid', opponent: 'orbit', goal: {stars: 2, carbon: true},
    lesson: 'Everything at once. Cheap, clean and reliable rarely line up. Choose.',
    brief: 'Storm risk, a faulty pump and a carbon budget. Beat ORBIT at its own game.',
    config: {archetypes: ['storm', 'trip'], rules: {}}},
].map(day => Object.freeze({...day, config: {...day.config, title: day.title, brief: day.brief}})));

export const campaignDay = id => CAMPAIGN.find(d => d.id === id) ?? null;

export function goalMet(goal, score) {
  return score.stars >= (goal.stars ?? 0) && (!goal.reliability || score.medals.reliability) && (!goal.carbon || score.medals.carbon);
}

export function describeGoal(goal) {
  return [`${'★'.repeat(goal.stars)} or better`, goal.reliability ? 'Lights on (no unserved demand)' : null, goal.carbon ? 'Under the carbon budget' : null].filter(Boolean).join(' · ');
}

/** progress: {C01: {stars, efficiency, done}}. A day unlocks when the previous goal is met. */
export function campaignTrack(progress = {}) {
  return CAMPAIGN.map((day, i) => ({...day, unlocked: i === 0 || Boolean(progress[CAMPAIGN[i - 1].id]?.done), result: progress[day.id] ?? null}));
}

export function nextCampaignDay(progress = {}) {
  const track = campaignTrack(progress);
  return track.find(d => d.unlocked && !d.result?.done) ?? track.at(-1);
}

export function dailyCode(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `DAY-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
