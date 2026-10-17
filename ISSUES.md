# Good first issues

Two starter tasks for contributors who want a small, self-contained change in Cozy Orca. Each one stays inside existing modules, has a clear acceptance path, and can be verified with `npm test`.

## 1. Add a third daytime seagull

**Why:** The sky flock in `src/life/birds.js` currently has two birds (`FLOCK` with altitudes 5 and 13). A third gull makes the open sky feel a little busier without changing night or storm behavior (those modes already draw nothing).

**Where:** `src/life/birds.js` and `test/birds.test.cjs`.

**Suggested work:**

1. Append one entry to `FLOCK` with a distinct `period`, `offset`, and `altitude` inside the open-sky band (y about 4–16 so the 3-pixel-tall gull stays within the sky stamp rules).
2. Keep the existing stamp guards: birds must not overlap the sun disk region, must stay on the 144×72 grid, and must use only the existing `BODY` / `WING` / `SHADE` colors.
3. Extend or add a test in `test/birds.test.cjs` that asserts a daytime frame can paint a third body when the new bird is on-canvas, and that night/storm still paint zero rects.

**Acceptance:** `npm test` passes; daytime scenes can show up to three gulls; night and storm remain bird-free.

**Labels:** `good first issue`, `pixel art`, `life`

## 2. Include crew count in the tray tooltip

**Why:** The system tray / menu bar tooltip is set in `src/main.cjs` to `Cozy Orca — ${status.label}` only. When several agents sail at once, the window pill already shows crew count, but the tray does not, so a glance at the icon misses how busy the fleet is.

**Where:** `src/main.cjs` (the `tray?.setToolTip(...)` call that runs when display status updates, and the initial `Connecting` tooltip if you want it consistent).

**Suggested work:**

1. When `status.crewCount` is a finite number greater than 0, append a short crew fragment, for example `Cozy Orca — Working · 3 crew`.
2. When crew count is 0 or missing, keep the current `Cozy Orca — <label>` form.
3. Do not put prompts, task titles, or raw agent names in the tooltip—only the existing sanitized label plus the numeric crew count.
4. Prefer a small focused test if the project already isolates tooltip formatting; otherwise keep the change tiny and cover it by reading the tooltip string builder (extract a one-line helper if that makes testing easy).

**Acceptance:** With two or more live sessions, the tray tooltip shows the crew count; with zero crew it matches the previous label-only text; `npm test` still passes.

**Labels:** `good first issue`, `electron`, `ux`
