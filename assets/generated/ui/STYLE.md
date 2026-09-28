# cabn diegetic-storybook UI — style tokens (M10a mockup)

Companion to `mockup.html`. This document describes the mockup as built —
it is a proposal for review, not a spec already implemented in
`packages/engine/src/react/`.

## Concept

UI made of the world's own materials: wood-plank frames, parchment fills,
wax-seal buttons, hand-lettered serif type, pixel-art 9-slice borders drawn
by the asset pipeline (`tools/asset-pipeline/src/ui-frames.ts`). No
`border-radius` anywhere — corners are baked into the frame art itself (the
tooltip bubble's 1px chamfer, the wood frame's square joints), never a CSS
rounded rect. Flat rectangles with a 2px ink border (today's look, see every
current `packages/engine/src/react/*.tsx`) are replaced by this frame/fill
pairing everywhere.

## Color tokens

All hex values are literal `assets/generated/palette.json` entries (indices
noted) except the two backdrop tones, which are new — palette.json is
sprite-extracted and has nothing meant for a full-screen background.

| token | hex | palette index | use |
|---|---|---|---|
| `--ink` | `#322214` | 0 | outlines, body text on light surfaces |
| `--parchment` | `#efe0b3` | 27 | panel fill |
| `--parchment-dark` | `#eacc90` | 26 | recessed/shaded parchment (gutters, sockets) |
| `--wood-dark` | `#622b17` | 2 | frame shadow, plaques, secondary text on parchment |
| `--wood-mid` | `#8c461f` | 5 | frame mid-tone |
| `--wood-light` | `#a35424` | 8 | frame highlight base |
| `--wood-highlight` | `#c66e29` | 13 | frame grain highlight |
| `--gold` | `#e99b33` | 21 | trim, active-state rings, headline accents |
| `--cream` | `#edeee4` | 29 | text on dark/wood surfaces |
| `--steel` | `#8a9198` | 28 | hardware only — **not** text on parchment, see Accessibility |
| `--seal-red` | `#c8281e` | 34 | wax seal (close/error/encounter ribbon) |
| `--seal-plum` | `#58336b` | 32 | wax seal (save/confirm) |
| `--victory-green` | `#6f863a` | 11 | victory ribbon |
| `--world-bg-deep` | `#172410` | *new* | page backdrop, darkest |
| `--world-bg-mid` | `#24371c` | *new* | page backdrop, mid |

`--world-bg-deep`/`--world-bg-mid` are hand-picked, not extracted — open
question below.

## Type

Two pairings are wired into `mockup.html` (toggle top-right); pick one, or
call out a third direction.

**Pairing A — "Fell & Garamond"** (mockup default)
- Display (titles, plaques, ribbon text): **IM Fell English SC** — an OFL
  revival of an actual 1700s English type foundry. Reads as genuinely old,
  a little severe.
- Body (panels, tooltips, lists): **Cormorant Garamond** — OFL, elegant,
  legible down to ~13px.
- Mono (code): **JetBrains Mono** — OFL, deliberately *not* antique; code
  needs to stay unambiguous even inside a parchment frame.

**Pairing B — "Cinzel & Alegreya"**
- Display: **Cinzel Decorative** — OFL, carved-stone/illuminated-capital
  feel, all-caps by design. Stronger for the ribbon banner, maybe too heavy
  for small panel titles (see open questions).
- Body: **Alegreya** — OFL, calligraphic serif built for long-form reading,
  warmer than Cormorant.
- Mono: **Fira Code** — OFL.

All six typefaces are SIL Open Font License, self-hostable. `mockup.html`
loads them from the Google Fonts CDN for preview convenience only —
`packages/engine` can't reach a CDN at runtime the way this throwaway page
can (`cabn serve` explicitly runs on `127.0.0.1` with no assumed internet),
so real integration means downloading the two chosen weights and shipping
them as static files the demo app serves itself.

### Type scale

| role | size | pairing A face | pairing B face |
|---|---|---|---|
| ribbon / banner title | 20–22px | IM Fell English SC | Cinzel Decorative |
| panel plaque / title | 15–16px | IM Fell English SC | Cinzel Decorative |
| body text | 14–15px | Cormorant Garamond | Alegreya |
| meta / secondary | 12–13px | Cormorant Garamond | Alegreya |
| code | 13px | JetBrains Mono | Fira Code |
| hotkey / hud label | 10–11px | JetBrains Mono | Fira Code |

## Spacing & frame

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32px — everything in the mockup is a
  multiple of 4.
- Wood frame source tile: 32×32px, `border-image-slice: 8` (crisp) /
  `64` (soft raster, since the soft variant is upscaled 8× by `soften()`'s
  `cellSize`). Displayed CSS border width: 14px for panels, 10px for the
  small settings pill.
- No radii. See Concept above.

## Motion

