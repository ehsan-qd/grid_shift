# Grid Shift — validation

Validated on 16 October 2026 against the source in `dist/` and the generated standalone `grid-shift.html`.

## Automated checks

`node --test tests/*.test.mjs`: **60 tests pass** across six suites.

- **world:**
  - seeded determinism and physical bounds
  - persistent forecast errors and day-to-day variety (all five day types, calm and double-event days, peak hour varies, heatwave peaks at 19:00)
  - campaign rule switches
  - event effects (storm, fog, surge, trip)
  - warnings: occurring and non-occurring events are indistinguishable until resolution, probabilities never rise while unconfirmed, and confirmation arrives with the stated notice
  - scenarios copy revealed history and honour confirmed and cleared warnings
- **engine:**
  - merit-order dispatch, curtailment and online charges
  - brownout and blackout tiers
  - tripped units
  - start-up and plan-change accounting
  - notice locks (nuclear fixed, C1 2 hours, C2 1 hour, gas instant, campaign override)
  - run-flip edits and plan validation
  - the DP against brute force
  - recourse valuation
  - starter plans and gas cover
- **session:**
  - the hidden day and opponent are withheld until results
  - notice periods are enforced for the player
  - all three opponents read only public inputs (proxy test) and respect notice
  - ORBIT reacts to surprises
  - full playthroughs reconcile row by row
  - views are defensive copies
  - a skilled player both wins and loses against ORBIT
- **scoring:**
  - hindsight is a lower bound, so efficiency ≤ 100%
  - star thresholds and medal rules
  - coaching regrets reconcile exactly (plan regret + in-shift regret = your total − hindsight)
  - share text
- **experience:**
  - chart rows never read beyond the revealed prefix
  - the uncertainty band narrows as hours reveal
  - decision cards are distinct, legal under notice rules and priced correctly
  - projection is deterministic
  - alerts and warning changes stop the clock
  - Skip ignores check-ins but not decisions
  - run tickets reject stale or duplicate callbacks
- **ux-model:**
  - v3 saves restore plan, play and results; illegal drafts fall back
  - old and tampered saves are rejected
  - campaign saves rebuild campaign days
  - the CSV export reconciles
  - the tour is isolated and deterministic
  - campaign unlocks and goals work
  - the daily code is date-based
  - the standalone build has no external references

`node scripts/balance.mjs 80`: all eight balance targets pass (numbers in the README).

Campaign audit (scripted players on each day's fixed seed):
- Days 1–3, 6 and 9 are winnable with one-click play.
- Days 4, 5, 7, 8 and 10 need better play.
- Every goal is met by expert or ORBIT-level play.
- No campaign day, and none of 400 random days, has physically unavoidable unserved demand, so the Lights-on medal is always achievable.

## Browser verification

Headless Google Chrome, driven over the DevTools protocol, with console errors and exceptions captured. Pages tested:
- the standalone file (`file://`)
- the source served over HTTP from `dist/` (separate ES modules, as on Vercel)

**Zero console errors or exceptions in every run.**

| Area | What was checked |
|---|---|
| Home | Campaign track, today's shift, free-play code form, opponent picker; progress and stars appear after completing days |
| Plan | Presets, unit toggles, undo, warning chips and chart markers, band, carbon estimate, commit |
| Play | Full eventful shift (`EVENT-16`, storm + cup final), detailed below |
| Results | Stars, efficiency, both medals, campaign goal and next-day button, personal best, coach with replay link, relative cost race, replay against opponent and hindsight; details, audit and share dialogs (clipboard is blocked in headless Chrome, so the share dialog fallback was exercised) |
| Tour | All six steps, interactive option step, score step, close |
| Phone layout | 390 px and 320 px: no horizontal page overflow on home, plan, play, results or tour; the chart keeps a legible minimum width and scrolls inside its panel |

Play checks on `EVENT-16`:
- Storm confirmed at 11:00, two hours ahead.
- Notice lock toast ("C2 needs notice: from 12:00").
- Blackout at 13:00 with dark districts and the hospital on backup.
- Gas, coal-bridge and stand-down cards.
- Shortage confirmation dialog.
- Run carries quiet hours at 1.5 s with a check-in after four.
- Skip runs to the next real event.
- Reload mid-shift restores the same hour, paused.

Issues found and fixed during this verification:
- The MW axis label overlapped the chart.
- Toasts covered the decision cards; they now sit at the top.
- Skip stopped at quiet check-ins.
- The carbon budget came from the forecast, so storm days were unwinnable; it is now graded against hindsight.
- The cost race lines were indistinguishable; they are now drawn as £ above hindsight.
- Campaign Day 1 had an infeasible evening peak (demand scale added).
- The gas card vanished when a brownout was cheaper; it is now always offered with an honest price.
- Small-screen overflow in the coach tag and dialogs.

## Not covered

- Reduced-motion behaviour is implemented (tour starts paused; CSS animations disabled) but was not emulated in the browser.
- The CSV download was exercised by tests on the export function, not by saving a file from the browser.
- Real players have not yet played this version. The balance numbers come from scripted strategies.
