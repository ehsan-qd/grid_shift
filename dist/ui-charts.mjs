/** SVG charts and the city scene. Pure functions of their inputs. */
import {HOURS, START_HOUR} from './config.mjs';
import {clockLabel} from './world.mjs';
import {number, pounds, SOURCE_COLORS, SOURCE_LABELS} from './ui-format.mjs';

const KIND_LABEL = {forecast: 'forecast', live: 'live preview', settled: 'settled'};

/** Demand/generation timeline. Band = p10–p90 need; markers = event warnings. */
export function timelineChart(rows, {selected = null, current = null, band = null, warnings = [], id = 'main', interactive = true} = {}) {
  const w = 840, h = 250, left = 40, right = 12, top = 34, bottom = 28, plotW = w - left - right, step = plotW / HOURS, bw = step * 0.66;
  const peak = Math.max(...rows.map(r => Math.max(r.served + r.spare, r.demand)), ...(band ?? []).filter(Boolean).map(b => b.hi));
  const max = Math.max(800, Math.ceil(peak / 200) * 200);
  const y = v => top + (max - Math.max(0, v)) / max * (h - top - bottom), x = i => left + step * (i + 0.5);
  const markers = warnings.filter(m => m.status !== 'cleared' && m.status !== 'over').map(m => {
    const a = m.status === 'possible' ? m.window[0] : m.start, b = m.status === 'possible' ? Math.min(HOURS, m.window[1] + 1) : m.end;
    const noun = {storm: 'Storm', trip: 'Trip', fog: 'Fog', surge: 'Surge'}[m.kind];
    const label = `${m.icon} ${noun} ${m.status === 'possible' ? `${Math.round(m.prob * 100)}%` : m.status === 'active' ? 'now' : 'confirmed'}`;
    return `<g class="event-marker ${m.status}"><rect x="${left + step * a + 2}" y="4" width="${step * (b - a) - 4}" height="16" rx="3"/><text x="${left + step * a + 8}" y="16">${label}</text></g>`;
  }).join('');
  const columns = rows.map((r, i) => {
    let sum = 0;
    const bars = r.generation.map((value, j) => {
      const prior = sum;
      sum += value;
      return value > 0.01 ? `<rect x="${x(i) - bw / 2}" y="${y(sum)}" width="${bw}" height="${Math.max(0, y(prior) - y(sum))}" fill="${SOURCE_COLORS[j]}"/>` : '';
    }).join('');
    const b = band?.[i];
    const describe = `${clockLabel(i)}, ${KIND_LABEL[r.kind]}, demand ${number(r.demand)} MW, ${r.shortage > 0.5 ? `${number(r.shortage)} MW gap` : `${number(r.spare)} MW spare`}`;
    return `<g class="chart-column ${r.kind === 'forecast' ? 'future-column' : ''}" ${interactive ? `data-chart-hour="${i}" role="button" tabindex="0" aria-label="Inspect ${describe}"` : ''}>
      <title>${clockLabel(i)} · ${KIND_LABEL[r.kind]}\nDemand ${number(r.demand)} MW · Supplied ${number(r.served)} MW\n${SOURCE_LABELS.map((n, j) => `${n}: ${number(r.generation[j])} MW`).join('\n')}\n${number(r.spare)} MW spare · ${number(r.shortage)} MW gap${b ? `\nLikely need ${number(b.lo)}–${number(b.hi)} MW` : ''}</title>
      <rect class="hitbox" x="${left + step * i}" y="${top - 10}" width="${step}" height="${h - top + 10}" fill="transparent"/>
      ${b ? `<rect class="need-band" x="${left + step * i + 1}" y="${y(b.hi)}" width="${step - 2}" height="${Math.max(1, y(b.lo) - y(b.hi))}"/>` : ''}
      ${r.spare > 0.5 ? `<rect class="spare-outline" x="${x(i) - bw / 2}" y="${y(r.served + r.spare)}" width="${bw}" height="${y(r.served) - y(r.served + r.spare)}"/>` : ''}
      ${bars}
      ${r.shortage > 0.5 ? `<rect x="${x(i) - bw / 2}" y="${y(r.demand)}" width="${bw}" height="${y(r.served) - y(r.demand)}" fill="url(#${id}-gap)"/>` : ''}
      ${r.kind === 'forecast' ? `<rect x="${x(i) - bw / 2}" y="${y(r.served)}" width="${bw}" height="${y(0) - y(r.served)}" fill="url(#${id}-future)"/>` : ''}
      ${r.outage ? `<text class="trip-mark" x="${x(i)}" y="${y(0) - 4}" text-anchor="middle">⚠</text>` : ''}
      <text class="hour-axis ${i % 2 ? 'odd-axis' : ''} ${i === selected ? 'selected' : r.kind === 'forecast' ? 'future' : ''}" x="${x(i)}" y="${h - 8}" text-anchor="middle">${String(START_HOUR + i).padStart(2, '0')}${i === current ? '•' : ''}</text>
      ${i === selected ? `<line class="selected-mark" x1="${x(i) - bw / 2}" x2="${x(i) + bw / 2}" y1="${h - 1}" y2="${h - 1}"/>` : ''}
    </g>`;
  }).join('');
  const forecastPoints = rows.map((r, i) => `${x(i)},${y(r.forecastDemand)}`).join(' '), actual = rows.filter(r => r.actualDemand !== null);
  return `<div class="timeline-wrap"><svg class="timeline-chart" viewBox="0 0 ${w} ${h}" role="group" aria-label="Generation and demand for twelve hours. Shaded bands show the likely range of demand your units must meet; markers show weather and plant warnings.">
    <defs><pattern id="${id}-gap" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#783545"/><rect width="3" height="7" fill="#fb7185"/></pattern>
    <pattern id="${id}-future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.5" height="6" fill="#061820" opacity=".48"/></pattern></defs>
    ${[0, max / 2, max].map(v => `<line class="gridline" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <text class="axis" x="5" y="14">MW</text>
    ${current !== null ? `<rect class="current-band" x="${left + step * current}" y="${top - 8}" width="${step}" height="${h - top - bottom + 16}" rx="4"/>` : ''}
    ${markers}${columns}
    <polyline class="forecast-line" points="${forecastPoints}"/>
    ${actual.length ? `<polyline class="actual-line" points="${actual.map(r => `${x(r.hour)},${y(r.actualDemand)}`).join(' ')}"/>${actual.map(r => `<circle cx="${x(r.hour)}" cy="${y(r.actualDemand)}" r="3.5" fill="#fff"/>`).join('')}` : ''}
  </svg></div>`;
}

/** Cumulative cost lines, drawn as money spent above the perfect-hindsight shift so small gaps are visible. */
export function costRace(series, {baseline, title = 'The cost race'}) {
  const w = 840, h = 190, l = 62, r = 40, t = 16, b = 30;
  const totals = rows => { let s = 0; return [0, ...rows.map(row => (s += row.total))]; };
  const base = totals(baseline), lines = series.map(s => ({...s, points: totals(s.rows).map((v, i) => v - base[i])}));
  const values = lines.flatMap(s => s.points), lo = Math.min(0, ...values), hi = Math.max(1, ...values) * 1.1;
  const x = i => l + i * (w - l - r) / HOURS, y = v => h - b - (v - lo) / (hi - lo) * (h - t - b);
  const ticks = [lo, 0, hi / 2, hi].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(v) > (hi - lo) * 0.15));
  return `<section class="panel cost-race"><div class="chart-heading"><h3>${title} <small class="muted">£ above perfect hindsight</small></h3><div class="line-legend">${lines.map(s => `<span style="--color:${s.color}">${s.label}</span>`).join('')}<span class="dashed" style="--color:#c4b5fd">Hindsight</span></div></div>
    <svg class="race-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cost above perfect hindsight by hour: ${lines.map(s => `${s.label} ${pounds(s.points.at(-1))}`).join(', ')}">
    ${ticks.map(v => `<line class="gridline" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${l - 7}" y="${y(v) + 4}" text-anchor="end">${v < 0 ? '−' : ''}£${number(Math.abs(v) / 1000, 1)}k</text>`).join('')}
    <line x1="${l}" x2="${w - r}" y1="${y(0)}" y2="${y(0)}" stroke="#c4b5fd" stroke-width="2" stroke-dasharray="6 5"/>
    ${lines.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="3" points="${s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/><text class="race-end" x="${x(HOURS) + 4}" y="${y(s.points.at(-1)) + 4}" fill="${s.color}">${pounds(s.points.at(-1))}</text>`).join('')}
    ${[0, 3, 6, 9, 12].map(i => `<text class="axis" x="${x(i)}" y="${h - 8}" text-anchor="middle">${clockLabel(i)}</text>`).join('')}
  </svg></section>`;
}

export function forecastChart(day, history = []) {
  const w = 620, h = 200, l = 38, r = 12, t = 10, b = 24, top = 1000;
  const x = i => l + i * (w - l - r) / (HOURS - 1), y = v => t + (top - v) / top * (h - t - b);
  const pts = (rows, key) => rows.map((a, i) => `${x(i)},${y(a[key])}`).join(' ');
  const hours = day.forecast.hours;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Demand, wind and solar forecasts from 08:00 to 20:00. Actual values only for revealed hours.">
    ${[0, 250, 500, 750, 1000].map(v => `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${hours.map((a, i) => `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${START_HOUR + i}</text>`).join('')}
    <polyline fill="none" stroke="var(--yellow)" stroke-width="2.5" points="${pts(hours, 'demand')}"/>
    <polyline fill="none" stroke="var(--cyan)" stroke-width="2.5" points="${pts(hours, 'wind')}"/>
    <polyline fill="none" stroke="#fde68a" stroke-width="2.5" points="${pts(hours, 'solar')}"/>
    ${history.length ? `<polyline fill="none" stroke="#fff" stroke-width="3" points="${pts(history, 'demand')}"/>` : ''}
  </svg><div class="legend"><span style="--color:var(--yellow)">Demand</span><span style="--color:var(--cyan)">Wind</span><span style="--color:#fde68a">Solar</span>${history.length ? '<span style="--color:white">Actual demand</span>' : ''}</div>`;
}

const BUILDINGS = [{x: 8, y: 34, w: 30, h: 52}, {x: 43, y: 18, w: 34, h: 68}, {x: 82, y: 44, w: 28, h: 42, hospital: true}, {x: 115, y: 6, w: 36, h: 80},
  {x: 156, y: 28, w: 31, h: 58}, {x: 192, y: 46, w: 28, h: 40}, {x: 225, y: 24, w: 30, h: 62}];

/** The city reacts to served demand: brownouts dim windows, blackouts darken districts, the hospital runs on backup. */
export function cityScene({served, demand, brownout = 0, blackout = 0}) {
  const ratio = served / Math.max(1, demand), darkDistricts = blackout > 0.5 ? Math.max(1, Math.round((1 - ratio) * BUILDINGS.length * 2.5)) : 0;
  const state = blackout > 0.5 ? 'blackout' : brownout > 0.5 ? 'brownout' : 'powered';
  const order = [5, 0, 4, 1, 6, 3, 2];
  const dark = new Set(order.slice(0, Math.min(BUILDINGS.length - 1, darkDistricts)));
  return `<svg class="city ${state}" viewBox="0 0 262 104" role="img" aria-label="${number(ratio * 100)} percent of demand supplied${state === 'blackout' ? ', districts in blackout' : state === 'brownout' ? ', voltage reduced' : ''}">
    <path class="city-wire" d="M0 96H262"/>
    ${BUILDINGS.map((b, i) => `<g class="building ${dark.has(i) ? 'dark' : ''} ${b.hospital ? 'hospital' : ''}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="block"/>
      ${b.hospital ? `<path class="cross" d="M${b.x + b.w / 2 - 2} ${b.y - 9}h4v3h3v4h-3v3h-4v-3h-3v-4h3z"/>` : ''}
      ${Array.from({length: Math.floor(b.h / 15) * 2}, (_, j) => `<rect class="city-window" x="${b.x + 6 + (j % 2) * 12}" y="${b.y + 8 + Math.floor(j / 2) * 15}" width="5" height="6"/>`).join('')}</g>`).join('')}
    ${state === 'blackout' ? `<text class="backup" x="${BUILDINGS[2].x + BUILDINGS[2].w / 2}" y="${BUILDINGS[2].y + BUILDINGS[2].h - 4}" text-anchor="middle">BACKUP</text>` : ''}
    <circle class="power-pulse" cx="24" cy="96" r="3"/><circle class="power-pulse second" cx="94" cy="96" r="3"/>
  </svg>`;
}
