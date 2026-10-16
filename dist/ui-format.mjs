/** Formatting and markup helpers shared by every view. */
import {FLEET} from './config.mjs';
import {isOn} from './engine.mjs';
import {clockLabel} from './world.mjs';

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const number = (n, d = 0) => n.toLocaleString('en-GB', {minimumFractionDigits: d, maximumFractionDigits: d});
export const pounds = n => `${n < -0.5 ? '−' : ''}£${number(Math.abs(n))}`;
export const signedPounds = n => (Math.abs(n) < 0.5 ? '£0' : `${n > 0 ? '+' : '−'}£${number(Math.abs(n))}`);
export const percent = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export const starMarkup = (n, label = true) => `<span class="stars" ${label ? `role="img" aria-label="${n} of 3 stars"` : 'aria-hidden="true"'}>${[0, 1, 2].map(i => `<i class="${i < n ? 'lit' : ''}">★</i>`).join('')}</span>`;

export const SOURCE_COLORS = Object.freeze(['#b9a1ff', '#b2c4d2', '#fb923c', '#5eead4', '#fde68a']);
export const SOURCE_LABELS = Object.freeze(['Nuclear', 'Coal', 'Gas', 'Wind', 'Solar']);
export const UNIT_COLORS = Object.freeze({Nuclear: '#b9a1ff', Coal: '#b2c4d2', Gas: '#fb923c'});

export const ICONS = Object.freeze({
  Nuclear: '<path d="m7 32 4-23h14l4 23M3 32h30M13 5V1m9 3V0"/><path d="m20 32 4-27h13l5 27"/>',
  Coal: '<path d="M4 32V16h33v16zM8 16V3h6v13m14 0V0h5v16M9 23h5m5 0h5m5 0h4"/>',
  Gas: '<path d="M3 32V17l11-7v7l12-7v7h12v15zM30 17V2h5v15M9 24h5m5 0h5m5 0h4"/>',
});

export function mixMarkup(mask, base = null) {
  return FLEET.map((u, i) => `<span class="mix-unit ${isOn(mask, i) ? 'on' : ''} ${base !== null && isOn(mask ^ base, i) ? 'changed' : ''}" style="--unit:${UNIT_COLORS[u.type]}" title="${u.name}: ${isOn(mask, i) ? 'on' : 'off'}">${u.id}</span>`).join('');
}

export const warningLabel = w => {
  if (w.status === 'possible') return `${Math.round(w.prob * 100)}% · ${clockLabel(w.window[0])}–${clockLabel(Math.min(12, w.window[1] + 1))}`;
  if (w.status === 'confirmed') return `Confirmed ${clockLabel(w.start)}–${clockLabel(w.end)}`;
  if (w.status === 'active') return `Now · until ${clockLabel(w.end)}`;
  if (w.status === 'over') return `Passed`;
  return 'Cleared';
};
