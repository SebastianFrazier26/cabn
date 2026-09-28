# cabn pixel-RPG UI — style tokens (M10a mockup v2)

Companion to `mockup.html`. This document describes the mockup as built —
it is a proposal for review, not a spec already implemented in
`packages/engine/src/react/`.

## v2 — this is a reset, not a tweak

The first pass ("diegetic storybook": wood-plank frames, parchment fill,
wax seals) was rejected outright: too textured ("like Minecraft dirt"), the
parchment fill read as patchy and hard to read, the palette was bland, the
hotbar was emoji in wooden squares, and every tool screen looked the same.
This version throws out all of that and rebuilds around **Stardew Valley /
Pokémon Black-White**: flat colorful panels with a simple outline + inset
highlight bevel (no raster texture anywhere), a legible retro dialog font,
real item-icon art in the hotbar, and a distinct particle/atmosphere effect
per magical tool. Scene-transition concepts (page-turn / scroll-unroll /
vignette iris) are the one thing carried over unchanged, per explicit
feedback that they were fine.

## Frame

- `.panel`: flat `--panel-body` fill, `4px solid var(--border-outer)`,
  `border-radius: 14px`, `box-shadow: inset 0 0 0 3px var(--border-highlight)`
  for the inner bevel line, plus a flat `5px 5px 0 rgba(0,0,0,0.22)` hard
  drop-shadow (no blur — a flat offset shadow is the GBA/DS convention, a
  blurred one reads as a modern web card). Small rotated-square corner
  accents (`::before`/`::after`) are a cheap nod to the corner dots common
  on GBA/DS menu boxes.
- No raster art anywhere in the frame. This is a deliberate reversal from
  v1: CSS borders/radius/box-shadow give the exact same "flat colored
  border, rounded corners" look Stardew/Pokémon menus have, with zero
  texture risk and zero new binary assets to generate per panel.
- Real pixel-art assets are now scoped to exactly two things: **item icons**
  (the hotbar tools) and a **sparkle particle** — both listed below.

## Item icons

Five new tool icons (`tools/asset-pipeline/src/pixelmaps/ui-item-*.ts`),
replacing v1's approach of borrowing whatever existing icon was closest
(spyglass/quill both used `letter_opener_256.webp`, wand used
`cabinet_256.webp` — see `packages/engine/src/systems/tools.ts`'s own
comment on this). Each runs through the *same* `soften()` pass with no
option overrides as `wizard_tower`/`character_idle`/`ghost` (the spyglass
gets one override, see below), so they land in the same soft-rendered
family as the existing recovered originals rather than reading as new art
bolted on next to them. All five also carry the same small leaf-sprig +
cream-flower accent cluster that `key.png`/`letter_opener.png` have near
their base (`ui-icon-motifs.ts`), for the same reason.

| icon | reads as | honest note |
|---|---|---|
| crystal orb | swirling violet/cyan glass sphere on a bronze stand | strongest of the five |
| quill | feather + ink-dipped nib + gold-rimmed inkwell | strongest of the five |
| bag | satchel with an arched carry handle + gold buckle | went through two silhouettes — v1's tapered-top shape read as a hood/cloak, not a bag; the handle loop is what fixed it |
| wand | wrapped-grip rod with a glowing star tip | solid |
| spyglass | flared brass tube tapering to a glass-tipped end | **weakest of the five** — two revision passes (added an eyepiece flare, replaced a circular lens with a flat tinted tube-tip so it stopped rendering as a diamond/star indistinguishable from the wand) improved it, but it still reads more as "a rod" than unmistakably "a telescope" at a glance. If this direction proceeds, this is the one icon worth a third pass or a different silhouette (e.g. a bent/collapsed two-segment shape) before it ships |

`ui-frames.ts` overrides the spyglass's soften pass specifically
(`bloomThreshold: 235, bloomStrength: 0.15`) — its pale-ghost-blue lens tip
sits just above the default bloom threshold (180) and was blooming into a
starburst that duplicated the wand's own signature glow.

## Sparkle particle

One small 4-point sparkle (`ui-sparkle.ts`), in three colors (violet/cyan/
gold, all existing curated palette indices), reused at different positions,
sizes, and animation delays as the "particle effect" for the orb search
screen — one sprite standing in for a particle system rather than dozens of
bespoke frames. Crisp only (no soften pass): at 9x9 source pixels these are
meant to glow sharply against a colored backdrop, not read as soft objects.

## Per-tool "magic" treatment

