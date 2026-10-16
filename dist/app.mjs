/** Grid Shift controller: state, persistence, actions and run control. Markup lives in ui-*.mjs. */
import {HOURS, RUN, PRESETS, OPPONENTS, FLEET} from './config.mjs';
import {settle, summarize, flipRun, editableFrom, isOn, NUCLEAR, starterPlan} from './engine.mjs';
import {makeDay, clockLabel} from './world.mjs';
import {scoreShift, carbonEstimate, carbonTarget, coach, shareText} from './scoring.mjs';
import {campaignDay, campaignTrack, nextCampaignDay, goalMet, dailyCode, CAMPAIGN} from './campaign.mjs';
import {restoreSaved, savedSnapshot, exportCsv, sessionFor} from './support.mjs';
import {timelineData, needBand, decisionOptions, hourStatus, warningChanges, needsIntervention, createProgression, streakFor} from './experience.mjs';
import {header, footer, homeView, planView, playView, resultsView} from './ui-views.mjs';
import {rulesDialog, forecastDialog, hourCostsDialog, detailsDialog, auditDialog, confirmShortageDialog, retryDialog, shareDialog} from './ui-dialogs.mjs';
import {createTour} from './ui-tour.mjs';

const q = s => document.querySelector(s), app = q('#app'), overlay = q('#overlay');
const STORE = {game: 'grid-shift-v3', prefs: 'grid-shift-prefs', bests: 'grid-shift-bests', campaign: 'grid-shift-campaign'};
let saveWorks = true;
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { saveWorks = false; } };
const newCode = () => `GS-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`;

let game = null, screen = 'home', migrated = false;
const prefs = {opponent: 'orbit', ...load(STORE.prefs, {})};
if (!OPPONENTS[prefs.opponent]) prefs.opponent = 'orbit';
const bests = load(STORE.bests, {}), progress = load(STORE.campaign, {});
let undoPlan = null, undoDraft = null, unitsOpen = {plan: true, play: false}, feedback = '', replay = 0, freeCode = newCode(), pendingStart = null, toastTimer = null;
let cache = {}, dailyCache = null;
const progression = createProgression();
let runTimer = null, fast = false, lastAdvanceAt = 0;

/* ---------- Persistence ---------- */

function save() {
  store(STORE.game, game ? {...savedSnapshot(game), screen} : null);
  store(STORE.prefs, prefs);
}
try {
  const saved = load(STORE.game, null), restored = restoreSaved(saved);
  if (restored) { game = {...restored, changes: []}; screen = saved.screen === 'home' ? 'home' : 'game'; }
  else migrated = Boolean(saved) || Boolean(localStorage.getItem('grid-shift-v2'));
} catch { /* storage blocked: play without it */ }

/* ---------- Derived state ---------- */

const day = () => game.session.day;
const budget = () => (cache.budget ??= carbonEstimate(day()));
const previousMask = () => game.view.ledger.at(-1)?.mask ?? 0;
function currentRow() {
  const v = game.view;
  return settle({hour: v.hour, mask: game.draft[v.hour], previousMask: previousMask(), planMask: game.plan[v.hour], actual: v.actual});
}
function planLedger() {
  let prev = 0;
  return game.plan.map((mask, t) => { const row = settle({hour: t, mask, previousMask: prev, actual: day().forecast.hours[t]}); prev = row.mask; return row; });
}
function band() {
  const key = `${game.seed}|${game.view.history.length}`;
  if (cache.bandKey !== key) { cache.band = needBand(day(), game.view.history, game.view.warnings); cache.bandKey = key; }
  return cache.band;
}
function options() {
  const v = game.view, key = `${v.hour}|${game.draft.join(',')}`;
  if (cache.optionsKey !== key) {
    cache.options = decisionOptions({day: day(), h: v.hour, actual: v.actual, schedule: game.draft, plan: game.plan, previousMask: previousMask(), history: v.history, warnings: v.warnings});
    cache.optionsKey = key;
  }
  return cache.options;
}
function results() {
  if (!cache.results) {
    const v = game.view, c = coach({day: day(), plan: v.plan, ledger: v.ledger, actualHours: v.actualDay}), target = carbonTarget(c.bestLedger);
    cache.results = {coach: c, score: scoreShift({ledger: v.ledger, best: c.best, budget: target}), rival: scoreShift({ledger: v.rivalLedger, best: c.best, budget: target}), isBest: false, previousBest: null};
  }
  return cache.results;
}
const bestKey = () => game.campaignId ?? `${game.seed}|${game.opponent}`;

