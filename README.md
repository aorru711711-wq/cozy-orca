# Cozy Orca

A quiet pixel sailboat that follows all agent work exposed by the local Orca CLI. The original dusk artwork uses a 144 × 72 pixel canvas, displayed at 2× by default.

## Launch the portable Windows app

Keep the portable `Cozy Orca-win32-x64` folder on drive **E:**. The current package is `dist/v1.1.0/Cozy Orca-win32-x64`. Double-click **Launch Cozy Orca.cmd** inside that folder. No installation or administrator access is needed. Orca must already be running for live status; the companion reconnects automatically.

- Drag the scene to move it. It starts above the taskbar in the bottom-right corner.
- Hover to reveal the **···** settings button. Right-click also opens settings.
- Choose **2×**, **3×**, or **4×**, toggle **Reduced motion**, or reset its position.
- Click the sailboat tray icon to hide or show it. Right-click the tray icon for settings or **Quit Cozy Orca**. Windows may put the icon in the tray overflow.
- Size, position, and reduced motion survive restart. Starting a second copy shows the first.

The companion stays above ordinary apps and browser fullscreen video without activating itself when shown. Exclusive fullscreen applications, secure Windows screens, and other topmost overlays can take precedence. It reports work; it never pauses or resumes an agent. There is no sound, notification, automatic startup, telemetry, or cloud service.

## Status

| Label | Meaning |
| --- | --- |
| Working | At least one agent/workspace reports work. The sail is raised and water moves. |
| Working · needs input | Work continues while another agent is waiting or blocked. The lantern lights. |
| Needs input | No work is active; Orca reports waiting or blocked work. |
| Paused | The most recently ended agent explicitly reports interruption/cancellation. |
| Idle | No active work is reported in a complete snapshot. |
| Finished | Previously observed agents ended; a three-second glow plays once. This does not mean success. |
| Disconnected | Orca cannot be reached or its CLI is missing. Retrying automatically. |
| Status unavailable | Timeout, stale or unknown status, malformed data, truncated listing, or omitted hosts. |

The fleet CLI is read every two seconds after the previous request finishes, with a five-second timeout and no overlapping requests. Task inventory uses the same rule and waits its turn, as described below. Monitoring covers hosts returned by the current local Orca connection; omitted hosts make the status unavailable. Disconnection or disappearing rows never trigger a completion glow. Startup does not replay past completions.

The bottom line is one pill. The status dot stays separate. A known total looks like `Working · 3 crew · 1h 24m · ✓7/10`. When the total is unknown, it looks like `Working · 1 crew · 12m · ✓7`, and the tooltip says these are observed turns. The pill never shows `/0` or a guessed total. Sailing time is whole minutes of active sailing. Needs input and failures stay visible as the waiting flare and the error storm; the status word stays short.

## Development

Node.js is required only for development. From this folder in PowerShell:

```powershell
$env:TEMP = "$PWD/.tmp"
$env:TMP = $env:TEMP
$env:electron_config_cache = "$PWD/.cache/electron"
New-Item -ItemType Directory -Force .tmp | Out-Null
npm ci
npm test
npm run verify
npm start
npm run package
```

`npm run verify` runs Electron smoke checks, captures the voyage fixtures and a contact sheet into `artifacts`, and checks the installed Orca CLI, including its task inventory. It uses separate verification settings. `npm run package` writes `dist/v1.1.0/Cozy Orca-win32-x64`. That folder follows the package version, so an earlier portable app and the user data beside it stay in place.

All app-managed data stays on E:. Dependencies and caches live in this project; the portable app's `data` and `.tmp` folders live beside its executable. The launch script sets temporary storage before Electron starts. Do not move the application to C:.

The default CLI is `E:\Applications\Orca\resources\bin\orca.exe`. To override it, set `COZY_ORCA_CLI` to a native Orca executable path before launching; `.cmd` wrappers are deliberately not executed through a shell. `COZY_DATA_DIR` can select another data folder on E:.

Artwork and palette: `src/scene.js`. Status aggregation: `src/status.cjs`. Task inventory: `src/tasks.cjs`. Window, tray, and settings: `src/main.cjs`. The renderer receives only display status, never prompts, task specs, or raw outcomes.

## Task progress

The boat reads orchestration tasks with the same native Orca executable it uses for fleet status. Commands are `orchestration run-list` and, for each real non-legacy run, `orchestration task-list`. It never uses a shell. Windows stay hidden. Each command times out after five seconds, stdout is capped at 16 MB, and only one command runs at a time. Fleet status still refreshes about every two seconds. The task inventory refreshes about every ten seconds, after the fleet command in front of it finishes.

Legacy runs (`legacy: 1`, or a legacy read-only task list) are ignored. A run is tracked only when it still has pending or in-progress work. Fully completed historic runs are left out, so old voyages do not inflate the count. Once this session tracks a run, that run stays in the inventory until the companion quits, including after its last task finishes. The next launch starts the selection again. A run that disappears from a complete run list is dropped. A failed refresh does not forget the runs already selected, but it does not keep publishing their old rows.

Published progress is `{ known, items, runIds }`. Each item is only `{ id, runId, state, title }`. `state` is `pending`, `working`, `completed`, `failed`, or `cancelled`. Titles come from the task title, with the display name as a fallback, never from the spec, result, or prompt. Titles lose control characters and stop at 160 characters. Duplicate ids collapse when the copies agree and reject the whole inventory when they do not. A partial page, a count that does not match the rows, an unknown status, a repeated cursor, or a timed-out command makes the whole inventory unknown. Unknown progress is `{ known: false, items: [], runIds: [] }`. That is not a total of zero, and it does not mean the work finished.

Orca's own statuses map this way: `pending`, `ready`, and `blocked` become `pending`; `dispatched` becomes `working`; `completed` stays `completed`; `failed` stays `failed`. `failed` whose result text is exactly `cancelled` becomes `cancelled`. Orca has no separate cancelled status.

If the task commands fail, the fleet snapshot still stands. Its kind, label, and agents stay as the fleet read reported them. Task progress on that snapshot is unknown until a later refresh succeeds.

Limits:

- The companion is read-only. It cannot start, stop, cancel, or edit a task.
- The inventory is every non-legacy orchestration run with unfinished work on the connected Orca runtime. It is not limited to this workspace, and it does not include tasks that live outside orchestration runs.
- Historic runs whose tasks are already all completed, failed, or cancelled at startup are not tracked. Their old failures are not part of the crate count. A failure that happens after this session started tracking the run stays visible.
- `ready` and `blocked` both display as pending. Cancellation is recognized only from the exact failed result `cancelled`.
- Task-list has no page cursor. A listing is accepted only when `count` equals the returned rows. A listing over 16 MB is rejected instead of cut down into a false total.
- Run-list is followed for at most 20 pages. A cursor that does not end, or that repeats, is unknown.
- An empty known inventory means zero tasks in scope. The pill should omit the fraction when the total is zero or unknown. Unknown inventory must not be drawn as `✓0/0`.
- A task refresh holds the next fleet read until it finishes, so a slow inventory delays one fleet sample. Commands never overlap.
- Specs, prompts, results, and raw outcomes are not part of display data.
