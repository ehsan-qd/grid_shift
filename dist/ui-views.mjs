/** Screen markup. Every function takes explicit state and returns HTML; nothing here touches the DOM. */
import {HOURS, FLEET, PRESETS, OPPONENTS} from './config.mjs';
import {isOn, editableFrom, NUCLEAR} from './engine.mjs';
import {clockLabel} from './world.mjs';
import {describeGoal} from './campaign.mjs';
import {escapeHtml, number, pounds, signedPounds, percent, starMarkup, mixMarkup, warningLabel, ICONS, UNIT_COLORS, SOURCE_COLORS, SOURCE_LABELS} from './ui-format.mjs';
import {timelineChart, costRace, cityScene} from './ui-charts.mjs';

const MODE_LABEL = {campaign: 'Campaign', daily: "Today's shift", free: 'Free play'};

export function header(screen) {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="Grid Shift home"><span class="brand-mark" aria-hidden="true">ϟ</span><h1>GRID SHIFT</h1></button>
    <div class="top-actions"><button class="tour-trigger" data-action="tour">▶ Tour</button><button class="quiet" data-action="rules">Rules</button>${screen === 'home' ? '' : '<button class="quiet" data-action="home">Menu</button>'}</div></header>`;
}

export function footer({game, saveWorks}) {
  return `<footer class="footer"><span>${game ? `${escapeHtml(game.seed)} · ` : ''}${saveWorks ? 'Progress saved in this browser' : 'Saving unavailable'}</span><button class="text-button" data-action="rules">Costs, scoring &amp; opponents</button></footer>`;
}

function steps(game) {
  const index = ['plan', 'play', 'results'].indexOf(game.phase);
  return `<nav class="steps" aria-label="Shift stages"><div class="stages">${['Plan', 'Play', 'Results'].map((s, i) => `<span class="stage ${i === index ? 'active' : i < index ? 'done' : ''}" ${i === index ? 'aria-current="step"' : ''}><b>${i < index ? '✓' : i + 1}</b>${s}</span>`).join('')}</div>
    <span class="shift-label">${MODE_LABEL[game.mode]}${game.campaignId ? ` ${Number(game.campaignId.slice(1))}/10` : ''} · ${escapeHtml(game.seed)} · vs ${OPPONENTS[game.opponent].name}</span></nav>`;
}

function warningStrip(warnings, {compact = false} = {}) {
  if (!warnings.length) return compact ? '' : '<div class="warning-strip calm"><span class="warning-chip calm">✓ No warnings for this shift</span></div>';
  return `<div class="warning-strip" aria-label="Warnings">${warnings.map(w => `<span class="warning-chip ${w.status}" title="${escapeHtml(w.detail)}"><b>${w.icon} ${escapeHtml(w.title)}</b><span>${warningLabel(w)}</span></span>`).join('')}</div>`;
}

/* ---------- Home ---------- */

export function homeView({track, next, daily, resume, opponent, freeCode, bests}) {
  const done = track.filter(d => d.result?.done).length;
  return `<main id="main" class="home">
    <section class="hero"><span class="eyebrow">TWELVE HOURS · ONE CITY · EVERY MEGAWATT COSTS MONEY</span>
      <h2>Keep the lights on. Beat the cost.</h2>
      <p>Choose which power stations run, react to storms, fog, breakdowns and surges, and get graded against the best possible shift in hindsight.</p></section>
    ${resume ? `<section class="resume panel"><div><span class="eyebrow">SHIFT IN PROGRESS</span><h3>${escapeHtml(resume.title)}</h3><p>${MODE_LABEL[resume.mode]} · ${escapeHtml(resume.seed)} · ${resume.phase === 'plan' ? 'planning' : resume.phase === 'results' ? 'results ready' : `${clockLabel(resume.hour)}, hour ${resume.hour + 1} of 12`}</p></div><button class="primary" data-action="resume">Resume →</button></section>` : ''}
    <div class="mode-grid">
      <article class="mode-card campaign"><span class="eyebrow">CAMPAIGN · ${done}/10 COMPLETE</span><h3>Day ${Number(next.id.slice(1))}: ${escapeHtml(next.title)}</h3><p>${escapeHtml(next.brief)}</p>
        <ol class="track" aria-label="Campaign days">${track.map((d, i) => `<li><button class="track-day ${d.result?.done ? 'done' : ''} ${d.id === next.id ? 'next' : ''}" data-action="campaign" data-day="${d.id}" ${d.unlocked ? '' : 'disabled'} aria-label="Day ${i + 1}: ${escapeHtml(d.title)}${d.unlocked ? '' : ' (locked)'}${d.result ? `, best ${d.result.stars} stars` : ''}"><b>${i + 1}</b>${d.result ? starMarkup(d.result.stars, false) : d.unlocked ? '<span class="open">open</span>' : '<span class="lock">🔒</span>'}</button></li>`).join('')}</ol>
        <button class="primary" data-action="campaign" data-day="${next.id}">Play day ${Number(next.id.slice(1))} →</button></article>
      <article class="mode-card daily"><span class="eyebrow">TODAY'S SHIFT · SAME DAY FOR EVERYONE</span><h3>${escapeHtml(daily.title)}</h3><p>${escapeHtml(daily.mission)}</p>
        <p class="code-line">${escapeHtml(daily.code)}${bests[`${daily.code}|${opponent}`] ? ` · your best ${starMarkup(bests[`${daily.code}|${opponent}`].stars, false)} ${percent(bests[`${daily.code}|${opponent}`].efficiency)}` : ''}</p>
        <button class="primary" data-action="daily">Play today →</button></article>
      <article class="mode-card free"><span class="eyebrow">FREE PLAY · ANY DAY CODE</span><h3>Pick a day</h3><p>Every code is a different forecast, weather and set of warnings. Share a code to race a friend.</p>
        <form id="free-form" class="seed-form"><label for="free-code">Day code</label><div class="seed-row"><input id="free-code" value="${escapeHtml(freeCode)}" maxlength="24" pattern="[A-Za-z0-9\\-]+" autocomplete="off" required><button class="primary" type="submit">Start →</button></div></form></article>
    </div>
    <section class="opponent-picker"><span class="eyebrow">OPPONENT FOR TODAY'S SHIFT AND FREE PLAY</span>
      <div class="segmented" role="radiogroup">${Object.entries(OPPONENTS).map(([key, o]) => `<button role="radio" aria-checked="${opponent === key}" data-opponent="${key}"><b>${o.name}</b><small>${o.blurb}</small></button>`).join('')}</div></section>
  </main>`;
}

/* ---------- Shared panels ---------- */

function chartPanel({rows, selected, current, band, warnings, phase, liveHour}) {
  const r = rows[selected];
  return `<section class="panel dispatch-panel"><div class="chart-heading"><h3>Demand &amp; generation</h3><div class="line-legend"><span class="dashed" style="--color:var(--yellow)">Forecast demand</span><span style="--color:#fff">Actual demand</span><span class="band-key">Likely need</span></div></div>
    ${timelineChart(rows, {selected, current, band, warnings})}
    <div class="chart-legend">${SOURCE_LABELS.map((label, i) => `<span style="--color:${SOURCE_COLORS[i]}">${label}</span>`).join('')}<span class="spare-key">Spare</span><span class="gap-key">Gap</span></div>
    <div class="chart-readout" aria-live="polite"><b>${clockLabel(selected)} <small>${r.kind === 'forecast' ? 'FORECAST' : r.kind === 'live' ? 'LIVE PREVIEW' : 'SETTLED'}</small></b><span>Demand <strong>${number(r.demand)}</strong></span><span>Supply <strong>${number(r.served)}</strong></span>
      <span class="${r.shortage > 0.5 ? 'bad' : 'good'}"><strong>${number(r.shortage > 0.5 ? r.shortage : r.spare)}</strong> ${r.shortage > 0.5 ? 'gap' : 'spare'} <small>MW</small></span>${band?.[selected] ? `<span>Likely need <strong>${number(band[selected].lo)}–${number(band[selected].hi)}</strong></span>` : ''}</div>
    <div class="chart-caption">${phase === 'play' && selected !== liveHour ? `<button class="text-button" data-action="now">↩ Back to ${clockLabel(liveHour)}</button>` : '<span>Tap a column to inspect or edit that hour.</span>'}<span>Faded = forecast · outline = spare · shaded = likely need (80% range)${phase === 'play' ? ' · <button class="text-button" data-action="forecast">Weather outlook ↗</button>' : ''}</span></div></section>`;
}

function statusPanel({row, demand, planning, ledger, streak, carbon, budget}) {
  const gap = row.shortage > 0.5, black = row.blackout > 0.5;
  return `<aside class="panel grid-status ${gap ? 'grid-alert' : ''}"><div class="status-heading"><span class="eyebrow">${planning ? 'FORECAST BALANCE' : 'THE CITY IS COUNTING ON YOU'}</span><b class="${gap ? 'bad' : 'good'}">${black ? 'BLACKOUT' : gap ? 'BROWNOUT' : 'LIGHTS ON'}</b></div>
    ${cityScene({served: row.served, demand, brownout: row.brownout, blackout: row.blackout})}
    <div class="live-balance"><strong>${number(row.served)}<small> / ${number(demand)} MW</small></strong><span>${gap ? `${number(row.shortage, 1)} MW unserved${black ? ' · districts dark' : ' · voltage reduced'}` : `${number(row.spare)} MW spare capacity`}</span></div>
    <div class="status-bottom">${planning ? `<span>Carbon target ≈ <b>${number(budget)} t</b></span><span>This plan <b class="${carbon > budget ? 'bad' : 'good'}">${number(carbon)} t</b></span>`
      : `<span><b>${ledger.length}/12</b> settled</span><span><b>${streak}</b> clean streak</span><span><b>${number(carbon)}</b>/≈${number(budget)} tCO₂</span>`}</div></aside>`;
}

function unitPanel({schedule, hour, liveHour, rules, conditions, dispatchRow, planning, plan, open, outageEnd}) {
  const t = hour, mask = schedule[t];
  const cards = FLEET.map((u, i) => {
    const disabled = Boolean(rules.disabled & (1 << i)), tripped = Boolean((conditions.outage ?? 0) & (1 << i)), on = isOn(mask, i);
    const from = planning ? 0 : editableFrom(i, liveHour, rules), locked = !planning && t < from;
    const changed = !planning && isOn(mask ^ plan[t], i);
    let note;
    if (disabled) note = 'Not in service today';
    else if (tripped) note = `Tripped${outageEnd?.[i] ? ` until ${clockLabel(outageEnd[i])}` : ''}`;
    else if (planning && isOn(NUCLEAR, i)) note = 'Runs all shift or not at all';
    else if (!planning && isOn(NUCLEAR, i)) note = 'Fixed for the shift';
    else if (locked) note = `Locked · next change ${from < HOURS ? clockLabel(from) : 'not this shift'}`;
    else if (changed) note = `+${pounds(u.change)}/h plan change`;
    else note = planning ? `Start ${pounds(u.startup)}${u.lead ? ` · needs ${u.lead}h notice` : ''}` : rules.leadTimes !== false && u.lead ? `${u.lead}h notice` : 'Instant';
    const output = dispatchRow ? dispatchRow.outputs[i] : null;
    return `<button class="unit ${on ? 'on' : ''} ${locked || isOn(NUCLEAR, i) && !planning ? 'locked' : ''} ${tripped ? 'tripped' : ''} ${changed ? 'changed' : ''}" style="--unit:${UNIT_COLORS[u.type]}" data-unit="${i}" aria-pressed="${on}" ${disabled ? 'disabled' : ''} aria-label="${u.id} ${u.name}, ${u.type}, ${on ? 'on' : 'off'}. ${note}">
      <span class="unit-top"><svg viewBox="0 0 43 38" aria-hidden="true">${ICONS[u.type]}</svg><span class="unit-name">${u.type}<b>${u.id}</b></span><span class="unit-state">${tripped ? 'TRIP' : on ? 'ON' : 'OFF'}</span></span>
      <span class="unit-power"><b>${output !== null && on ? `${number(output)}/` : ''}${u.capacity}</b> MW · £${u.rate}/MWh</span><span class="unit-note">${note}</span></button>`;
  }).join('');
  return `<section class="panel units ${open ? '' : 'collapsed'}"><div class="panel-head"><h3>Generators · ${clockLabel(t)}</h3>
    <button class="text-button" data-action="units" aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button></div>
    ${open ? `<div class="unit-grid">${cards}</div><p class="auto-note">${planning ? 'Tap a unit to switch it for the selected hour. Output is allocated automatically: renewables first, then cheapest running units.'
      : 'A switch applies from the selected hour until that unit’s next scheduled change. Coal needs notice; gas is instant.'}</p>` : ''}</section>`;
}

/* ---------- Plan ---------- */

export function planView({game, rows, band, warnings, selected, planTotal, planCarbon, budget, preset, undo, unitsOpen, goal}) {
  const day = game.session.day, f = day.forecast.hours[selected], row = rows[selected];
  return `<main id="main" class="plan">${steps(game)}
    <div class="page-title"><div><span class="eyebrow">YOUR MISSION · KEEP THE LIGHTS ON FOR 12 HOURS</span><h2>${escapeHtml(day.title)}</h2><p class="mission">${escapeHtml(day.mission)}</p>
      ${goal ? `<p class="goal">Goal: ${describeGoal(goal)}</p>` : ''}</div><button class="quiet" data-action="forecast">Weather outlook ↗</button></div>
    ${warningStrip(warnings)}
    <div class="strategy-row"><span class="eyebrow">STARTING PLAN</span><div class="presets" aria-label="Starting plan">${Object.entries(PRESETS).map(([key, p]) => `<button data-preset="${key}" aria-pressed="${preset === key}">${p.label} <small>${p.note}</small></button>`).join('')}</div>
      <button class="quiet undo" data-action="undo-plan" ${undo ? '' : 'disabled'} aria-label="Undo last plan edit">↶ Undo</button></div>
    <div class="command-view">${chartPanel({rows, selected, current: null, band, warnings, phase: 'plan'})}
      ${statusPanel({row: {...row, brownout: 0, blackout: row.shortage}, demand: f.demand, planning: true, carbon: planCarbon, budget})}</div>
    ${unitPanel({schedule: game.plan, hour: selected, liveHour: 0, rules: day.rules, conditions: f, dispatchRow: null, planning: true, plan: game.plan, open: unitsOpen})}
    <div class="action-bar"><div class="action-summary"><strong>${pounds(planTotal)} <small>at forecast</small></strong><span>${rows.filter(r => r.shortage > 0.5).length ? `${rows.filter(r => r.shortage > 0.5).length} forecast gaps` : '12 hours covered'} · presets ignore warnings</span></div>
      <div class="transport"><button class="quiet" data-action="copy">Use ${clockLabel(selected)} mix all shift</button><button class="primary" data-action="start">Commit plan &amp; take control →</button></div></div>
  </main>`;
}

/* ---------- Play ---------- */

function eventBanner({status, changes, feedback, running}) {
  let kind = 'calm', symbol = '✓', title = feedback || 'Grid holding steady', text = running ? 'Running through quiet hours. Pause whenever you like.' : 'Check the chart and warnings, make a call, then run the shift.';
  const change = changes[0], alert = status.events[0];
  if (status.blackout > 0.5) { kind = 'danger'; symbol = 'ϟ'; title = `${alert?.title ?? 'Power gap'} · blackout`; text = `${number(status.shortage)} MW short. Blackouts cost £2,500/MWh and break the Lights-on medal.`; }
  else if (status.shortage > 0.5) { kind = 'danger'; symbol = 'ϟ'; title = `${alert?.title ?? 'Power gap'} · brownout`; text = `${number(status.shortage)} MW short, within the brownout band (£300/MWh). Cover it, or ride it out.`; }
  else if (change) {
    kind = 'weather'; symbol = change.warning.icon;
    const w = change.warning, unit = w.unit !== null ? FLEET[w.unit] : null;
    title = {confirmed: `${w.title} confirmed`, started: `${w.title} has arrived`, tripped: `${unit?.id ?? 'Unit'} tripped`, cleared: `${w.title}: all clear`}[change.change];
    text = {confirmed: `Expected ${clockLabel(w.start)}–${clockLabel(w.end)}. Ironbridge needs 2 hours' notice, Moorfield 1.`, started: `Until ${clockLabel(w.end)}.`,
      tripped: `${unit?.name ?? 'The unit'} is offline until ${clockLabel(w.end)}.`, cleared: 'The warning has lifted.'}[change.change];
  } else if (alert) { kind = 'weather'; symbol = {wind: '≈', cloud: '☁', demand: '↗'}[alert.kind]; title = `${alert.title} · grid holding`; text = `${alert.detail}: ${alert.delta > 0 ? '+' : ''}${number(alert.delta)} MW.`; }
  return `<div class="event-banner ${kind}" role="status"><span class="event-symbol">${symbol}</span><div><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div><span class="run-state">${running ? '<i></i> RUNNING' : 'Ⅱ PAUSED'}</span></div>`;
}

