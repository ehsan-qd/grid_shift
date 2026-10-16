# Grid Shift — command deck edition

A playable browser game about scheduling power generation and responding to uncertain demand and weather. The shift is **08:00–20:00: twelve genuine one-hour decisions**. This edition centres the shift on a demand/generation chart, one-click decisions, weather-driven pauses and a visible city power balance. The underlying twelve-hour commitment model and fair ORBIT comparison are retained.

## Play and develop

Open `grid-shift.html` in this project folder directly in a modern browser. All application code, styles and graphics are inlined. No build service, internet connection or external asset is required. Browser storage is optional; a browser that denies it still supports play.

The owning static source is `dist/`:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
node --test tests/*.test.mjs
node scripts/build-local.mjs
```

The standalone builder writes `grid-shift.html` in this project folder. Hosted identity stays in `.openai/hosting.json` with the existing private Grid Shift project and `dist` directory. Port Shift is a separate project and is untouched. Publication remains subject to the previously reported execution-policy block; no deployment is claimed.

## New experience

- A full-shift stacked generation chart is the main play surface. Nuclear, coal, gas, wind and solar show delivered generation; outlined segments show spare capacity; striped red segments show gaps. Forecast demand is dashed gold, revealed actual demand is solid white. Future columns are faded and hatched. Select a column to inspect it, or return to the live hour.
- Choose Lean, Balanced (50 MW reserve target), or More reserve (110 MW target), then explicitly commit the schedule. Individual units and copying a mix across all hours remain available under an optional control. The first fresh game uses day code SHIFT-26, an ordinary seeded realization with a recoverable cloud-related shortage. New codes produce different days.
- **Cover gap** adds capacity while preserving existing units. **Trim cost** searches all 64 states for the cheapest current-hour total with demand met. **Keep reserve** adds capacity for at least 90 MW spare. Buttons preview the full cost difference, including starts and plan deviations. Assist changes can be undone or restored to the submitted mix before settlement. These simple aids do not optimize future costs or use ORBIT's plan.
- **Run** advances one hour every four seconds. It stops when a new significant forecast error arrives (wind or solar at least 45 MW below forecast, demand at least 40 MW above), an existing weather error worsens by 30 MW, or the current submitted mix leaves a gap. Covered persistent weather does not repeatedly stop the shift. It also checks in after at most three hours. **Pause** and **Step** allow deliberate play; there is no time penalty. Editing, inspection, opening a dialog/tour, leaving the tab, and reload all pause progression. Every callback carries a run generation and hour token; stale or repeated callbacks cannot settle a second hour.
- The city responds to the actual served fraction. Current alerts describe existing realized conditions; they do not inject extra effects. Both sides still receive exactly the same physical conditions. Results show a cumulative cost race, reliability, and the existing hourly decision replay and full accounting.
- Quick tour is an approximately 25-second animated, interactive demonstration of the new chart, run/pause, wind-drop recovery, and cost comparison. Pause, step, skip and replay are available. It uses an isolated example with computed dispatch and results; it never writes to the live game or storage. Reduced-motion users start with manual progression and all decorative animation is disabled.
- Existing version 2 twelve-hour saves remain compatible, including unsettled changes. Progression always resumes paused. Incompatible older twenty-four-hour saves are ignored. The game works even if browser storage is unavailable.

## Rules and accounting

All conventional units begin off at 08:00. Commit one on/off schedule for all twelve hours. Each revealed hour starts from that submitted schedule; real-time changes apply to that hour only. The submitted plan is copied independently of actual decisions.

Renewables dispatch first, with proportional curtailment when excess. Committed conventional units then dispatch by increasing variable cost from zero to capacity. Idle online units still incur their hourly online cost. Switching is instant at hour boundaries: no ramps, startup delays, minimum up/down times or minimum outputs. No network or market bidding.

Both players minimize running + startups + hourly plan deviations + shortage penalties. Running includes generated MWh times rate plus the online hourly charge. A startup is an off-to-on edge from the previous settled hour. Each settled unit state differing from its submitted state incurs one change charge, on or off. Repeated toggling before settlement is free. Unmet demand costs £2,500/MWh. Each hour is exactly one hour, so its MW shortage equals MWh unserved.

|Unit|Type|MW|£/MWh|Online £/h|Start £|Change £|Direct tCO₂/MWh|
|---|---|---:|---:|---:|---:|---:|---:|
|N1 Northbank|Nuclear|240|14|1000|10000|2400|0.012|
|C1 Ironbridge|Coal|180|34|550|4500|1600|0.92|
|C2 Moorfield|Coal|140|39|420|3400|1300|0.96|
|G1 Riverside|Gas|180|67|180|1000|800|0.36|
|G2 Eastgate|Gas|120|90|90|600|600|0.43|
|G3 Hilltop|Gas|90|115|50|350|450|0.49|

Wind capacity is 280 MW, solar 300 MW, with zero operating cost. Emissions and curtailment are reported separately, not priced into the objective. Money and direct generation factors are illustrative, not real tariffs or lifecycle emissions. Displayed money is rounded; ledgers preserve original values and CSV exports four decimal places.

## Actual ORBIT simulator method

The local simulator is not connected to production ORBIT. It makes no claim of quantum advantage, measured superiority or general stochastic optimality.

1. A central forecast covers hours 08 through 19. Distinct versioned random streams generate the forecast, hidden realized shift and each planning scenario. Errors are persistent and physically bounded.
2. ORBIT independently generates twelve plausible paths. A dynamic program searches 12 hours × 64 on/off fleet states × 64 predecessor states. Each state uses scenario-average running and shortage costs, and transitions include startup costs. It chooses one common nonanticipative submitted plan.
3. Each current-hour revelation triggers a rolling-horizon replan. The policy accepts only the forecast, revealed prefix, own submitted plan and previous settled commitment. Conditional scenarios start from the latest revealed errors; current conditions are known, future conditions are uncertain. Plan-change charges are included. Only the current action is implemented.
4. The hidden realized array stays in the session closure. Opponent plans/actions are withheld until results. Both players receive identical actual conditions and rules. This is a gameplay information boundary, not adversarial browser security.

The DP is exact for its finite scenario-average scheduling model; it is not a full scenario tree with globally optimal contingent recourse. The player helpers use central forecasts/current-hour conditions, never the opponent’s plan. A human can win or lose based on decisions.

## Code and validation

- `engine.mjs`: weather, dispatch, objective, DP, causal policy and session.
- `support.mjs`: starter schedules, current-gap aid, save validation, 24-record export and isolated tour example.
- `experience.mjs`: public chart data, one-click decisions, weather events, intervention rules and guarded progression controller.
- `app.mjs`: interface, secondary views, persistence and tour animation.
- `styles.css`: responsive controls and shared game/demo visuals.
- `tests/engine.test.mjs`, `tests/ux-model.test.mjs`, `tests/experience.test.mjs`: thirty model and interaction-state tests.
- `tests/VALIDATION.md`: browser and artifact verification evidence for this release.

Background: [PyPSA unit commitment](https://docs.pypsa.org/stable/examples/unit-commitment/) and [stochastic optimization](https://docs.pypsa.org/latest/user-guide/optimization/stochastic/). Grid Shift implements its own small JavaScript model.

## Local Documents copy

This complete project was copied to `/Users/ehsanmassah/Documents/grid_shift` on 16 October 2026. The canonical source and earlier outputs remain unchanged. The `outputs/` folder retains the delivered HTML, source archive, and preview screenshots; the top-level `grid-shift.html` is the convenient playable copy and the target of the local build command.

The source repository had no commits or refs. A clean local Git repository is initialized here on `main`, with all project files uncommitted and no remote configured. No credentials, transient runtime state or caches were copied. The existing non-secret private Site identity remains in `.openai/hosting.json`; copying this project does not publish it.