The explicit ask was that each tool feel distinct, not just re-skinned —
implemented as a different *atmosphere* layered into the same shared
`.panel` chrome, so the UI still reads as one system:

| tool | effect | how |
|---|---|---|
| spyglass (ls) | lens vignette + sweeping sheen | radial-gradient darkening at the panel edges, plus a diagonal light-gradient sweeping across on a 3.2s loop |
| crystal orb (search) | violet/cyan swirling mist + sparkles | a blurred rotating conic-gradient behind the modal, plus 3-5 positioned sparkle sprites with staggered twinkle |
| bag (tray) | open satchel interior | a warm brown radial vignette + dashed "stitched seam" inset border |
| quill (editor) | ink & glyph shimmer | small code-glyph characters (`{ } % λ`) drifting upward and fading near the panel top, plus a soft ink-blot behind the plaque corner |
| wand (run) | rune scroll | two counter-rotating dashed rings (violet + cyan) behind the panel, reading as an active spell circle rather than v1's literal unrolling parchment |

All five are CSS-only (gradients, `clip-path`, keyframe animations, and the
sparkle raster) — no new binary assets beyond the sparkle sprite itself.

## Color tokens

Two palette variants, toggled live in `mockup.html` (top-right). Neither is
palette.json-derived — palette.json is sprite-extracted (browns/greens for
the cottagecore item art) and has nothing saturated enough for a Pokémon/
Stardew-style chrome palette. These are new UI-only tokens, same as v1's
`--world-bg-deep`/`--world-bg-mid` were.

**Meadow** (default) — warm, Stardew-leaning:

| token | hex |
|---|---|
| `--panel-body` | `#fff8ec` |
| `--panel-body-alt` | `#ffe8bf` |
| `--border-outer` | `#3b2f6b` |
| `--border-highlight` | `#8fd6ef` |
| `--text` | `#2a2140` |
| `--text-secondary` | `#5b4d8a` |
| `--accent-yellow` | `#ffd23f` |
| `--accent-green` | `#5ec26a` |
| `--accent-pink` | `#ef5fa0` |
| `--accent-orange` | `#ff9142` |
| `--accent-cyan` | `#4fd0d8` |
| `--accent-violet` | `#8a6fd6` |
| `--sky-top` / `--sky-bottom` | `#7fd0f2` / `#bdeaa0` |

**Berry** — cooler, Pokémon-B/W-leaning:

| token | hex |
|---|---|
| `--panel-body` | `#f3f0ff` |
| `--panel-body-alt` | `#e3ddff` |
| `--border-outer` | `#2a2159` |
| `--border-highlight` | `#ffd23f` |
| `--text` | `#241c47` |
| `--text-secondary` | `#6a5fae` |
| `--accent-yellow` | `#ffcf4d` |
| `--accent-green` | `#46d19a` |
| `--accent-pink` | `#ff4fa0` |
| `--accent-orange` | `#ff7a45` |
| `--accent-cyan` | `#46c9e0` |
| `--accent-violet` | `#7a5fe0` |
| `--sky-top` / `--sky-bottom` | `#6f5fd6` / `#ff9ecb` |

## Type — a real, tested finding, not just a pick

The brief suggested Pixelify Sans. **It doesn't work and was rejected after
testing**, not just picked around: at every weight (400/500/700) its
lowercase `c` is visually indistinguishable from `o`, and several digits
(`2`/`5` in particular) are ambiguous with `8`. This isn't a nitpick — it
means the word "cabn" itself renders as "oabn" in the font the brief
suggested. Screenshotted proof of this (and the replacement) is what
`mockup.html` actually ships:

- **Rejected**: Pixelify Sans — `c`→`o` and digit confusion at every weight tested.
- **Also tested, not used**: Press Start 2P (unambiguous but very poor
  paragraph readability, more "arcade marquee" than "dialog box"), Jersey
  10/15 (clear but reads as a scoreboard/jersey-number face, not dialog
  text), Silkscreen (clear but its lowercase renders as small-caps —fine
  for headers, awkward for body copy), VT323 (clear and legible, but reads
  as a green CRT terminal, not a cozy RPG textbox).