const OPTION_ICON = {hold: '◇', gas: 'ϟ', coal: '⏱', standdown: '↘'};
function optionCards(options, {draftKey}) {
  return `<section class="options"><div class="options-head"><h3>Your move</h3><span>Costs are projected to 20:00 across likely weather, assuming later gaps get gas. They inform, they don't decide.</span></div>
    <div class="option-cards">${options.map((o, i) => {
      const current = o.kind === 'hold';
      return `<button class="option ${o.kind} ${o.kind === 'gas' && o.now.shortage < 0.5 && options[0].now.shortage > 0.5 ? 'urgent' : ''}" data-option="${i}" data-key="${draftKey}" ${current ? 'aria-pressed="true"' : ''}>
        <span class="option-icon" aria-hidden="true">${OPTION_ICON[o.kind]}</span><span class="option-body"><b>${escapeHtml(o.title)}</b><small>${escapeHtml(o.detail)}</small></span>
        <span class="option-costs">${current ? `<em>${pounds(o.now.total)}<small>this hour</small></em><em>${pounds(o.rest)}<small>to 20:00</small></em>`
          : `<em class="${o.nowDelta < -0.5 ? 'good' : o.nowDelta > 0.5 ? 'bad' : ''}">${signedPounds(o.nowDelta)}<small>this hour</small></em><em class="${o.restDelta < -0.5 ? 'good' : o.restDelta > 0.5 ? 'bad' : ''}">${signedPounds(o.restDelta)}<small>to 20:00</small></em>`}</span></button>`;
    }).join('')}</div></section>`;
}

