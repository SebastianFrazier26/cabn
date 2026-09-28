# cabn pixel-RPG UI — style tokens (M10a mockup v3)

Companion to `mockup.html`. This document describes the mockup as built —
it is a proposal for review, not a spec already implemented in
`packages/engine/src/react/`. See `IMPLEMENTATION-PLAN.md` for how this
would actually land in the engine, once approved.

## History

- **v1** ("diegetic storybook": wood-plank frames, parchment fill, wax
  seals) — rejected: too textured, muted palette, samey across tools.
- **v2** (Stardew Valley / Pokémon Black-White flat panels) — approved
  direction ("wayyyy better, def on the right path").
- **v3** (this version) — a refinement pass on the approved v2 direction:
  day/night theming, the pixel font applied to all UI text (not just
  headings), stronger/more per-tool magic effects, and higher-resolution
  item icons. Scene-transition concepts are unchanged since v1, per
  explicit "these are fine" feedback both rounds.

## Day/night theming

**Meadow = day, Berry = night**, not two unrelated palette options — v2's
"pick one" framing was replaced with a single time-of-day axis. Every color
token now has a day value (`:root`) and a night value
(`body[data-theme="night"]`), switched by a JS-computed `data-theme`
attribute. `mockup.html`'s toggle has three states:

- **Auto** (default) — resolves from the local clock: day is 06:00–18:00,
  night is everything else. The topbar shows the resolved state
  (`auto -> day` / `auto -> night`) next to the toggle.
- **Day** / **Night** — manual override, matching the engine-side settings
  override this needs (see IMPLEMENTATION-PLAN.md's `timeOfDay` section).

Per explicit direction, **panels stay clean and cool in both themes** — the
warm cottagecore treatment is scoped to the world's own sprites (M10b),
not this UI chrome. Day panels shifted from v2's warm cream
(`#fff8ec`) to a cool pale blue-white (`#f2f8ff`); night panels were
already cool lavender and are essentially unchanged. The sky gradient,
sun/moon (`.celestial`), and a small starfield (`.star`, night only) are
the only backdrop elements that change with theme — no new sprites, just
CSS.

### Color tokens

**Day** (default):

| token | hex |
|---|---|
| `--panel-body` | `#f2f8ff` |
| `--panel-body-alt` | `#dff0ff` |
| `--border-outer` | `#3b2f6b` |
| `--border-highlight` | `#8fd6ef` |
| `--text` | `#201a3d` |
| `--text-secondary` | `#55507f` |
| `--accent-yellow` | `#ffd23f` |
| `--accent-green` | `#5ec26a` |
| `--accent-pink` | `#ef5fa0` |
| `--accent-orange` | `#ff9142` |
| `--accent-cyan` | `#4fd0d8` |
| `--accent-violet` | `#8a6fd6` |
| `--sky-top` / `--sky-bottom` | `#8fd8f5` / `#cdeeb0` |
| `--celestial` (sun) | `#ffd23f` |

**Night**:

| token | hex |
|---|---|
| `--panel-body` | `#eeeaff` |
| `--panel-body-alt` | `#ded6ff` |
| `--border-outer` | `#221a4d` |
| `--border-highlight` | `#ffd23f` |
| `--text` | `#1c1640` |
| `--text-secondary` | `#635ca8` |
| `--accent-yellow` | `#ffcf4d` |
| `--accent-green` | `#46d19a` |
| `--accent-pink` | `#ff4fa0` |
| `--accent-orange` | `#ff7a45` |
| `--accent-cyan` | `#46c9e0` |
| `--accent-violet` | `#7a5fe0` |
| `--sky-top` / `--sky-bottom` | `#120e33` / `#3b2f75` |
| `--celestial` (moon) | `#e9e9ff` |

Neither is palette.json-derived — palette.json is sprite-extracted
(browns/greens for the cottagecore item art) and has nothing this
saturated. Same "new UI-only tokens" status as v1/v2's invented backdrop
colors.

## Frame

Unchanged from v2: `.panel` is a flat `--panel-body` fill, `4px solid
var(--border-outer)`, `border-radius: 14px`, an inset `--border-highlight`
bevel line, a flat (non-blurred) drop-shadow, and small rotated-square
corner accents. No raster texture anywhere in the frame — that was the
whole point of the v1->v2 reset and nothing here reopens it.

## Type — pixel font is now everywhere, not just headings

v2 shipped `DotGothic16` on headings/titles only; body copy, list rows,
inputs, and HUD chrome were still `JetBrains Mono`. v3 applies
`--font-display` (DotGothic16) to every actual UI-facing text element —
panel titles, list rows, search results, bag slots, HUD pills, help-card
rows, `kbd` keys, buttons. `--font-mono` (JetBrains Mono) is now scoped to
exactly two things: **code** (`.code-line`/`.editor-gutter` inside the
quill editor panel) and this document's own dev-facing scaffolding in the
mockup (`.section-note`, `.current-thumb` captions, the topbar's
description paragraph, transition-frame labels) — deliberately left in
mono so "my commentary about the mockup" stays visually distinct from
"the actual proposed UI," which is the thing rendered in the pixel font.

DotGothic16's own legibility findings (from v2's font-testing round, still
current): unambiguous at both header and body sizes, OFL, self-hostable.
No new font testing was needed this round.