- **Chosen: DotGothic16`** — OFL, self-hostable, every character in "cabn -
  pixel-RPG UI mockup v2 0123456789" is unambiguous at both the sizes
  tested (16px headers, 13px body), and its dot-matrix construction is
  genuinely in the same family Japanese RPG dialog boxes (which is what
  Pokémon's own textbox font descends from) use. Used for every UI text
  role in the mockup; `JetBrains Mono` (unchanged from v1) stays the code
  font — legible monospace was already a requirement the brief carved out
  as separate from the display-font question.

Re-verify the Google Fonts link still resolves when reviewing — this was
checked today (see CHANGELOG date) against the live Google Fonts CDN, not
assumed from training knowledge alone.

## Motion

Unchanged in spirit from v1, same durations:

| interaction | duration | easing |
|---|---|---|
| button press | 100ms | instant (box-shadow flattens + 2px translate) |
| hover | 180ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| panel/modal open | 340ms | same curve, slower |
| ambient loops (sparkle twinkle, mist swirl, sheen sweep, rune spin) | 1.6s–12s | linear or ease-in-out, looping |
| scene transition — vignette iris | ~260ms | linear |
| scene transition — scroll-unroll | ~340ms | settle curve |
| scene transition — page-turn | ~420ms | settle curve |

Every ambient effect (sparkle twinkle, mist swirl, lens sheen, glyph drift,
rune-ring spin) is **static by default** and only animates under
`@media (prefers-reduced-motion: no-preference)` — same "reduced by
default, enhanced when allowed" structure as v1, which avoids fighting a
base rule with `!important` (Biome's `noImportantStyles` lint rule flags
that pattern, which is what caught it during v1's build).

## Accessibility

Contrast ratios computed via `tools/asset-pipeline/src/contrast.ts` (WCAG
relative-luminance formula, unit-tested against black/white = 21:1).

| pair | ratio | verdict |
|---|---|---|
| Meadow: text on panel-body | 14.31:1 | pass |
| Meadow: text on panel-body-alt | 12.62:1 | pass |
| Meadow: text-secondary on panel-body | 6.92:1 | pass |
| Meadow: cream/white on border-outer | 11.02:1 | pass |
| Meadow: text on accent-yellow | 10.46:1 | pass |
| Meadow: text on accent-cyan | 8.16:1 | pass |
| Meadow: text on accent-pink | 4.90:1 | pass (barely — don't go below ~13px) |
| Meadow: text on accent-green | 6.76:1 | pass |
| **Meadow: white on accent-pink** | **3.08:1** | **fail — this is why every `.btn`/badge uses `--text` (dark), never white, on any accent color** |
| **Meadow: white on accent-green** | **2.23:1** | **fail, same reason** |
| Berry: text on panel-body | 14.05:1 | pass |
| Berry: text on panel-body-alt | 12.05:1 | pass |
| Berry: text-secondary on panel-body | 4.85:1 | pass (barely) |
| Berry: gold/cream on border-outer | 9.96:1 / 12.82:1 | pass |
| Berry: text on accent-yellow | 10.72:1 | pass |
| Berry: text on accent-pink | 5.16:1 | pass |

**Rule this produced:** every colored badge, pill, ribbon, and button uses
`--text` (the dark ink color) for its label, never white — white only
appears on the deep `--border-outer` surface (plaques, the topbar) and on
the ribbon banners, where a `text-shadow` compensates (the ribbon's own
saturated fill would otherwise put white text below 3.1:1, same failure
mode as the buttons above).

v1's finding about the *currently shipped* `editorTheme.ts` gutter color
(`steelGray` on `parchmentDark`, 2.06:1, real AA failure) still stands and
is independent of which UI direction this milestone lands on — still not
fixed pending the user's decision, per the instruction not to touch
`editorTheme.ts` yet.

**Focus ring**: same double-ring idea as v1, re-verified against the new
tokens — `box-shadow: 0 0 0 2px var(--border-outer), 0 0 0 4px
var(--accent-yellow)` on every button/input. `--border-outer` against
`--accent-yellow` measures 8.06:1 (Meadow) / 9.78:1 (Berry), both well
past the 3:1 WCAG 2.2 non-text-contrast minimum, and the dark inner ring
means it stays visible even against panels whose own border is already
`--border-outer`.

## Open questions for the user

1. **Meadow or Berry?** Or react to direction only.
2. **Spyglass icon** — acceptable as-is, or worth a third redesign pass
   (see the item-icon table above)?
3. **DotGothic16** — does the dot-matrix/Japanese-RPG-dialog lineage read
   as "Pokémon/Stardew" enough, or does this need another round against a
   different candidate (Jersey 10/15 and VT323 were the runners-up)?
4. **Ambient effect intensity** — mist swirl/sheen/rune-ring opacities were
   picked to be visible without fighting panel text; turn any of them up
   (more overtly magical) or down (calmer)?
5. Corner accent diamonds on panels are a small detail (8px) — bigger/bolder,
   or leave subtle?
