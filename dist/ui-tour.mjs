/** A ~30-second interactive tour with its own example and clock. It never touches the live game. */
import {buildTourExample} from './support.mjs';
import {timelineData, needBand} from './experience.mjs';
import {dispatch, unitNames} from './engine.mjs';
import {number, pounds, signedPounds, percent, starMarkup, escapeHtml} from './ui-format.mjs';
import {timelineChart, costRace} from './ui-charts.mjs';

const CAPTIONS = [
  ['See the whole shift.', 'Bars are your generators meeting demand. The shaded band is the likely range of demand your units must cover, given weather uncertainty.'],
  ['Commit. Then run.', 'Pick a starting plan and commit. Run carries you through quiet hours; Skip races to the next decision.'],
  ['Surprise: the wind drops.', ''],
  ['Choose your move.', ''],
  ['Warnings stop the clock.', 'Storms are confirmed two hours ahead; Ironbridge coal needs exactly two hours’ notice. Probabilities update as the day unfolds.'],
  ['Graded against perfect hindsight.', 'Stars measure efficiency against the best possible shift for that exact weather, so a stormy day never drags your grade down.'],
];

export function createTour({dialog, onOpen, onClose}) {
  let data = null, step = 0, frame = 0, auto = true, timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function schedule() {
    clear();
    if (!auto || !dialog.open || step === CAPTIONS.length - 1) return;
    if ([1, 3].includes(step) && frame === 0) timers.push(setTimeout(() => { frame = 1; render(); }, 1600));
    timers.push(setTimeout(() => { step++; frame = 0; render(); schedule(); }, step === 3 ? 6500 : 4800));
  }

  function chart(rows, current, band = null, warnings = []) {
    return `<section class="panel dispatch-panel">${timelineChart(rows, {selected: current ?? 0, current, band, warnings, id: 'tour', interactive: false})}</section>`;
  }

  function render() {
    const d = data, gap = dispatch(d.plan[0], d.surprise).shortage, windDrop = d.expected.wind - d.surprise.wind;
    const live = step >= 2 && step <= 3, fixed = step === 3 && frame === 1;
    const schedule0 = fixed ? d.fixed : d.plan;
    const rows = timelineData({day: d.day, schedule: schedule0, history: live ? [d.surprise] : [], ledger: []});
    let visual;
    if (step === 5) {
      visual = `<div class="tour-score"><span>EXAMPLE PLAYER ${starMarkup(d.humanScore.stars, false)}<b>${percent(d.humanScore.efficiency)}</b></span><span>ORBIT ${starMarkup(d.orbitScore.stars, false)}<b>${percent(d.orbitScore.efficiency)}</b></span></div>
        ${costRace([{label: 'Example player', rows: d.human, color: 'var(--yellow)'}, {label: 'ORBIT', rows: d.orbit, color: 'var(--cyan)'}], {baseline: d.best})}`;
    } else if (step === 4) {
      const warning = [{id: 0, kind: 'storm', title: 'Storm front', icon: '≈', status: 'possible', prob: 0.65, window: [5, 8], detail: ''}];
      visual = `<div class="tour-stage-title"><span>08:00–20:00 · 12 HOURS</span><span>EXAMPLE WARNING</span></div>${chart(rows, null, needBand(d.day, [], []), warning)}
        <div class="tour-demo-controls"><span class="warning-chip possible"><b>≈ Storm front</b><span>65% · 13:00–17:00</span></span><button class="quiet" tabindex="-1">⏭ Skip</button><button class="primary" tabindex="-1">▶ Run shift</button></div>`;
    } else {
      const banner = live ? `<div class="event-banner ${fixed ? 'calm' : 'danger'}"><span class="event-symbol">${fixed ? '✓' : '≈'}</span><div><b>${fixed ? 'Power restored' : 'Wind drop · shift paused'}</b><span>${fixed ? `${unitNames(d.fixed[0] & ~d.plan[0])} bridges now; coal takes over next hour` : `${number(d.expected.wind)} → ${number(d.surprise.wind)} MW wind · ${number(gap)} MW short`}</span></div></div>`
        : '<div class="tour-stage-title"><span>08:00–20:00 · 12 HOURS</span><span>EXAMPLE SHIFT</span></div>';
      const controls = step === 0 ? '<span class="tag">BALANCED PLAN</span><span>Choose a starting plan, then commit.</span>'
        : step === 1 ? `<button class="primary ${frame ? '' : 'tour-focus'}" data-tour-act="animate">${frame ? '▶ Running through quiet hours' : 'Commit plan &amp; take control →'}</button>`
        : step === 2 ? '<span class="bad">The clock waits for you. No rush.</span>'
        : `<div class="option-cards tour-options">${d.options.map(o => `<button class="option ${o.kind} ${o.kind === 'coal' && !frame ? 'tour-focus' : ''} ${o.kind === 'coal' && frame ? 'chosen' : ''}" data-tour-act="animate" tabindex="-1"><span class="option-body"><b>${escapeHtml(o.title)}</b><small>${o.kind === 'hold' ? `${pounds(o.now.total)} this hour` : `${signedPounds(o.nowDelta)} now · ${signedPounds(o.restDelta)} to 20:00`}</small></span></button>`).join('')}</div>`;
      visual = `${banner}${chart(rows, live ? 0 : null, step === 0 ? needBand(d.day, [], []) : null)}<div class="tour-demo-controls">${controls}</div>`;
    }
    const caption = step === 2 ? `Wind is ${number(windDrop)} MW below forecast. The shift pauses with a ${number(gap)} MW gap. Blackouts cost £2,500 per MWh.`
      : step === 3 ? 'Each card shows its cost now and projected to 20:00. Gas is instant; coal is cheaper but needs notice, so gas can bridge until it arrives.' : CAPTIONS[step][1];
    dialog.innerHTML = `<div class="tour-head"><div><h2 id="tour-title">Grid Shift in 30 seconds</h2><span>INTERACTIVE EXAMPLE · YOUR SHIFT IS SAFE</span></div><button class="text-button" data-tour-act="close">${step === 5 ? 'Close' : 'Skip tour'}</button></div>
      <div class="tour-stage">${visual}</div>
      <div class="tour-caption" aria-live="polite"><h3>${CAPTIONS[step][0]}</h3><p>${caption}</p></div>
      <div class="tour-nav"><div class="tour-dots" aria-label="Step ${step + 1} of ${CAPTIONS.length}">${CAPTIONS.map((c, i) => `<i class="${step === i ? 'active' : ''}"></i>`).join('')}</div>
        <div class="tour-buttons">${step === 5 ? '<button class="quiet" data-tour-act="replay">↺ Replay</button><button class="primary" data-tour-act="close">Back to the game →</button>'
          : `<button class="quiet" data-tour-act="back" ${step ? '' : 'disabled'}>← Back</button><button class="quiet" data-tour-act="pause">${auto ? 'Ⅱ Pause' : '▶ Play'}</button><button class="primary" data-tour-act="next">Next →</button>`}</div></div>`;
  }

  function open() {
    onOpen();
    data ??= buildTourExample();
    step = 0; frame = 0; auto = !reduced();
    render();
    dialog.showModal();
    schedule();
  }
  function close() { clear(); dialog.close(); onClose(); }

  dialog.addEventListener('click', e => {
    const el = e.target.closest('[data-tour-act]');
    if (!el) return;
    const act = el.dataset.tourAct;
    if (act === 'close') return close();
    if (act === 'animate') { frame = 1; render(); schedule(); }
    if (act === 'next') { step = Math.min(CAPTIONS.length - 1, step + 1); frame = 0; render(); schedule(); }
    if (act === 'back') { step = Math.max(0, step - 1); frame = 0; render(); schedule(); }
    if (act === 'pause') { auto = !auto; render(); schedule(); }
    if (act === 'replay') { step = 0; frame = 0; auto = !reduced(); render(); schedule(); }
  });
  dialog.addEventListener('close', clear);
  dialog.addEventListener('cancel', clear);
  return {open, close};
}