| interaction | duration | easing | notes |
|---|---|---|---|
| button press (wax seal) | 100ms | — (swaps to the `_pressed` sprite + scale 0.97) | no separate "pressed" easing curve, it's instant |
| hover (hotbar lift, seal glow) | 180ms | `cubic-bezier(0.22, 1, 0.36, 1)` | "settle" curve — quick out, gentle stop |
| panel/scroll open (`unroll`, `unfurl`, `pop-in`) | 340ms | `cubic-bezier(0.22, 1, 0.36, 1)` | same curve as hover, just slower — one vocabulary, not two |
| scene transition — vignette iris | ~260ms | linear | concept only, not built |
| scene transition — scroll-unroll | ~340ms | settle curve | concept only, reuses the panel-open keyframe |
| scene transition — page-turn | ~420ms | settle curve | concept only, most expensive of the three |

A plain opacity fade (180ms, linear) is the *default* for every open
animation, and the hotbar hover-lift / seal hover-scale transitions are
unset by default too — the scale/transform versions only get added under
`@media (prefers-reduced-motion: no-preference)`. Building it "reduced by
default, enhanced when motion is allowed" means respecting the setting
needs no `!important` fight against a base rule (which Biome's
`noImportantStyles` lint also flags) — see `mockup.html`'s two motion
blocks.

## Accessibility

Contrast ratios below are computed (not eyeballed) via
`tools/asset-pipeline/src/contrast.ts` (WCAG relative-luminance formula,
also unit-tested against black/white = 21:1 in
`tools/asset-pipeline/tests/contrast.test.ts`).

| pair | ratio | verdict |
|---|---|---|
| ink on parchment (body text) | 11.63:1 | pass (AA normal + AAA) |
| ink on cream | 13.06:1 | pass |
| ink on parchment-dark | 9.85:1 | pass |
| gold on ink (headline on dark) | 6.69:1 | pass |
| **gold text on parchment** | **1.74:1** | **fail** — gold is trim/accent only, never body text on a light surface |
| **steel on parchment** | **2.43:1** | **fail** |
| **steel on parchment-dark** | **2.06:1** | **fail — this is the current `editorTheme.ts` gutter color today** (`steelGray` on `parchmentDark`), a pre-existing bug this mockup carries a fix for, see below |
| steel on ink | 4.79:1 | pass (dark surfaces only) |
| cream on seal-red | 4.75:1 | pass, barely — don't shrink below ~14px |
| cream on seal-plum | 8.54:1 | pass |

**Finding, not just a mockup choice:** the shipped `editorTheme.ts` puts
`PALETTE.steelGray` (`#8a9198`) directly on `PALETTE.parchmentDark`
(`#eacc90`) for the gutter and on `PALETTE.parchment` for
punctuation/brackets — both fail WCAG AA (2.06:1 and 2.43:1 respectively,
need ≥4.5:1 for normal-size text). The mockup's `--text-secondary-on-parchment`
token uses `--wood-dark` (`#622b17`) instead, which gets 8.51:1 on parchment
and 7.21:1 on parchment-dark. Recommend porting this swap back into
`editorTheme.ts` regardless of which direction the rest of M10a takes —
it's a real bug independent of the redesign.

**Focus ring:** `:focus-visible` gets a double ring —
`box-shadow: 0 0 0 2px var(--ink), 0 0 0 4px var(--gold)` — rather than a
single color, because gold alone measures only 4.90:1 against wood-dark and
would be much worse against parchment; pairing it with an inner ink ring
guarantees a ≥3:1 non-text-contrast edge against both light and dark
surfaces (WCAG 2.2 SC 2.4.11 is a 3:1 minimum against adjacent colors).

## Open questions for the user

1. **Font pairing** — Fell & Garamond (more severe/antique) or Cinzel &
   Alegreya (more illuminated-manuscript/heraldic)? Or neither — react to
   direction only.
2. **Parchment fill texture** — the current tile (`ui_parchment_fill.png`,
   built by a sine-wave mottling function) reads a little too regular/plaid
   at panel scale (see mockup screenshot); worth another pass with either a
   larger tile or an actual noise-based fiber pattern before this goes
   further.
3. **Backdrop colors** (`--world-bg-deep`/`--world-bg-mid`) are invented,
   not extracted from anything — fine for a mockup, but if this direction
   is approved they should either get added to the curated palette
   properly or be justified as intentionally out-of-palette "environment,
   not sprite" tones.
4. **Wax-seal hover** has no dedicated pixel art (CSS `brightness`/`scale`
   only) — acceptable, or worth a proper glossy-hover sprite?
5. **Wood frame grain** is closer to "textured static" than deliberate
   plank boards at a glance — the strongest pixel work in this pass is the
   wax seals and ribbons; the frame tile is the piece most worth a second
   iteration if this direction moves forward.