export function playView({game, rows, band, warnings, selected, status, changes, options, row, spend, carbon, budget, streak, feedback, running, undo, unitsOpen, outageEnd}) {
  const v = game.view, h = v.hour, day = game.session.day;
  const conditions = selected === h ? v.actual : {...day.forecast.hours[selected], outage: rows[selected].outage};
  return `<main id="main" class="play ${running ? 'is-running' : ''}">${steps(game)}
    <div class="page-title"><div><span class="eyebrow">${escapeHtml(day.title).toUpperCase()} · KEEP THE LIGHTS ON · CONTROL THE COST</span><h2>${clockLabel(h)} <span class="muted">/ ${clockLabel(h + 1)}</span> <small>HOUR ${h + 1}/12</small></h2></div>
      <div class="shift-meters"><div><small>SHIFT SPEND</small><b>${pounds(spend)}</b></div><div><small>CARBON SO FAR</small><b>${number(carbon)}<span>/≈${number(budget)} t</span></b></div></div></div>
    ${eventBanner({status, changes, feedback, running})}
    ${warningStrip(warnings, {compact: true})}
    <div class="command-view">${chartPanel({rows, selected, current: h, band, warnings, phase: 'play', liveHour: h})}
      ${statusPanel({row, demand: v.actual.demand, planning: false, ledger: v.ledger, streak, carbon, budget})}</div>
    ${optionCards(options, {draftKey: h})}
    <div class="decision-meta"><span>${undo ? 'Preview updated. Nothing is charged until the hour settles.' : 'Pick a move or switch units yourself. The chart previews it before you commit.'}</span>
      <span><button class="text-button" data-action="undo-draft" ${undo ? '' : 'disabled'}>↶ Undo</button><button class="text-button" data-action="reset-draft">Reset changes</button></span></div>
    ${unitPanel({schedule: game.draft, hour: selected, liveHour: h, rules: day.rules, conditions, dispatchRow: selected === h ? row : null, planning: false, plan: game.plan, open: unitsOpen, outageEnd})}
    <div class="action-bar"><div class="action-summary"><strong>${pounds(row.total)} <small>this hour</small></strong><button class="text-button" data-action="hour-costs">${row.penalty > 0.5 ? `${pounds(row.penalty)} unserved penalty` : `${pounds(row.adjustment)} plan changes`} · breakdown</button></div>
      <div class="transport"><button class="quiet step-button" data-action="settle" aria-label="Settle this hour and advance">Step →</button>
        <button class="quiet skip-button" data-action="skip" aria-label="Run quickly to the next decision">⏭ Skip</button>
        <button class="primary ${running ? 'pause-button' : ''}" data-action="${running ? 'pause' : 'run'}">${running ? 'Ⅱ Pause' : h === HOURS - 1 ? 'Finish shift →' : '▶ Run shift'}</button></div></div>
  </main>`;
}

