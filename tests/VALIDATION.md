# Grid Shift command deck — validation

Validated on 15 October 2026. Source: `grid-shift-game/dist`. The delivered standalone is generated from those source files; there are no external assets or runtime dependencies.

## Automated checks

`node --test tests/*.test.mjs`: **30 tests passed**. The new experience suite covers:

- Cover and trim decisions against all feasible fleet states, including startup and plan-change costs; reserve finds the least costly eligible 90 MW cushion while preserving online units.
- Actual wind, cloud and demand events, shortage recovery, and persistent versus materially worsening errors.
- Twelve chart columns reconciled to dispatch. Past columns use settled actions; the current column previews the draft; future columns use central forecast and submitted plan. A guarded revealed-history array rejects attempts to read beyond the revealed prefix. Changing a draft changes only its current chart column.
- Progression tokens reject stale callbacks after pause/resume, wrong-hour callbacks, duplicate settlement and skipped hours. Three quiet hours trigger a check-in. Meaningful events and completion stop progression.
- A full progressed shift, identical actual conditions for both players, complete cost reconciliation and reliability streaks.
- Save restoration and undo preserve the submitted plan, with no automatic progression on reload. Fresh sessions reset progress.
- Tour chart shortage and recovery use an isolated example and do not change a live session.

Existing engine and UX tests continue to cover the 08:00–20:00 horizon, independent random streams, capacity and dispatch, curtailment, startup/deviation/shortage accounting, scenario DP, causal rolling ORBIT, hidden future/opponent information, human wins and losses, save validation, CSV fields and defensive state copies.

`node --check dist/app.mjs` passed. The standalone builder reports zero external assets. ZIP integrity and standalone identity are checked during packaging.

## Browser verification

Tested the source preview and actual generated standalone HTML in the in-app browser, served locally. The delivered HTML itself was played, rather than only the source module entry point. Desktop was approximately 1280×720; responsive inspection included 390×844 and 320×740. There was no horizontal page overflow at either phone width.

- Planning: presets, plan undo, chart-hour selection, individual generator edits, explicit commitment and new day code.
- Chart: revealed current/past demand versus future forecast, source stacks, red gap and spare outline, future-column inspection, return to current hour, immediate preview response to cover/reserve actions.
- Progression: immediate Run/Pause leaves the hour unchanged. Run reached a three-hour checkpoint; new wind and cloud alerts paused the shift. Manual Step advanced one hour. A deliberate double-click advanced only once. Both browser playthroughs completed twelve hours without skips or duplicates.
- Recovery: SHIFT-26 at 10:00 produced a 31.1 MW shortage under the submitted mix. Cover gap restored supply to 565 MW, added spare capacity, and changed the cost preview from £82,110 (including £77,750 shortage penalty) to £7,293. Reload preserved that draft and remained paused. Restore submitted mix returned the gap; Undo restored the recovered draft. Keep reserve raised the 11:00 spare capacity from 43 MW to 133 MW; Undo returned the original cost and draft.
- Tour: manually paused/stepped through the wind-drop event and one-click recovery. The demo moved from 490/620 MW and a 130 MW gap to 620/620 MW and 50 MW spare. Closing the demo left the live app text identical. Autoplay was launched separately; a final post-autoplay completion observation was not required for delivery and is not claimed here. Reduced-motion behavior is implemented by manual initial progression and CSS animation suppression; the preference was not separately emulated in the browser.
- Results: hourly replay, ORBIT reasoning, cost/impact table, results reload and CSV download. The optional browser download took an unusually long time to return; it eventually returned a real file, which was independently read and verified. No outstanding local-delivery approval remains.
- Layout fixes from inspection: desktop transport no longer covers decision cards; mobile spacing was compressed and the decorative city is suppressed at 320 px to preserve chart/control space. Cost chart end-label margins and compact replay markers were adjusted after visual review.

### Reconciled complete-shift result

Both source and standalone playthroughs used Balanced SHIFT-26 and Cover gap at 10:00, with other draft experiments undone before settlement.

|Component|Player|ORBIT|
|---|---:|---:|
|Running + online|£119,477.20|£118,994.80|
|Startup|£22,900.00|£19,600.00|
|Plan changes|£1,300.00|£0.00|
|Shortage penalty|£0.00|£0.00|
|Total|**£143,677.20**|**£138,594.80**|
|Demand served|7,065.7 MWh|7,065.7 MWh|
|Unmet demand|0 MWh|0 MWh|

These match an independent model run. The CSV has 24 rows, twelve per player, clocks 08:00 through 19:00, identical actual conditions, and matching cost-component totals. The original submitted plan remained unchanged; the player's 10:00 action differed by the added C2 unit.

## Deliverables and hosting

- `grid-shift.html`: one offline-capable, self-contained game.
- `grid-shift-game.zip`: owning source, standalone copy, build script, tests and this validation record.
- `grid-shift-preview.jpg`: command deck after recovery.
- `grid-shift-event.jpg`: cloud-front shortage and the available one-click responses.

Existing private Site identity is retained: `appgprj_6ad0d4f0edb081919d659bdce7d6511a`, static directory `dist`. Port Shift is untouched.

Hosted publication is not completed or claimed. The previously attempted Site helper credential input was rejected with `write_stdin rejected: approval required by policy, but AskForApproval::Granular.sandbox_approval is false`. This release does not retry or bypass that restriction. Local packaging is independent of that publishing step.