function recordResult() {
  const r = results(), key = bestKey(), prev = bests[key] ?? null;
  r.previousBest = prev;
  r.isBest = !prev || r.score.efficiency > prev.efficiency + 1e-9;
  if (r.isBest) bests[key] = {efficiency: r.score.efficiency, stars: r.score.stars, total: r.score.total};
  store(STORE.bests, bests);
  if (game.campaignId) {
    const p = progress[game.campaignId] ?? {}, ok = goalMet(campaignDay(game.campaignId).goal, r.score);
    progress[game.campaignId] = {done: Boolean(p.done || ok), stars: Math.max(p.stars ?? 0, r.score.stars), efficiency: Math.max(p.efficiency ?? 0, r.score.efficiency)};
    store(STORE.campaign, progress);
  }
}

/* ---------- Rendering ---------- */

function homeContext() {
  const code = dailyCode();
  if (dailyCache?.code !== code) dailyCache = {code, day: makeDay(code)};
  const resume = game && {title: game.session.day.title, mode: game.mode, seed: game.seed, phase: game.phase, hour: game.view.hour};
  return {track: campaignTrack(progress), next: nextCampaignDay(progress), daily: {code, title: dailyCache.day.title, mission: dailyCache.day.mission}, resume, opponent: prefs.opponent, freeCode, bests};
}

function planContext() {
  const warnings = game.view.warnings, ledger = planLedger(), sum = summarize(ledger);
  return {game, warnings, selected: game.selected, preset: game.preset, undo: Boolean(undoPlan), unitsOpen: unitsOpen.plan, budget: budget(),
    rows: timelineData({day: day(), schedule: game.plan, warnings}), band: band(), planTotal: sum.total, planCarbon: sum.emissions, goal: campaignDay(game.campaignId)?.goal ?? null};
}

function playContext() {
  const v = game.view, h = v.hour, row = currentRow(), settled = summarize(v.ledger);
  const outageEnd = Object.fromEntries(v.warnings.filter(w => w.kind === 'trip' && w.status === 'active').map(w => [w.unit, w.end]));
  return {game, warnings: v.warnings, selected: game.selected, row, options: options(), band: band(), budget: budget(), outageEnd,
    rows: timelineData({day: day(), schedule: game.draft, history: v.history, ledger: v.ledger, warnings: v.warnings}),
    status: hourStatus(v.actual, day().forecast.hours[h], game.draft[h]), changes: game.changes ?? [], spend: settled.total, carbon: settled.emissions,
    streak: streakFor(v.ledger), feedback, running: progression.running, undo: undoDraft !== null, unitsOpen: unitsOpen.play};
}

function resultsContext() {
  const r = results(), goal = campaignDay(game.campaignId)?.goal ?? null, goalOk = goal ? goalMet(goal, r.score) : false;
  const index = CAMPAIGN.findIndex(d => d.id === game.campaignId), nextDay = goalOk && index >= 0 && index < CAMPAIGN.length - 1 ? CAMPAIGN[index + 1] : null;
  return {game, score: r.score, rival: r.rival, coach: r.coach, best: r.coach.best, replay, goal, goalOk, nextDay, isBest: r.isBest, previousBest: r.isBest ? null : bests[bestKey()] ?? null};
}

function render(focus = null) {
  const body = screen === 'home' || !game ? homeView(homeContext()) : game.phase === 'plan' ? planView(planContext()) : game.phase === 'play' ? playView(playContext()) : resultsView(resultsContext());
  app.innerHTML = `<div class="shell">${header(screen === 'home' || !game ? 'home' : 'game')}${body}${footer({game: screen === 'home' ? null : game, saveWorks})}</div>`;
  const form = q('#free-form');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const seed = q('#free-code').value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
    if (seed) requestStart({mode: 'free', seed, opponent: prefs.opponent});
  };
  const wrap = q('.timeline-wrap');
  if (wrap && game && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = (game.selected + 0.5) / HOURS * wrap.scrollWidth - wrap.clientWidth / 2;
  if (focus) q(focus)?.focus({preventScroll: true});
}

