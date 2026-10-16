import test from 'node:test';
import assert from 'node:assert/strict';
import {HOURS, START_HOUR, WIND_CAPACITY, SOLAR_CAPACITY} from '../dist/config.mjs';
import {makeDay, makeRealization, makeScenarios, warningsAt, eligibleStarts, clockLabel} from '../dist/world.mjs';

test('Seeds reproduce days, hidden realizations and planner scenarios; different seeds differ', () => {
  const a = makeDay('CHECK-1'), b = makeDay('CHECK-1');
  assert.deepEqual(a, b);
  assert.deepEqual(makeRealization(a), makeRealization(b));
  assert.notDeepEqual(makeRealization(a).hours, makeRealization(makeDay('CHECK-2')).hours);
  const s = makeScenarios(a, [], warningsAt(a, makeRealization(a).outcomes, -1), 12);
  assert.equal(s.length, 12);
  assert.deepEqual(s, makeScenarios(b, [], warningsAt(b, makeRealization(b).outcomes, -1), 12));
  assert.notDeepEqual(s[0], s[1]);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.forecast.hours[0]), 'Public day is immutable');
});

test('Twelve hours from 08:00; weather respects physical bounds; errors persist across hours', () => {
  const pairs = [];
  for (let i = 0; i < 40; i++) {
    const d = makeDay(`WEATHER-${i}`), {hours} = makeRealization(d);
    assert.deepEqual(d.forecast.hours.map(h => h.clockHour), Array.from({length: HOURS}, (_, h) => START_HOUR + h));
    hours.forEach((a, h) => {
      assert.ok(a.demand >= 300 && a.demand <= 950);
      assert.ok(a.wind >= 0 && a.wind <= WIND_CAPACITY);
      assert.ok(a.solar >= 0 && a.solar <= SOLAR_CAPACITY);
      if (START_HOUR + h >= 18) assert.equal(a.solar, 0);
      const stormy = d.events.some(e => e.kind === 'storm');
      if (h > 0 && !stormy) pairs.push([hours[h - 1].wind - d.forecast.hours[h - 1].wind, a.wind - d.forecast.hours[h].wind]);
    });
  }
  const mean = k => pairs.reduce((s, p) => s + p[k], 0) / pairs.length, m0 = mean(0), m1 = mean(1);
  const cov = pairs.reduce((s, p) => s + (p[0] - m0) * (p[1] - m1), 0), v0 = pairs.reduce((s, p) => s + (p[0] - m0) ** 2, 0), v1 = pairs.reduce((s, p) => s + (p[1] - m1) ** 2, 0);
  assert.ok(cov / Math.sqrt(v0 * v1) > 0.6, 'Wind errors persist rather than being independent spikes');
});

test('Days vary: archetypes, titles and peak hours differ across seeds', () => {
  const days = Array.from({length: 120}, (_, i) => makeDay(`VARIETY-${i}`));
  const kinds = new Set(days.flatMap(d => d.archetypes));
  assert.deepEqual([...kinds].sort(), ['fog', 'heatwave', 'storm', 'surge', 'trip']);
  assert.ok(days.some(d => d.archetypes.length === 0) && days.some(d => d.archetypes.length === 2));
  const peaks = new Set(days.map(d => d.forecast.hours.reduce((a, h) => (h.demand > a.demand ? h : a)).clockHour));
  assert.ok(peaks.size >= 2, 'Evening peak hour varies');
  const heat = days.find(d => d.archetypes.includes('heatwave'));
  assert.equal(heat.forecast.hours.reduce((a, h) => (h.demand > a.demand ? h : a)).clockHour, 19, 'Heatwave moves the peak to 19:00');
});

test('Campaign configs switch off wind, solar and units', () => {
  const d = makeDay('RULES', {archetypes: [], rules: {wind: false, solar: false, disabled: 6}});
  assert.ok(d.forecast.hours.every(h => h.wind === 0 && h.solar === 0));
  assert.ok(makeRealization(d).hours.every(h => h.wind === 0 && h.solar === 0));
  assert.equal(d.rules.disabled, 6);
  assert.equal(d.events.length, 0);
});

