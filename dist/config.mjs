/** Grid Shift tuning. Every gameplay number lives here so balance changes are one-file edits.
 * Run `node scripts/balance.mjs` after changing anything in this file. Money is illustrative GBP. */
export const VERSION = 3;
export const HOURS = 12;
export const START_HOUR = 8;
export const WIND_CAPACITY = 280;
export const SOLAR_CAPACITY = 300;

/** `lead` is the notice (hours) a change needs during the shift; null means fixed for the whole shift. */
export const FLEET = Object.freeze([
  {id: 'N1', name: 'Northbank', type: 'Nuclear', capacity: 240, rate: 14, fixed: 1000, startup: 10000, change: 1200, co2: 0.012, lead: null},
  {id: 'C1', name: 'Ironbridge', type: 'Coal', capacity: 180, rate: 34, fixed: 550, startup: 4500, change: 320, co2: 0.92, lead: 2},
  {id: 'C2', name: 'Moorfield', type: 'Coal', capacity: 140, rate: 39, fixed: 420, startup: 3400, change: 260, co2: 0.96, lead: 1},
  {id: 'G1', name: 'Riverside', type: 'Gas', capacity: 180, rate: 67, fixed: 500, startup: 1000, change: 160, co2: 0.36, lead: 0},
  {id: 'G2', name: 'Eastgate', type: 'Gas', capacity: 120, rate: 90, fixed: 350, startup: 600, change: 120, co2: 0.43, lead: 0},
  {id: 'G3', name: 'Hilltop', type: 'Gas', capacity: 90, rate: 125, fixed: 250, startup: 350, change: 90, co2: 0.49, lead: 0},
].map(Object.freeze));

/** Unmet demand up to `brownoutShare` of the hour's demand is a brownout; the rest is a blackout. */
export const SHORTAGE = Object.freeze({brownoutShare: 0.03, brownoutPrice: 300, blackoutPrice: 2500});

/** Rules a campaign day can change. errorScale multiplies all forecast errors; demandScale sizes demand to the fleet. */
export const DEFAULT_RULES = Object.freeze({disabled: 0, leadTimes: true, wind: true, solar: true, errorScale: 1.3, demandScale: 1});

/** Weather alerts (MW versus forecast) that pause a running shift. */
export const ALERTS = Object.freeze({wind: -40, solar: -40, demand: 35, worsen: 25});

export const PRESETS = Object.freeze({
  lean: Object.freeze({label: 'Lean', note: 'forecast only', margin: 0}),
  balanced: Object.freeze({label: 'Balanced', note: '+50 MW', margin: 50}),
  reserve: Object.freeze({label: 'More reserve', note: '+110 MW', margin: 110}),
});

/** Hours the starter plans look ahead. Short on purpose: presets are starting points, not answers. */
export const PRESET_LOOKAHEAD = 4;

export const RUN = Object.freeze({quietMs: 1500, skipMs: 350, checkInHours: 4});

/** Efficiency (hindsight-optimal cost ÷ your cost) needed for one, two and three stars. */
export const STAR_THRESHOLDS = Object.freeze([0.92, 0.96, 0.985]);

/** Carbon medal: emit no more than this share of what the cheapest possible shift for the actual weather emits. */
export const CARBON_TARGET_SHARE = 1;

export const SCENARIOS = Object.freeze({orbit: 12, operator: 3, band: 24, options: 8});

export const OPPONENTS = Object.freeze({
  rookie: Object.freeze({name: 'Rookie', blurb: 'Plans each hour on its own, ignoring start-up costs, and patches gaps with gas.'}),
  operator: Object.freeze({name: 'Operator', blurb: 'Plans across 3 weather scenarios, then patches gaps with gas.'}),
  orbit: Object.freeze({name: 'ORBIT', blurb: 'Plans across 12 scenarios and replans every hour.'}),
});

/** Day types. Events are public warnings with a probability; both players face the same outcome. */
export const ARCHETYPES = Object.freeze({
  storm: Object.freeze({title: 'Storm front', mission: 'A storm front may shut the wind farms down this afternoon.'}),
  trip: Object.freeze({title: 'Faulty pump', mission: 'A plant is running on a faulty pump and could trip without warning.'}),
  fog: Object.freeze({title: 'Morning fog', mission: 'Fog could smother solar output until late morning.'}),
  heatwave: Object.freeze({title: 'Heatwave', mission: 'Air-conditioning pushes the evening peak later and higher.'}),
  surge: Object.freeze({title: 'Cup final', mission: 'The final whistle sends kettles and TVs on at once.'}),
});
export const ARCHETYPE_ODDS = Object.freeze({calm: 0.12, second: 0.45});