function toast(text) {
  clearTimeout(toastTimer);
  const el = q('#toast');
  el.textContent = text;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function openOverlay({title, body, actions = ''}) {
  pauseRun();
  render();
  overlay.innerHTML = `<div class="dialog-head"><h2 id="overlay-title">${title}</h2><button class="close" data-close aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div>${actions ? `<div class="dialog-actions">${actions}</div>` : ''}`;
  if (!overlay.open) overlay.showModal();
}

/* ---------- Game lifecycle ---------- */

function makeGame({mode, seed, campaignId = null, opponent}) {
  const session = sessionFor({seed, campaignId, opponent});
  return {mode, seed, campaignId, opponent, session, phase: 'plan', plan: starterPlan(session.day, PRESETS.balanced.margin), preset: 'balanced',
    settled: [], view: session.view(), draft: null, selected: 0, changes: []};
}

function requestStart(opts) {
  if (game && game.phase === 'play') {
    pendingStart = opts;
    openOverlay({title: 'Leave the current shift?', body: `<p>Your shift at ${clockLabel(game.view.hour)} will be replaced. Its progress isn't scored.</p>`,
      actions: '<button data-close>Keep playing</button><button class="primary" data-action="accept-start">Start the new shift</button>'});
    return;
  }
  begin(opts);
}

function begin(opts) {
  pauseRun();
  game = makeGame(opts);
  screen = 'game';
  undoPlan = null; undoDraft = null; feedback = ''; replay = 0; cache = {}; unitsOpen = {plan: true, play: false};
  save();
  render();
  window.scrollTo({top: 0});
}

function editPlan(next) {
  undoPlan = [...game.plan];
  game.plan = next;
  game.preset = 'custom';
  save();
}

/* ---------- Run control ---------- */

function pauseRun() { clearTimeout(runTimer); runTimer = null; progression.pause(); }

function scheduleRun() {
  clearTimeout(runTimer);
  if (!progression.running || game?.phase !== 'play') return;
  const ticket = progression.ticket(game.view.hour);
  runTimer = setTimeout(() => settleCurrent(ticket, true), fast ? RUN.skipMs : RUN.quietMs);
}

function startRun(isFast) {
  if (game.phase !== 'play') return;
  if (currentRow().shortage > 0.5) { action('settle'); return; }
  fast = isFast;
  progression.run(game.view.hour, {checkIn: !isFast});
  feedback = '';
  render();
  scheduleRun();
}

function settleCurrent(ticket, automatic = false) {
  if (game.phase !== 'play' || !progression.consume(ticket, game.view.hour)) return;
  const before = game.view, oldHour = before.hour;
  game.view = game.session.settle(game.draft);
  game.settled.push([...game.draft]);
  lastAdvanceAt = Date.now();
  undoDraft = null;
  const settledRow = game.view.ledger.at(-1);
  if (game.view.complete) {
    game.phase = 'results';
    replay = 0;
    pauseRun();
    recordResult();
  } else {
    const h = game.view.hour, f = day().forecast.hours;
    game.draft = [...game.view.schedule];
    game.selected = h;
    game.changes = warningChanges(before.warnings, game.view.warnings);
    const stop = !automatic || needsIntervention({actual: game.view.actual, forecast: f[h], mask: game.draft[h], previousActual: before.actual, previousForecast: f[h - 1],
      warnings: game.view.warnings, previousWarnings: before.warnings, previousShortage: settledRow.shortage});
    const wasRunning = progression.running;
    progression.arrived(h, {needsDecision: stop});
    feedback = stop ? '' : wasRunning && !progression.running ? 'Check-in · take a look ahead' : `Hour delivered · ${streakFor(game.view.ledger)} clean in a row`;
  }
  save();
  render();
  if (game.view.complete) window.scrollTo({top: 0});
  else scheduleRun();
  toast(game.view.complete ? '12 hours complete. Graded against perfect hindsight.'
    : `${clockLabel(oldHour)} ${settledRow.shortage > 0.5 ? 'settled with unserved demand' : 'delivered'} · ${'£' + Math.round(settledRow.total).toLocaleString('en-GB')}${progression.running ? '' : ' · paused'}`);
}

function advance() {
  if (Date.now() - lastAdvanceAt < 400) return;
  pauseRun();
  if (game.phase !== 'play') return;
  progression.run(game.view.hour);
  settleCurrent(progression.ticket(game.view.hour), false);
}

/* ---------- Edits ---------- */

function toggleUnit(i) {
  if (game.phase === 'plan') {
    const next = [...game.plan];
    if (isOn(NUCLEAR, i)) { const value = !isOn(next[0], i); for (let t = 0; t < HOURS; t++) next[t] = value ? next[t] | (1 << i) : next[t] & ~(1 << i); }
    else next[game.selected] ^= 1 << i;
    editPlan(next);
    render(`[data-unit="${i}"]`);
    return;
  }
  const h = game.view.hour, u = FLEET[i];
  if (isOn(NUCLEAR, i)) { toast('Nuclear runs all shift or not at all. That was decided in the plan.'); return; }
  const from = Math.max(game.selected, editableFrom(i, h, day().rules));
  if (from >= HOURS) { toast(`${u.id} needs ${u.lead} hours' notice. Too late to change it this shift.`); return; }
  pauseRun();
  undoDraft = [...game.draft];
  game.draft = flipRun(game.draft, i, from, !isOn(game.draft[from], i));
  feedback = '';
  if (from > game.selected) toast(`${u.id} needs notice: the change takes effect from ${clockLabel(from)}.`);
  save();
  render(`[data-unit="${i}"]`);
}

function applyOption(index) {
  const o = options()[index];
  if (!o || o.kind === 'hold') return;
  pauseRun();
  const before = currentRow();
  undoDraft = [...game.draft];
  game.draft = [...o.schedule];
  game.selected = game.view.hour;
  feedback = before.shortage > 0.5 && currentRow().shortage < 0.5 ? 'Power restored · nice recovery' : o.title;
  save();
  render();
  toast(feedback);
}

function share() {
  const r = results(), text = shareText({seed: game.seed, title: day().title, score: r.score, rival: {name: game.view.opponent.name, efficiency: r.rival.efficiency}});
  const fallback = () => openOverlay(shareDialog(text));
  try { navigator.clipboard.writeText(text).then(() => toast('Result copied. Paste it anywhere.'), fallback); } catch { fallback(); }
}

function download() {
  const csv = exportCsv(game.seed, game.view.ledger, game.view.rivalLedger, game.view.opponent.name);
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8;'})), a = document.createElement('a');
  a.href = url;
  a.download = `grid-shift-${game.seed.toLowerCase()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Downloaded 24 records: 12 for you, 12 for your opponent.');
}

function action(name, el = null) {
  switch (name) {
    case 'home': pauseRun(); screen = 'home'; save(); render(); window.scrollTo({top: 0}); break;
    case 'resume': screen = 'game'; save(); render(); break;
    case 'campaign': { const d = campaignDay(el?.dataset.day); if (d) requestStart({mode: 'campaign', seed: d.seed, campaignId: d.id, opponent: d.opponent}); break; }
    case 'daily': requestStart({mode: 'daily', seed: dailyCode(), opponent: prefs.opponent}); break;
    case 'accept-start': overlay.close(); if (pendingStart) begin(pendingStart); pendingStart = null; break;
    case 'tour': tour.open(); break;
    case 'rules': openOverlay(rulesDialog()); break;
    case 'forecast': openOverlay(forecastDialog(day(), game.view.history, game.view.warnings)); break;
    case 'units': unitsOpen[game.phase] = !unitsOpen[game.phase]; render('[data-action="units"]'); break;
    case 'undo-plan': if (undoPlan) { const previous = [...game.plan]; game.plan = [...undoPlan]; undoPlan = previous; game.preset = 'custom'; save(); render('[data-action="undo-plan"]'); toast('Plan edit undone.'); } break;
    case 'copy': editPlan(Array(HOURS).fill(game.plan[game.selected])); render('[data-action="copy"]'); toast(`${clockLabel(game.selected)} mix applied to all 12 hours.`); break;
    case 'start':
      if (game.phase !== 'plan') break;
      pauseRun();
      game.view = game.session.start(game.plan);
      game.phase = 'play'; game.settled = []; game.draft = [...game.view.schedule]; game.selected = 0; game.changes = [];
      undoDraft = null; feedback = ''; cache.bandKey = null;
      save(); render(); window.scrollTo({top: 0}); toast('Plan committed. Your shift is live.');
      break;
    case 'now': game.selected = game.view.hour; render(); break;
    case 'undo-draft': if (undoDraft) { pauseRun(); game.draft = undoDraft; undoDraft = null; feedback = 'Move undone'; save(); render(); } break;
    case 'reset-draft': pauseRun(); undoDraft = [...game.draft]; game.draft = [...game.view.schedule]; feedback = 'Changes reset'; save(); render(); break;
    case 'run': startRun(false); break;
    case 'skip': startRun(true); break;
    case 'pause': pauseRun(); render(); break;
    case 'settle': { if (game.phase !== 'play') break; pauseRun(); const row = currentRow(); if (row.shortage > 0.5) openOverlay(confirmShortageDialog(row)); else advance(); break; }
    case 'accept-shortage': overlay.close(); advance(); break;
    case 'hour-costs': openOverlay(hourCostsDialog(game.view.hour, currentRow())); break;
    case 'results-details': openOverlay(detailsDialog(game.view.ledger, game.view.rivalLedger, game.view.opponent.name, results().coach.bestLedger)); break;
    case 'audit': openOverlay(auditDialog(game.view.ledger, game.view.rivalLedger, game.view.opponent.name)); break;
    case 'download': download(); break;
    case 'share': share(); break;
    case 'copy-share': { const area = q('.share-text'); area?.select(); try { navigator.clipboard.writeText(area.value).then(() => toast('Copied.')); } catch { document.execCommand?.('copy'); } break; }
    case 'retry': openOverlay(retryDialog()); break;
    case 'accept-retry': overlay.close(); begin({mode: game.mode, seed: game.seed, campaignId: game.campaignId, opponent: game.opponent}); break;
  }
}

/* ---------- Events ---------- */

app.addEventListener('click', e => {
  const el = e.target.closest('button,[data-chart-hour]');
  if (!el || el.disabled) return;
  if (el.dataset.chartHour !== undefined) {
    const t = Number(el.dataset.chartHour);
    if (game.phase === 'play') { pauseRun(); game.selected = Math.max(game.view.hour, t); if (t < game.view.hour) toast('Settled hours can’t change. Showing the live hour.'); }
    else game.selected = t;
    save(); render();
  } else if (el.dataset.option !== undefined) applyOption(Number(el.dataset.option));
  else if (el.dataset.action) action(el.dataset.action, el);
  else if (el.dataset.replay !== undefined) { replay = Number(el.dataset.replay); render(`[data-replay="${replay}"]`); if (el.closest('.coach')) q('#replay')?.scrollIntoView({behavior: 'smooth'}); }
  else if (el.dataset.preset) {
    const key = el.dataset.preset;
    editPlan(starterPlan(day(), PRESETS[key].margin));
    game.preset = key;
    save(); render(`[data-preset="${key}"]`);
    toast(key === 'lean' ? 'Lean: no cushion, cheapest if the forecast holds.' : key === 'reserve' ? 'More reserve: extra capacity against surprises, at a standby cost.' : 'Balanced: a 50 MW cushion over the forecast.');
  } else if (el.dataset.opponent) { prefs.opponent = el.dataset.opponent; save(); render(`[data-opponent="${prefs.opponent}"]`); }
  else if (el.dataset.unit !== undefined) toggleUnit(Number(el.dataset.unit));
});

app.addEventListener('keydown', e => {
  const column = e.target.closest('[data-chart-hour]');
  if (column && ['Enter', ' '].includes(e.key)) { e.preventDefault(); column.dispatchEvent(new MouseEvent('click', {bubbles: true})); return; }
  const hourButton = e.target.closest('[data-replay]');
  if (hourButton && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); replay = (replay + (e.key === 'ArrowRight' ? 1 : -1) + HOURS) % HOURS; render(`[data-replay="${replay}"]`); }
});

overlay.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) overlay.close();
  else if (button.dataset.action) action(button.dataset.action, button);
});

const tour = createTour({dialog: q('#tour'), onOpen: () => { pauseRun(); render(); }, onClose: () => q('[data-action="tour"]')?.focus({preventScroll: true})});

document.addEventListener('visibilitychange', () => { if (document.hidden && progression.running) { pauseRun(); render(); } });

render();
if (migrated) toast('Grid Shift has new rules. Your previous shift was cleared.');