## Item icons — v3 redraw at ~2x resolution

All five icons were redrawn from scratch at roughly double v2's grid size
(44-64px tall instead of 20-30px), sharing a new lighting model
(`tools/asset-pipeline/src/pixelmaps/ui-icon-shading.ts`): a fixed up-left
light source quantized into 4 bands (`cylinderBand` for rod/tube shapes,
`sphereBand` for round ones), so every icon reads as lit from the same
direction instead of each having its own ad hoc two-tone split. All five
still run through the unmodified `soften()` pass (the spyglass keeps its
one bloom override, see below) and still carry the shared leaf/flower
accent motif, now stamped at 2x scale (`placeLeafSprig`/`placeFlowerFleck`
gained a `scale` parameter) so it stays legible at the larger grid.

| icon | v3 change |
|---|---|
| spyglass | **The explicit ask**: now reads unmistakably as a telescope — a real flared brass eyepiece, four visible ring segments (each with its own highlight lip, not just a shadow seam), and a genuinely round glass lens with a crisp glint. v2's lens was a radius-2 circle that rendered as a diamond at that resolution and got mistaken for the wand's own glow; at radius ~5 here it reads as an actual lens. |
| wand | **The explicit ask**: replaced the plus-shaped sparkle tip with a 4-facet diamond gem (each facet a flat shade via the light direction) in a bronze setting, and the handle now has a genuinely twisted/carved grip (diagonal carve bands) instead of flat horizontal wraps. |
| orb | Upgraded: the swirl now sits under a directional shadow/highlight crescent (`sphereBand`), so the sphere reads as a lit 3D object with internal texture rather than a flat two-tone pinwheel. |
| quill | Upgraded: a third barb tone (a gradient across the vane width instead of a flat two-stripe alternation) and a glint on the inkwell's shoulder. |
| bag | Upgraded: a fourth leather tone (a thin highlight rim on the lit edge) and stitch ticks along the seam — small deliberate marks, not noise, so this doesn't reopen the "textured/patchy" complaint from v1. |

All five were re-verified at actual hotbar display size (64px slot / 40px
icon) via a real screenshot, not just at the larger crisp/soft comparison
size — see the report for the crop. At that size the spyglass and wand
fixes are both clearly legible; the wand's carved-grip detail is fine
enough that it mostly disappears at 40px (visible in the icon-art section's
larger comparison instead) — worth knowing if hotbar icons ever render
smaller than this in the real engine.

`ui-frames.ts` still overrides the spyglass's soften pass
(`bloomThreshold: 235, bloomStrength: 0.15`) for the same reason as v2 —
its pale-ghost-blue lens sits just above the default bloom threshold.

## Per-tool effects — stronger, plus four new ones

Existing five effects (spyglass vignette+sheen, orb mist+sparkles, bag
vignette+stitching, quill ink/glyphs, wand/run rune rings) all turned up:

- Orb: two counter-rotating mist layers now (was one), less blurred and
  more saturated (added pink to the violet/cyan conic gradient) so the
  swirl visibly reads instead of just tinting the backdrop; sparkle count
  doubled (5 -> 8) at higher opacity.
- Spyglass: tighter, darker vignette; faster, brighter sheen sweep.
- Rune rings: three rings now (was two), plus four small glowing "rune"
  dots fixed to the middle ring's radius — reads as an active spell circle
  rather than "two thin circles."

New this round, all one-shot (not ambient loops) and all gated under
`prefers-reduced-motion: no-preference` with a static/fade fallback:

- **Open bursts** — a handful of sparkle sprites radiate out and fade on
  panel open, one per tool (spyglass/orb/bag/quill), colored to match that
  tool's palette (cyan/gold for spyglass, violet/cyan/gold for orb,
  gold/orange for bag, violet for quill). `mockup.html` has a "replay open
  effect" button per section since there's no real panel-mount event to
  hook into statically — real integration would trigger this from the
  same mount that currently plays each overlay's existing open animation
  (`RunOverlay`'s `cabn-unfurl` keyframe is the existing precedent for
  "remount == retrigger").