test('Events change the realized day: storms cut wind, fog cuts solar, surges add demand, trips take units out', () => {
  const seen = new Set();
  for (let i = 0; i < 200 && seen.size < 4; i++) {
    const d = makeDay(`EVENTS-${i}`), r = makeRealization(d);
    d.events.forEach((ev, k) => {
      const o = r.outcomes[k];
      if (!o.occurs) return;
      const t = o.start, a = r.hours[t], f = d.forecast.hours[t];
      if (ev.kind === 'storm') { assert.ok(a.wind <= f.wind * 0.5 + 60); seen.add('storm'); }
      if (ev.kind === 'trip') { assert.ok(a.outage & (1 << ev.unit)); seen.add('trip'); }
      if (ev.kind === 'surge') { assert.ok(a.demand >= f.demand + 70 - 120); seen.add('surge'); }
      if (ev.kind === 'fog' && f.solar > 50) { assert.ok(a.solar < f.solar); seen.add('fog'); }
    });
  }
  assert.equal(seen.size, 4);
});

test('Warnings never leak: occurring and non-occurring events look identical until resolution', () => {
  for (let i = 0; i < 150; i++) {
    const d = makeDay(`WARN-${i}`), {outcomes} = makeRealization(d);
    d.events.forEach((ev, k) => {
      const o = outcomes[k], flipped = outcomes.map((x, j) => (j === k ? {...x, occurs: !x.occurs} : x));
      const resolve = o.occurs ? o.start - ev.notice : ev.window[1] - ev.notice;
      const resolveOther = !o.occurs ? flipped[k].start - ev.notice : ev.window[1] - ev.notice;
      for (let h = -1; h < Math.min(resolve, resolveOther); h++) {
        assert.deepEqual(warningsAt(d, outcomes, h)[k], warningsAt(d, flipped, h)[k], `${d.seed} event ${k} leaked at hour ${h}`);
      }
      const final = warningsAt(d, outcomes, HOURS)[k];
      assert.equal(final.status, o.occurs ? 'over' : 'cleared');
    });
  }
});

test('Warning probability updates by Bayes as the window passes; notice confirms ahead of start', () => {
  const ev = {window: [4, 7], notice: 2, prob: 0.6};
  assert.deepEqual(eligibleStarts(ev, -1), [4, 5, 6, 7]);
  assert.deepEqual(eligibleStarts(ev, 3), [6, 7]);
  const d = makeDay('BAYES', {archetypes: ['storm'], events: {storm: {prob: 0.6}}});
  const no = [{occurs: false, start: 5, duration: 3, amount: 0}], yes = [{occurs: true, start: d.events[0].window[0] + 2, duration: 3, amount: 0}];
  const probs = Array.from({length: 6}, (_, h) => warningsAt(d, no, h - 1)[0]).filter(w => w.status === 'possible').map(w => w.prob);
  for (let i = 1; i < probs.length; i++) assert.ok(probs[i] <= probs[i - 1] + 1e-12, 'Probability never rises while unconfirmed');
  const confirmAt = yes[0].start - 2;
  assert.equal(warningsAt(d, yes, confirmAt - 1)[0].status, 'possible');
  assert.equal(warningsAt(d, yes, confirmAt)[0].status, 'confirmed');
  assert.equal(warningsAt(d, yes, yes[0].start)[0].status, 'active');
  assert.equal(clockLabel(12), '20:00');
});

test('Scenarios copy revealed history and honour confirmed and cleared warnings', () => {
  const d = makeDay('SCEN', {archetypes: ['storm'], events: {storm: {prob: 0.7}}}), {hours, outcomes} = makeRealization(d);
  const h = 2, history = hours.slice(0, h + 1);
  const confirmed = [{...warningsAt(d, outcomes, h)[0], status: 'confirmed', prob: 1, start: 5, end: 7}];
  const cleared = [{...confirmed[0], status: 'cleared', prob: 0}];
  for (const s of makeScenarios(d, history, confirmed, 8)) {
    assert.deepEqual(s.slice(0, h + 1), history);
    assert.ok(s[5].wind <= Math.max(1, makeScenarios(d, history, cleared, 1)[0][5].wind));
  }
  const calm = makeScenarios(d, history, cleared, 8);
  const stormy = makeScenarios(d, history, confirmed, 8);
  assert.ok(stormy.reduce((s, p) => s + p[5].wind, 0) < calm.reduce((s, p) => s + p[5].wind, 0));
});
