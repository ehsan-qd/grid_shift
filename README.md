# Grid Shift

A browser game about keeping a city's lights on through a twelve-hour shift (08:00–20:00). You choose which power stations run; the weather, demand and the occasional breakdown don't follow the forecast. You're graded against the best possible shift in hindsight and race an opponent who faces exactly the same day.

## Play and develop

Open `grid-shift.html` in a modern browser. It is one self-contained file that works offline. Browser storage is optional.

The source lives in `dist/` (served as-is in production):

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist   # play the source build
node --test tests/*.test.mjs                                     # 60 model and interaction tests
node scripts/balance.mjs 80                                      # simulate 80 days and check the fun targets
node scripts/build-local.mjs                                     # rebuild grid-shift.html
```

Every gameplay number lives in `dist/config.mjs`. After changing one, run the balance script and the tests.

## Deploy to Vercel

Import the repository with the **Root Directory** left blank. The root `vercel.json` selects the **Other** preset, skips the build step and serves `dist/`, whose homepage is `dist/index.html`. No dependencies or environment variables are needed.

## How it plays

**Modes**
- **Campaign:** ten hand-made days that introduce one mechanic at a time: nuclear and gas, then coal, wind, solar and fog, coal notice, heatwave, plant trip, storm, cup final, and finally everything at once. Each day has a goal (stars, sometimes a medal), and meeting it unlocks the next.
- **Today's shift:** a date-based code (`DAY-2026-10-16`) so everyone plays the same day.
- **Free play:** any day code.

For today's shift and free play, pick an opponent:
- **Rookie:** plans each hour on its own and patches gaps with gas.
- **Operator:** plans across 3 weather scenarios.
- **ORBIT:** plans across 12 scenarios and replans every hour.

**Plan.**
- Read the day's mission and warnings, then choose a starting plan: Lean, Balanced (+50 MW) or More reserve (+110 MW).
- Edit any hour, then commit.
- The chart's shaded band shows the likely range of demand your units must cover. Markers show warning windows.
- Presets look only four hours ahead and ignore warnings. They are starting points, not answers.

**Play.**
- **Run** advances quiet hours every 1.5 s and checks in after four. **Skip** races to the next real decision. **Step** settles one hour.
- The clock stops for blackouts, new brownouts, warning changes (storm confirmed, plant tripped, all clear) and new or worsening forecast misses.
- Decision cards offer concrete moves: hold course, fire up gas, order coal (with a gas bridge if needed) or stand a unit down. Each shows its cost this hour and projected to 20:00 across likely weather. They inform; they don't optimise.
- Switching a unit yourself applies from the selected hour until that unit's next scheduled change.

**Results.**
- **Efficiency** = perfect-hindsight cost ÷ your cost. Stars at 92%, 96% and 98.5%.
- **🛡 Lights on:** no unserved demand at all.
- **🌿 Carbon:** emit no more than the cheapest possible shift for that weather would have.
- The coach names your costliest call and splits your gap into plan and in-shift regret.
- Also shown: a cost race measured above hindsight, an hour-by-hour replay against your opponent and hindsight, personal bests, a copyable share line and a CSV export.

## Rules and accounting

Running cost = MWh × rate + the hourly online charge (paid even at 0 MW). Starting a unit from off costs its start-up. Each hour a unit differs from your committed plan costs its change charge. Unserved demand up to 3% of the hour's demand is a brownout at £300/MWh; the rest is a blackout at £2,500/MWh. All units start off at 08:00. Renewables dispatch first; committed units then run cheapest first. There are no ramp limits, minimum outputs or network constraints.

|Unit|Type|MW|£/MWh|Online £/h|Start £|Change £/h|Notice|tCO₂/MWh|
|---|---|---:|---:|---:|---:|---:|---|---:|
|N1 Northbank|Nuclear|240|14|1,000|10,000|1,200|Fixed for the shift|0.012|
|C1 Ironbridge|Coal|180|34|550|4,500|320|2 hours|0.92|
|C2 Moorfield|Coal|140|39|420|3,400|260|1 hour|0.96|
|G1 Riverside|Gas|180|67|500|1,000|160|Instant|0.36|
|G2 Eastgate|Gas|120|90|350|600|120|Instant|0.43|
|G3 Hilltop|Gas|90|125|250|350|90|Instant|0.49|

Wind capacity is 280 MW and solar 300 MW. Forecast errors persist from hour to hour (AR(1)).

**Day types.** A day draws zero to two of the following; both players always face the same outcome:

| Day type | What happens | Notice |
|---|---|---|
| Storm front | Wind farms shut down | Confirmed 2 hours ahead |
| Faulty pump | A plant trips offline | 1-hour vibration alarm |
| Morning fog | Solar is smothered | None |
| Heatwave | Evening peak moves later and higher | Known in the forecast |
| Cup final | Demand surges at the final whistle | Confirmed 2 hours ahead |

Warnings show a probability that updates by Bayes' rule as the window passes.

Money and emission factors are illustrative.

## Opponents and the ORBIT simulator

Opponents receive only public information: the forecast, warnings, revealed hours and their own schedule. The hidden day lives inside the session closure. ORBIT is a local simulator, not a production service, and makes no claim of optimality. It works in three steps:

1. Twelve plausible weather paths are sampled from separate random streams. They are conditioned on revealed errors and current warning states.
2. An exact dynamic program over all 64 on/off fleet states chooses the schedule with the lowest scenario-average cost. Future hours are valued as if gaps can be patched with instant gas, a two-stage recourse approximation.
3. Every hour it replans with plan-change charges, respecting the same notice periods as you, and implements only the current hour.

## Balance targets

`node scripts/balance.mjs 80` plays 80 days with scripted players and checks:

|Target|Last run|
|---|---|
|Each preset is the best choice on ≥20% of days|Lean 31%, Balanced 28%, More reserve 41%|
|Expert in-shift play beats one-click play by ≥1.5 efficiency points|2.0 points|
|A better plan (ORBIT's) beats the Balanced preset by ≥1 point|1.7 points|
|4–8 pauses per shift|4.5|
|Balanced + one-click beats Rookie ≥60%|78%|
|Skilled play beats ORBIT 20–60% of the time|26%|
|One-click averages 1–2★; ORBIT ≥2★|1.43★ / 2.33★|
|ORBIT earns the carbon medal on 20–70% of days|51%|

One-click play leaves about 3.4 efficiency points on the table during the shift. About 1.6 of those are irreducible uncertainty, so roughly 2 points of in-shift skill is the ceiling in this model.

## Code map

| File | What it holds |
|---|---|
| `config.mjs` | All tuning |
| `world.mjs` | Days, forecasts, events, warnings, hidden realization, scenarios |
| `engine.mjs` | Dispatch, settlement, notice locks, DP solver, starter plans |
| `opponents.mjs` | Rookie, Operator and ORBIT |
| `session.mjs` | The information boundary |
| `scoring.mjs` | Hindsight, stars, medals, coaching, share text |
| `experience.mjs` | Chart rows, uncertainty band, decision cards, alerts, run control |
| `campaign.mjs` | Campaign days and the daily code |
| `support.mjs` | Saves, CSV, tour example |
| `ui-*.mjs` | Markup for views, charts, dialogs and the tour |
| `app.mjs` | State, persistence and events |
| `styles.css` | Styles |

`scripts/build-local.mjs` bundles the modules (each in its own scope) into `grid-shift.html`. `tests/VALIDATION.md` records the browser verification for this release. `outputs/` holds current screenshots.