- **Hotbar hover shimmer** — a diagonal sheen sweeps once across a slot on
  hover (reuses the spyglass's `sheen` keyframe). Reduced motion: a flat
  `brightness(1.15)` bump instead of a moving sweep.
- **Victory confetti burst** — six colored squares (one per accent color)
  radiate from the victory ribbon and fade, replacing v2's static toast.
- **Encounter shake + flash** — a brief horizontal shake plus a white
  flash pulse on the encounter card, as a "hit" beat. Reduced motion drops
  the shake (skipped under `no-preference` gating, same pattern as
  everything else) but keeps the flash — a brief opacity change isn't the
  vestibular-motion category `prefers-reduced-motion` targets, so it's the
  one effect in this set that isn't gated.

All of these are `img`/`div` elements with `--tx`/`--ty` (and `--rot` for
confetti) CSS custom properties set per-instance, animated via a shared
`burst-out`/`confetti-out` keyframe — no new binary assets beyond the
existing three sparkle sprites, reused at different colors/positions.

## Motion

| interaction | duration | notes |
|---|---|---|
| button press | 100ms | unchanged |
| hover (shimmer, spy-row/orb-hit backgrounds) | 180-650ms | hotbar shimmer sweep is 650ms |
| panel/modal open | 340ms | unchanged |
| open burst (per-tool) | 600ms ease-out | new |
| victory confetti | 900ms ease-out | new |
| encounter shake | 450ms | new |
| encounter flash | 450ms | new, runs even under reduced motion |
| ambient loops (mist/sheen/rune spin/twinkle) | 1.4s-13s | several shortened vs. v2 for a livelier feel |
| scene transitions | 260-420ms | unchanged since v1 |

## Accessibility

Contrast ratios computed via `tools/asset-pipeline/src/contrast.ts` (WCAG
relative-luminance formula, unit-tested against black/white = 21:1).

| pair | ratio | verdict |
|---|---|---|
| Day: text on panel-body | 15.39:1 | pass |
| Day: text on panel-body-alt | 14.14:1 | pass |
| Day: text-secondary on panel-body | 6.92:1 | pass |
| Day: white/cream on border-outer | 11.64:1 | pass |
| Day: text on accent-yellow | 11.39:1 | pass |
| Day: text on accent-pink | 5.34:1 | pass |
| Day: text on accent-green | 7.36:1 | pass |
| Day: focus ring (border-outer on accent-yellow) | 8.06:1 | pass |
| Night: text on panel-body | 14.42:1 | pass |
| Night: text on panel-body-alt | 12.25:1 | pass |
| Night: text-secondary on panel-body | 4.92:1 | pass |
| Night: gold/white on border-outer | 10.99:1 / 15.87:1 | pass |
| Night: text on accent-yellow | 11.54:1 | pass |
| Night: text on accent-pink | 5.55:1 | pass |
| Night: focus ring (border-outer on accent-yellow) | 10.80:1 | pass |

Every ratio comfortably clears AA (4.5:1) in both themes. The v2 rule still
applies and is the reason all of the above pass: every colored badge,
pill, ribbon, and button uses `--text` (dark), never white, on any accent
color — white only appears on `--border-outer` (which is dark in both
themes) and on the ribbon banners, where a `text-shadow` compensates.

**Known, deliberately untouched**: `editorTheme.ts`'s real
`steelGray`-on-`parchmentDark` contrast bug (2.06:1, found in v1, still
present in the shipped engine code) is being fixed separately — not part
of this mockup round per explicit instruction.

## Open questions for the user

1. Auto-day/night boundary is a flat 06:00/18:00 cutoff with no
   dawn/dusk transition — worth a gradient transition zone, or is a hard
   cutoff fine?
2. Open-burst colors are hand-picked per tool (cyan/gold for spyglass,
   etc.) — happy with those pairings, or want them unified to one "magic"
   palette regardless of tool?
3. Wand's carved-grip detail is nearly invisible at 40px hotbar size (see
   the item-icons table above) — worth simplifying since it barely reads
   at ship size, or keep it since larger UI contexts (inventory, tooltips)
   might show the icon bigger?
4. Confetti/shake read fine as concepts here — should the "hit" shake
   scale with severity (e.g. bigger for repeated failures), or always the
   same intensity?
