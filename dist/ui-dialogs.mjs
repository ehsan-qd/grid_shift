/** Dialog bodies. Each returns {title, body, actions}. */
import {FLEET, SHORTAGE, STAR_THRESHOLDS, CARBON_TARGET_SHARE, OPPONENTS, PRESETS, PRESET_LOOKAHEAD} from './config.mjs';
import {unitNames, summarize} from './engine.mjs';
import {clockLabel} from './world.mjs';
import {number, pounds, percent, escapeHtml, warningLabel} from './ui-format.mjs';
import {forecastChart} from './ui-charts.mjs';

const COSTS = [['Running + online', 'running'], ['Start-ups', 'startup'], ['Plan changes', 'adjustment'], ['Unserved demand', 'penalty'], ['Total', 'total']];

export function costRows(total) {
  return `<div class="cost-lines">${COSTS.map(([label, key]) => `<div class="cost-line ${key === 'total' ? 'total' : ''}"><span>${label}</span><strong>${pounds(total[key])}</strong></div>`).join('')}</div>`;
}

export function rulesDialog() {
  const leadText = FLEET.map(u => `${u.id} ${u.lead === null ? 'fixed for the shift' : u.lead ? `${u.lead}h notice` : 'instant'}`).join(' · ');
  return {title: 'Rules, scoring & opponents', body: `
    <p><b>Lowest total cost wins, and the lights must stay on.</b> Each shift is twelve one-hour decisions, 08:00–20:00. You choose which units are on; output is allocated automatically: renewables first, then the cheapest running units.</p>
    <details open><summary>What you pay</summary>
      <p>Running cost = energy × rate + the unit's hourly online charge (paid even at 0 MW). Starting a unit from off costs its start-up. Each hour a unit differs from your committed plan costs its change charge. Unserved demand up to ${percent(SHORTAGE.brownoutShare, 0)} of the hour's demand is a <b>brownout</b> at ${pounds(SHORTAGE.brownoutPrice)}/MWh; beyond that it's a <b>blackout</b> at ${pounds(SHORTAGE.blackoutPrice)}/MWh.</p>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Unit</th><th>MW</th><th>£/MWh</th><th>Online £/h</th><th>Start £</th><th>Change £/h</th><th>Notice</th><th>tCO₂/MWh</th></tr></thead><tbody>
      ${FLEET.map(u => `<tr><td>${u.id} ${u.name}</td><td>${u.capacity}</td><td>${u.rate}</td><td>${number(u.fixed)}</td><td>${number(u.startup)}</td><td>${number(u.change)}</td><td>${u.lead === null ? 'Shift' : u.lead ? `${u.lead}h` : 'Instant'}</td><td>${u.co2}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Notice and changes during the shift</summary><p>${leadText}. A change takes effect from the first hour the unit can reach and lasts until that unit's next scheduled change. Nuclear runs all shift or not at all. Some campaign days switch notice off or take units out of service.</p></details>
    <details><summary>Warnings and day types</summary><p>Days can bring a storm front (wind farms shut down; confirmed 2 hours ahead), a faulty pump (a plant may trip; 1 hour's alarm), morning fog (solar smothered), a heatwave (later, higher evening peak) or a cup final (a demand surge at the final whistle). Warnings show a probability that updates as the day unfolds. You and your opponent always face exactly the same day.</p></details>
    <details><summary>Stars and medals</summary><p>Your <b>efficiency</b> is the cost of the best possible shift with perfect hindsight divided by your cost. Stars: ★ ${percent(STAR_THRESHOLDS[0], 1)}, ★★ ${percent(STAR_THRESHOLDS[1], 1)}, ★★★ ${percent(STAR_THRESHOLDS[2], 1)}. Because hindsight sees the same weather, a stormy day doesn't drag your grade down; only your decisions do.</p>
      <p><b>🛡 Lights on</b>: no unserved demand at all. <b>🌿 Carbon</b>: emit no more than ${CARBON_TARGET_SHARE === 1 ? '' : `${percent(CARBON_TARGET_SHARE, 0)} of `}what the cheapest possible shift for the actual weather emits. Before and during the shift you see an estimate from the forecast. Leaning on gas instead of coal earns it, at a cost to your stars: cheap, clean and reliable pull against each other.</p></details>
    <details><summary>Starting plans and decision cards</summary><p>${Object.values(PRESETS).map(p => `${p.label} plans for forecast demand ${p.margin ? `plus ${p.margin} MW` : 'only'}`).join('; ')}. Presets look only ${PRESET_LOOKAHEAD} hours ahead and ignore warnings: they are starting points, not answers.</p>
      <p>During the shift, cards show concrete moves: hold course, fire up gas, order coal (with a gas bridge if needed) or stand a unit down. Each shows its cost this hour and projected to 20:00, averaged over likely weather and assuming later gaps get gas. They inform; they don't optimise.</p></details>
    <details><summary>Opponents</summary><p>${Object.values(OPPONENTS).map(o => `<b>${o.name}</b>: ${o.blurb}`).join(' ')}</p>
      <p>ORBIT here is a local simulator: a dynamic program over 64 fleet combinations, averaged over sampled weather paths, valuing later gaps as patchable with gas, and replanning each hour from only public information. It never sees the hidden day. It is not connected to any production service and makes no claim of optimality.</p></details>
    <details><summary>Simplifications</summary><p>All units start off at 08:00. No ramp limits, minimum outputs or network constraints. Wind capacity 280 MW, solar 300 MW; excess renewables are curtailed. Money and emission factors are illustrative.</p></details>`};
}

export function forecastDialog(day, history, warnings) {
  return {title: 'Weather outlook', body: `${forecastChart(day, history)}
    <p>Forecast errors persist: if wind is below forecast now, it tends to stay low for a few hours. The shaded band on the main chart shows the likely range.</p>
    ${warnings.length ? `<h3>Warnings</h3><ul class="warning-list">${warnings.map(w => `<li><b>${w.icon} ${escapeHtml(w.title)}</b> · ${warningLabel(w)}<br><span>${escapeHtml(w.detail)}</span></li>`).join('')}</ul>` : '<p>No warnings for this shift.</p>'}
    <details><summary>Hourly values</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Hour</th><th>Demand</th><th>Wind</th><th>Solar</th><th>Actual demand</th><th>Actual wind</th><th>Actual solar</th></tr></thead><tbody>
    ${day.forecast.hours.map((a, i) => `<tr><td>${clockLabel(i)}</td><td>${number(a.demand)}</td><td>${number(a.wind)}</td><td>${number(a.solar)}</td>${['demand', 'wind', 'solar'].map(k => `<td>${history[i] ? number(history[i][k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>All values in MW. Unrevealed actuals stay hidden.</p></details>`};
}

export function hourCostsDialog(hour, row) {
  return {title: `${clockLabel(hour)} cost preview`, body: `${costRows(row)}<p>You pay when the hour settles. Switching before then is free.</p>`};
}

export function detailsDialog(you, rival, rivalName, best) {
  const a = summarize(you), b = summarize(rival), c = summarize(best);
  const rows = [...COSTS.map(([label, key]) => [label, key, v => pounds(v)]), ['Brownout', 'brownout', v => `${number(v, 1)} MWh`], ['Blackout', 'blackout', v => `${number(v, 1)} MWh`],
    ['Emissions', 'emissions', v => `${number(v, 1)} t CO₂`], ['Renewables curtailed', 'curtailment', v => `${number(v, 1)} MWh`]];
  return {title: 'The shift, accounted for', body: `<div class="table-scroll"><table class="data-table compare-table"><thead><tr><th></th><th>You</th><th>${escapeHtml(rivalName)}</th><th>Hindsight</th></tr></thead><tbody>
    ${rows.map(([label, key, f]) => `<tr><th>${label}</th>${[a, b, c].map(s => `<td class="${key === 'total' ? 'total' : ''}">${f(s[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p>Currency is shown to the nearest pound. Totals use unrounded hourly values.</p>`};
}

export function auditDialog(you, rival, rivalName) {
  const table = ledger => `<div class="table-scroll"><table class="data-table"><thead><tr><th>Hour</th><th>Plan</th><th>Ran</th><th>Unserved MWh</th><th>Running £</th><th>Start £</th><th>Change £</th><th>Penalty £</th><th>Total £</th></tr></thead><tbody>
    ${ledger.map(l => `<tr><td>${clockLabel(l.hour)}</td><td>${unitNames(l.planMask)}</td><td>${unitNames(l.mask)}${l.actual.outage ? ' ⚠' : ''}</td><td>${number(l.shortage, 1)}</td>${['running', 'startup', 'adjustment', 'penalty', 'total'].map(k => `<td>${number(l[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return {title: 'Hourly records', body: `<details open><summary>Your 12 hours</summary>${table(you)}</details><details><summary>${escapeHtml(rivalName)}’s 12 hours</summary>${table(rival)}</details>`,
    actions: '<button class="quiet" data-action="download">Download CSV</button>'};
}

export function confirmShortageDialog(row) {
  return {title: 'Settle with unserved demand?', body: `<p class="notice"><b>${number(row.shortage, 1)} MW</b> will go unserved (${number(row.brownout, 1)} brownout, ${number(row.blackout, 1)} blackout). This hour includes a <b>${pounds(row.penalty)}</b> penalty and the Lights-on medal will be lost.</p>`,
    actions: '<button data-close>Go back</button><button class="primary" data-action="accept-shortage">Settle anyway</button>'};
}

export function retryDialog() {
  return {title: 'Try this day again?', body: '<p>The forecast, weather and warnings repeat exactly. Your current result stays in your personal best.</p>',
    actions: '<button data-close>Keep results</button><button class="primary" data-action="accept-retry">Retry this day</button>'};
}

export function shareDialog(text) {
  return {title: 'Share your result', body: `<p>Copy this and send it to a friend with the same day code:</p><textarea class="share-text" readonly rows="4">${escapeHtml(text)}</textarea>`,
    actions: '<button class="primary" data-action="copy-share">Copy</button>'};
}