/* ---------- Results ---------- */

export function resultsView({game, score, rival, coach, replay, best, goal, goalOk, nextDay, isBest, previousBest}) {
  const v = game.view, a = v.ledger[replay], b = v.rivalLedger[replay], delta = score.total - rival.total;
  const headline = Math.abs(delta) < 1 ? `You and ${v.opponent.name} finished level.` : delta < 0 ? `You beat ${v.opponent.name} by ${pounds(-delta)}.` : `${v.opponent.name} came in ${pounds(delta)} cheaper.`;
  return `<main id="main" class="results">${steps(game)}
    <section class="result-hero panel"><div class="result-stars">${starMarkup(score.stars)}</div>
      <div class="result-copy"><span class="eyebrow">SHIFT COMPLETE · EFFICIENCY AGAINST PERFECT HINDSIGHT</span><h2>${percent(score.efficiency)} efficient</h2><p>${headline}</p>
        <div class="medals"><span class="medal ${score.medals.reliability ? 'won' : ''}">🛡 Lights on ${score.medals.reliability ? '✓' : `✗ <small>${number(score.brownout + score.blackout, 1)} MWh unserved</small>`}</span>
          <span class="medal ${score.medals.carbon ? 'won' : ''}">🌿 Carbon ${score.medals.carbon ? '✓' : '✗'} <small>${number(score.emissions)}/${number(score.budget)} t</small></span></div>
        ${goal ? `<p class="goal ${goalOk ? 'good' : 'bad'}">${goalOk ? '✓ Goal met' : '✗ Goal missed'}: ${describeGoal(goal)}</p>` : ''}
        <p class="best-line">${isBest ? '★ New personal best for this day' : previousBest ? `Personal best: ${starMarkup(previousBest.stars, false)} ${percent(previousBest.efficiency)}` : ''}</p></div></section>
    <div class="scorecards"><article class="scorecard you"><h3>YOU</h3><strong>${pounds(score.total)}</strong><p>${percent(score.efficiency)} · ${starMarkup(score.stars, false)}</p></article>
      <article class="scorecard rival"><h3>${escapeHtml(v.opponent.name.toUpperCase())}</h3><strong>${pounds(rival.total)}</strong><p>${percent(rival.efficiency)} · ${starMarkup(rival.stars, false)}</p></article>
      <article class="scorecard best"><h3>PERFECT HINDSIGHT</h3><strong>${pounds(best)}</strong><p>Knew the whole day in advance</p></article></div>
    <div class="result-actions">${nextDay ? `<button class="primary" data-action="campaign" data-day="${nextDay.id}">Day ${Number(nextDay.id.slice(1))}: ${escapeHtml(nextDay.title)} →</button>` : `<button class="primary" data-action="home">Take another shift →</button>`}
      <button class="quiet" data-action="retry">Try this day again</button><button class="quiet" data-action="share">Copy result</button></div>
    <section class="panel coach"><div class="panel-head"><h3>Coach</h3><span class="tag">plan ${pounds(coach.planRegret)} · in-shift ${pounds(coach.playRegret)} above best</span></div>
      <div class="coach-body">${coach.worst ? `<div class="worst"><span class="eyebrow">YOUR COSTLIEST CALL · ${clockLabel(coach.worst.hour)}</span><p>With hindsight, <b>${escapeHtml(coach.worst.moves.join(', ') || 'a different mix')}</b> would have saved <b>${pounds(coach.worst.regret)}</b>${coach.worst.note ? `. That hour, ${escapeHtml(coach.worst.note)}` : ''}.</p>
        <button class="text-button" data-replay="${coach.worst.hour}">Replay ${clockLabel(coach.worst.hour)} ↓</button></div>` : '<div class="worst"><p>No single hour cost you more than £100 against hindsight. Clean shift.</p></div>'}
        ${coach.tips.length ? `<ul class="tips">${coach.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}</div></section>
    ${costRace([{label: 'You', rows: v.ledger, color: 'var(--yellow)'}, {label: v.opponent.name, rows: v.rivalLedger, color: 'var(--cyan)'}], {baseline: coach.bestLedger})}
    <section class="panel result-replay" id="replay"><div class="panel-head"><h3>Where did the money go?</h3><span class="tag">${clockLabel(replay)}–${clockLabel(replay + 1)}</span></div>
      <div class="replay-hours" role="group" aria-label="Choose a replay hour">${v.ledger.map((l, i) => `<button class="hour-button ${l.shortage > 0.5 ? 'risk' : ''}" data-replay="${i}" aria-pressed="${replay === i}"><span>${String(8 + i).padStart(2, '0')}</span><small>${l.shortage > 0.5 ? 'gap' : coach.hours[i].regret > 300 ? '£' : '✓'}</small></button>`).join('')}</div>
      <div class="replay-conditions"><span>Demand <b>${number(a.actual.demand)} MW</b></span><span>Wind <b>${number(a.actual.wind)} MW</b></span><span>Solar <b>${number(a.actual.solar)} MW</b></span>${a.actual.outage ? `<span class="bad">Tripped <b>${FLEET.filter((u, i) => isOn(a.actual.outage, i)).map(u => u.id).join(', ')}</b></span>` : ''}</div>
      <div class="replay-grid">${[[a, 'YOU', 'yellow'], [b, v.opponent.name.toUpperCase(), 'good'], [coach.bestLedger[replay], 'HINDSIGHT', 'purple']].map(([l, name, cls]) => `<div class="replay-card"><h3 class="${cls}">${escapeHtml(name)}</h3>
        <div class="mix-row"><span>Plan</span>${mixMarkup(l.planMask)}</div><div class="mix-row"><span>Ran</span>${mixMarkup(l.mask, l.planMask)}</div><div class="replay-cost">${pounds(l.total)} <small>${l.shortage > 0.5 ? `${number(l.shortage, 1)} MWh unserved` : `${number(l.spare)} MW spare`}</small></div></div>`).join('')}</div>
      <p class="replay-reason"><b>${escapeHtml(v.opponent.name)}’s decision:</b> ${escapeHtml(v.rivalNotes[replay])}</p></section>
    <div class="details-actions"><button class="quiet" data-action="results-details">Costs &amp; impact</button><button class="quiet" data-action="audit">Hourly records</button><button class="quiet" data-action="download">Download CSV</button></div>
  </main>`;
}
