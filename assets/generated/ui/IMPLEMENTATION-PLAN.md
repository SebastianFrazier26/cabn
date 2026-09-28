# M10a -> engine: implementation plan

This maps the approved v2/v3 mockup style (`mockup.html`, `STYLE.md`) onto
`packages/engine/src/react/*`. **Planning document only — nothing here has
been implemented.** Goes to the user for sign-off before any of it starts;
the sequencing section proposes small commits specifically so approval can
happen once here and review can still happen per-commit.

Every file path and code pattern below was checked against the actual
source in this session (not assumed from the mockup or from memory) —
`packages/engine/src/bridge/store.ts`, `packages/engine/src/game.ts`, and
`packages/engine/src/systems/glowSettings.ts` in particular, since the
theming mechanism leans directly on the existing glow-setting pattern.

## 1. Component-by-component

| file | current | change |
|---|---|---|
| `ToolHotbar.tsx` | flat parchment squares, `tool.icon` from `systems/tools.ts` (which currently borrows mismatched existing icons — see its own comment) | flat rounded-square slots (`.panel`-style border/bevel, no wood), real item icons swapped in per `tools.ts`'s icon map, hover shimmer, selected = gold ring + lift |
| `SpyglassPanel.tsx` | flat parchment box, Courier rows | `.panel` chrome + lens-vignette/sheen effect layer, pixel font throughout, open burst on mount |
| `OrbSearch.tsx` | dark scrim + flat parchment modal | `.panel` modal over a violet/cyan/pink mist backdrop + sparkle particles + open burst |
| `BagTray.tsx` | stacked flat rows | `.panel`-style slots (already a tray, not a full panel — keeps its own shape) + satchel-vignette backdrop + open burst |
| `EditorOverlay.tsx` + `editorTheme.ts` | flat parchment, Courier New, text buttons | `.panel` frame + plaque title, ink-blot/glyph-drift effect, flat rounded buttons (replacing text buttons) for save/close, CodeMirror theme repainted to the new token set (colors only — `editorTheme.ts`'s structure/extension wiring is unchanged) |
| `EncounterBanner.tsx` | rounded parchment card, Georgia serif | `.panel` + clip-path ribbon banner, shake+flash beat on mount |
| `MonsterCounter.tsx` | flat parchment pill | `.panel` pill, pixel font |
| `RunOverlay.tsx` | CSS gradient rollers + flat parchment body | `.panel` + rune-ring effect layer (replaces the roller gradients entirely — no roller art either old or new) |
| `SettingsCorner.tsx` | flat parchment pill + circular button | `.panel`/pill chrome; **this is where the day/night override lives** (see section 2) — currently a single glow toggle, becomes a glow toggle + a 3-way auto/day/night control, same "corner, not a full settings screen" shape |
| `FileOverlay.tsx` | thin wrapper composing the above | no visual changes of its own; needs to pass `timeOfDay` through if any child reads it directly rather than via the CSS custom-property mechanism (see section 2 — most won't need to) |
| `CabnGame.tsx` | mounts the React tree, no styling | gains the theme provider / `data-theme` attribute owner (see section 2) |
| new: `pixelTheme.ts` (or similar, exact name TBD at implementation time) | — | the token source of truth — see section 2 |

Victory toast and scene transitions are concepts in the mockup with **no
current React component** — victory has no existing UI at all (only
`MonsterCounter`'s "All bugs fixed" text swap), and scene transitions
aren't implemented anywhere yet. Both are out of scope for this
implementation pass unless the user wants them added as new work, not
just a style pass on existing components — flagging so scope doesn't
silently grow.

## 2. Token/theming mechanism

### Where `timeOfDay` lives

Per direction: a `CabnState` field named **`timeOfDay: "day" | "night"`**
(aligning with M10b, which is adding the same field/shape independently —
this is the resolved value, not the user's setting) plus a
**settings override** for auto/day/night, following the exact pattern
`glowEnabled`/`glowSettings.ts` already establishes:

- `packages/engine/src/bridge/store.ts`: add `timeOfDay: "day" | "night"`
  to `CabnState` and `setTimeOfDay(timeOfDay)` to `CabnActions` — same
  shape as `glowEnabled`/`setGlowEnabled`. Initial value `"day"` (arbitrary
  — always overwritten before first render, same as `glowEnabled: true`'s
  initial value is immediately overwritten in `game.ts`).
- New `packages/engine/src/systems/timeOfDaySettings.ts`, mirroring
  `glowSettings.ts` function-for-function:
  - `type TimeOfDaySetting = "auto" | "day" | "night"`
  - `resolveTimeOfDay(setting: TimeOfDaySetting, now: Date): "day" | "night"` —
    pure, testable without a clock mock beyond passing a fixed `Date`
    (06:00-18:00 local = day, same cutoff as the mockup). This is the one
    new pure-logic function this plan needs a real unit test for beyond
    the obvious wiring.
  - `loadTimeOfDaySetting(): TimeOfDaySetting | null` /
    `persistTimeOfDaySetting(setting)` — same localStorage
    key/try-catch-and-ignore shape as `loadGlowEnabled`/`persistGlowEnabled`.
- `game.ts`: seed `timeOfDay` the same place/way `glowEnabled` is seeded
  (right after `createCabnStore()`, before `new Phaser.Game(...)`):
  ```ts
  const timeOfDaySetting = loadTimeOfDaySetting() ?? "auto";
  store.getState().setTimeOfDay(resolveTimeOfDay(timeOfDaySetting, new Date()));
  ```
  The *setting* (`auto`/`day`/`night`) itself isn't store state — only the
  resolved `timeOfDay` is, same reasoning `glowEnabled` already documents
  (scenes/components need the resolved value; the raw setting is a
  settings-UI concern, not a rendering one). `SettingsCorner` keeps its own
  local copy of the setting (`useState`, seeded from
  `loadTimeOfDaySetting()`) purely to drive which of its 3 buttons shows
  pressed, the same way it doesn't need the *setting* to be shared state
  either.
- **Re-resolving while the app stays open**: `"auto"` can go stale if a
  session spans the day/night boundary. Proposed: re-resolve on an
  interval (e.g. every 5 minutes via `setInterval`, cleared on unmount) in
  whatever effect owns the initial seed, but *only* if the current setting
  is `"auto"` — checked via `loadTimeOfDaySetting()` each tick rather than
  threading the setting through the store. This is a genuinely open
  design question, not a settled decision — flagged for sign-off, not
  silently picked.
- `SettingsCorner.tsx`: add the 3-way toggle next to the existing glow
  toggle, calling `setTimeOfDay(resolveTimeOfDay(newSetting, new Date()))`
  and `persistTimeOfDaySetting(newSetting)` on click — same
  read-then-persist shape as the existing glow toggle's `onClick`.

### CSS custom properties

The mockup's `:root`/`body[data-theme="night"]` token split maps directly
onto React: a single component (proposed `packages/engine/src/react/PixelTheme.tsx`
or similar, wrapping the tree inside `CabnGame.tsx`) subscribes to
`store.timeOfDay` and sets `data-theme` on a wrapping `<div>` — CSS
handles the rest via `[data-theme="night"] { --panel-body: ...; }` the
same way the mockup does, no per-component theme prop drilling needed.
This is the same "subscribe once, let CSS cascade" shape `GlowPipeline.ts`
already uses for `glowEnabled` (subscribe to the store, sync a side
effect), just for CSS custom properties instead of a Phaser pipeline.

Colors themselves move from the current `PALETTE`/`toCssColor()` constants
(`packages/engine/src/palette.ts`) into the new token file — `PALETTE`
doesn't disappear (item-icon-adjacent world rendering may still reference
it, and M10b's warm-cottagecore world direction is a separate concern from
this UI-chrome palette per the user's explicit "keep them separate")
but every component listed in section 1 stops importing `PALETTE`/
`toCssColor` directly and reads CSS custom properties instead (plain CSS,
not inline `style={{ color: toCssColor(...) }}` — the mockup's whole token
mechanism assumes cascading custom properties, which inline styles can't
participate in cleanly).

## 3. Font self-hosting

DotGothic16 and JetBrains Mono are both OFL and self-hostable (checked
against Google Fonts' own license page for each family). Plan:

1. Download both families' woff2 files (the two weights actually used —
   DotGothic16 ships one weight, JetBrains Mono needs 400 + 600) from
   Google Fonts' own CDN once, commit them under a new
   `packages/engine/src/react/fonts/` (or `apps/demo/public/fonts/` if
   engine shouldn't ship binary font files in its own package — **open
   question, needs a decision**: engine is published to npm per the
   README's "Releasing" section, so shipping font binaries inside it has
   real package-size consequences a demo-only asset wouldn't).
2. A `@font-face` CSS block (co-located with the token CSS) replacing the
   mockup's Google Fonts `<link>` — `cabn serve` and the packaged CLI both
   need this to work fully offline (the whole reason v1/v2's mockups
   flagged the CDN link as preview-only, never production).
3. No FOUT/FOIT handling proposed beyond `font-display: swap` — the game
   world (Phaser canvas) doesn't depend on the font being loaded, so a
   flash of fallback text on the React overlay is low-stakes here.

## 4. Particle-effect approach: CSS, not canvas

**CSS**, not a canvas/WebGL particle system, for every effect in the
mockup (mist, sparkles, sheen, rune rings, bursts, confetti, shake/flash).
Reasoning:

- Every effect in `mockup.html` is already CSS (gradients, `clip-path`,
  keyframe animations, a handful of small PNG sprites) and none of them
  needed more than that to read clearly — there's no demonstrated need
  bought by canvas's extra complexity.
- These are DOM overlay elements living in the same React tree as
  the rest of `packages/engine/src/react/*`, not Phaser scene objects —
  CSS is the native fit; a canvas particle system here would mean a
  second rendering pipeline running alongside Phaser's WebGL canvas for no
  benefit these effects need (none of them are physics-driven, none need
  hundreds of particles, none need to interact with world-space
  coordinates).
- `prefers-reduced-motion` handling is already solved at the CSS level
  (the "reduced by default, enhanced under `:no-preference`" pattern
  throughout `mockup.html`) — a canvas approach would need to reimplement
  that gating in JS instead of getting it from the platform for free.
- The one place Phaser *is* already doing particle-like work is
  `GlowPipeline.ts` (a post-fx pipeline on the world camera) — that's a
  different problem (a full-screen world-space shader), not a precedent
  for these small DOM-overlay effects.

If a future effect genuinely needs canvas (say, hundreds of particles or
a world-space effect), that's a new decision to bring back for sign-off,
not something this plan pre-approves.

## 5. Test plan

Split by what's actually testable — this milestone is UI styling, so most
of the value is in the few pieces of real logic, not snapshotting CSS:

- **`resolveTimeOfDay`** (`timeOfDaySettings.ts`): pure function, full unit
  coverage — day/night boundary at exactly 06:00/18:00, both edges,
  `"day"`/`"night"` settings short-circuiting the clock entirely. Same
  style as `contrast.ts`'s tests from the mockup round.
- **`loadTimeOfDaySetting`/`persistTimeOfDaySetting`**: same
  missing-localStorage/corrupt-value guard tests `glowSettings.ts` already
  has (confirmed: `packages/engine/tests/fx/glowSettings.test.ts` exists
  and is the direct template to copy this module's tests from).
- **Store**: `setTimeOfDay` is a one-line `set()` call — covered
  incidentally by whatever test exercises `createCabnStore()`'s other
  actions today, not worth a dedicated test on its own.
- **Components** (`ToolHotbar.tsx`, `SpyglassPanel.tsx`, etc.): per
  CLAUDE.md's own testing line ("skip tests on UI glue, thin wrappers") —
  these are exactly that. No new component snapshot tests proposed; existing
  behavioral tests (tool dispatch, panel open/close state) are unaffected
  by a pure restyle and don't need touching.
- **Visual verification**: no automated visual-regression tooling proposed
  for this pass (no Percy/Chromatic-equivalent in the repo currently) —
  manual screenshot review per commit, same as this mockup round's own
  verification method, is the plan unless the user wants to invest in
  visual regression tooling as separate, explicitly-scoped work.
- **Existing e2e** (`apps/demo/e2e`, the Playwright browser smoke test):
  unaffected functionally, but worth a manual run after the restyle lands
  since it's the one place a broken `data-theme` wrapper div or a CSS
  regression severe enough to break layout would surface automatically.

## 6. Sequencing

Small, independently reviewable commits, roughly in dependency order:

1. **Token foundation** — the CSS custom-property file, `@font-face`
   self-hosting, and the `PixelTheme` wrapper component reading
   `store.timeOfDay`. No visual change yet if `timeOfDay` isn't wired to
   anything real (ship with a hardcoded `"day"` default). Small, mechanical,
   easy to review in isolation.
2. **`timeOfDay` store field + settings module** —
   `timeOfDaySettings.ts`, the `CabnState`/`CabnActions` addition,
   `game.ts` seeding, full test coverage per section 5. Still no visible
   change (nothing reads `data-theme` differently yet beyond whatever
   section 1 shipped).
3. **`SettingsCorner.tsx`** — the auto/day/night toggle UI, wired to the
   settings module. First commit where day/night is actually switchable
   end-to-end; small and isolated to one component.
4. **HUD chrome** (`MonsterCounter.tsx`, the glow toggle half of
   `SettingsCorner.tsx`, `BagTray.tsx`) — smallest/lowest-risk components
   first, to validate the token mechanism against real components before
   touching anything with existing complex state (editor, run).
5. **`ToolHotbar.tsx`** — real item icons + hover shimmer. Needs the
   actual icon assets finalized (pending the open questions in `STYLE.md`)
   before this lands, so it's sequenced after the low-risk HUD pass, not
   before.
6. **`SpyglassPanel.tsx` + `OrbSearch.tsx`** — the two "panel with a
   backdrop effect" components, together since they share the vignette/mist
   pattern.
7. **`EncounterBanner.tsx`** — ribbon + shake/flash. Isolated, low risk
   (mode-gated, only visible during an encounter).
8. **`RunOverlay.tsx`** — rune rings replacing the roller gradients
   entirely; touches `runPlayback` visuals only, not its state machine.
9. **`EditorOverlay.tsx` + `editorTheme.ts`** — largest single component
   (327 lines currently), touches CodeMirror theming — sequenced last
   among the panels since it's the highest-complexity, highest-review-cost
   change and benefits most from every other token/pattern already being
   proven out by commits 1-8.
10. **Open bursts / confetti / hover-shimmer polish pass** — once every
    panel has its base restyle, wire the one-shot effects to real mount/
    unmount events (each panel already has a mode-gated
    mount/unmount — this is "add a CSS class on mount," not new state).

Each commit keeps the existing gate green (`pnpm -r build && pnpm -r test
&& pnpm lint`) and gets its own dated CHANGELOG entry, per repo convention.
Nothing here is implemented yet — this sequencing is what happens *after*
sign-off on this document.

## Open questions carried from this plan (not from STYLE.md)

1. Font files: ship inside `packages/engine` (published to npm) or keep
   them demo/host-app-only? Affects published package size.
2. `"auto"` re-resolution while the app stays open (interval? visibility
   change? never, and require a reload?) — proposed a 5-minute interval
   above, not decided.
3. Victory toast and scene transitions have no current component to
   restyle — build them as new components in this pass, or treat as
   future scope?
