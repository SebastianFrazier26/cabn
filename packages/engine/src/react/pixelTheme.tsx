import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { toCssColor } from "../palette.js";
import { DOT_GOTHIC16_LATIN_WOFF2_BASE64 } from "./fonts/dotGothic16.js";
import {
	DAY_TOKENS,
	NIGHT_TOKENS,
	type PixelThemeTokens,
} from "./pixelThemeTokens.js";
import { useCabnStore } from "./useCabnStore.js";

// Every class/custom-property name here is prefixed `cabn-`/`--cabn-` and
// every selector is scoped under `.cabn-pixel-root` rather than `:root`/
// `body` (the mockup's own scoping) — this package is an embeddable widget
// inside a host page, not a full page it owns, so it must never reach past
// its own container into the host's global `:root`/`body` styles.
const STYLE_ELEMENT_ID = "cabn-pixel-theme-style";

/** The `--cabn-*` custom-property declarations shared by both theme blocks — generated from pixelThemeTokens.ts (the tested source of truth) rather than typed twice, so the CSS this actually ships and the contrast test can never drift apart. */
function tokenDeclarations(tokens: PixelThemeTokens): string {
	return `
	--cabn-panel-body: ${toCssColor(tokens.panelBody)};
	--cabn-panel-body-alt: ${toCssColor(tokens.panelBodyAlt)};
	--cabn-border-outer: ${toCssColor(tokens.borderOuter)};
	--cabn-border-highlight: ${toCssColor(tokens.borderHighlight)};
	--cabn-text: ${toCssColor(tokens.text)};
	--cabn-text-secondary: ${toCssColor(tokens.textSecondary)};
	--cabn-accent-yellow: ${toCssColor(tokens.accentYellow)};
	--cabn-accent-green: ${toCssColor(tokens.accentGreen)};
	--cabn-accent-pink: ${toCssColor(tokens.accentPink)};
	--cabn-accent-orange: ${toCssColor(tokens.accentOrange)};
	--cabn-accent-cyan: ${toCssColor(tokens.accentCyan)};
	--cabn-accent-violet: ${toCssColor(tokens.accentViolet)};
	/*
	 * Quill/editor syntax colors — hand-darkened variants of the accents
	 * above (same technique packages/engine/src/palette.ts's goldDark/
	 * amethystDark/etc. already use), computed against --cabn-panel-body so
	 * every fg/bg pair clears WCAG AA (4.5:1) for text; see
	 * packages/engine/tests/editorThemeContrast.test.ts, which asserts this
	 * per token (reading pixelThemeTokens.ts live, not a copied hex) so a
	 * future accent-color change can't silently regress it. The raw accents
	 * above are all too light on this near-white panel body to use directly
	 * as text — same reason the palette.ts *Dark variants exist.
	 */
	--cabn-syntax-keyword: ${toCssColor(tokens.syntaxKeyword)};
	--cabn-syntax-string: ${toCssColor(tokens.syntaxString)};
	--cabn-syntax-number: ${toCssColor(tokens.syntaxNumber)};
	--cabn-syntax-function: ${toCssColor(tokens.syntaxFunction)};
	--cabn-syntax-type: ${toCssColor(tokens.syntaxType)};
	--cabn-syntax-attribute: ${toCssColor(tokens.syntaxAttribute)};
	--cabn-editor-gutter-text: ${toCssColor(tokens.editorGutterText)};`;
}

// M10a v3 tokens (assets/generated/ui/STYLE.md) verbatim — Meadow=day,
// Berry=night. Deliberately separate from packages/engine/src/palette.ts's
// PALETTE (sprite-extracted, warm/cottagecore world colors) per the
// approved plan's explicit "keep them separate": this is UI chrome, not
// world art.
const PIXEL_THEME_CSS = `
@font-face {
	font-family: "CabnDotGothic16";
	src: url(data:font/woff2;base64,${DOT_GOTHIC16_LATIN_WOFF2_BASE64}) format("woff2");
	font-weight: 400;
	font-style: normal;
	font-display: swap;
}

.cabn-pixel-root {${tokenDeclarations(DAY_TOKENS)}
	--cabn-font-display: "CabnDotGothic16", system-ui, sans-serif;
	--cabn-font-mono: "JetBrains Mono", "Courier New", monospace;
	/* Plain rgba literals, not color-mix() with the accent tokens above — this
	   CSS ships as a JS template string with no build-time autoprefixing/
	   fallback story, so it sticks to a function every evergreen browser this
	   project targets already supports. Not sourced from pixelThemeTokens.ts
	   (unlike the block above) — the contrast test only cares about text
	   fg/bg pairs, and these are translucent overlay tints, never text color. */
	--cabn-editor-selection-bg: rgba(79, 208, 216, 0.45);
	--cabn-editor-active-line-bg: rgba(255, 210, 63, 0.18);
	--cabn-editor-active-gutter-bg: rgba(255, 210, 63, 0.25);
	--cabn-editor-gutter-border: rgba(59, 47, 107, 0.35);
	/* A subtle "recessed panel" tint (run log, satchel lining) — a text-colored
	   wash at low opacity. Day = dark ink on the near-white panel; night needs
	   the opposite direction (white wash on the near-black panel) or it reads
	   as invisible/muddy against the new dark panelBody. */
	--cabn-inset-tint: rgba(59, 47, 107, 0.08);
	font-family: var(--cabn-font-display);
	color: var(--cabn-text);
}
.cabn-pixel-root[data-theme="night"] {${tokenDeclarations(NIGHT_TOKENS)}
	--cabn-editor-selection-bg: rgba(70, 201, 224, 0.45);
	--cabn-editor-active-line-bg: rgba(255, 207, 77, 0.18);
	--cabn-editor-active-gutter-bg: rgba(255, 207, 77, 0.25);
	--cabn-editor-gutter-border: rgba(34, 26, 77, 0.35);
	--cabn-inset-tint: rgba(255, 255, 255, 0.06);
}

/* ================= flat pixel panel (Pokemon B/W textbox-ish), STYLE.md "Frame" ================= */
.cabn-panel {
	position: relative;
	background: var(--cabn-panel-body);
	border: 4px solid var(--cabn-border-outer);
	border-radius: 14px;
	box-shadow: inset 0 0 0 3px var(--cabn-border-highlight), 5px 5px 0 rgba(0,0,0,0.22);
	color: var(--cabn-text);
	padding: 14px;
	font-family: var(--cabn-font-display);
}
.cabn-panel::before, .cabn-panel::after {
	content: ""; position: absolute; top: -3px; width: 8px; height: 8px;
	background: var(--cabn-accent-yellow); border: 2px solid var(--cabn-border-outer); border-radius: 2px; transform: rotate(45deg);
}
.cabn-panel::before { left: 10px; }
.cabn-panel::after { right: 10px; }
.cabn-panel-title { font-size: 13px; text-align: center; margin: 0 0 8px; color: var(--cabn-border-outer); }
.cabn-panel-divider { height: 3px; background: var(--cabn-border-outer); opacity: 0.15; margin: 6px 0; border-radius: 2px; }

.cabn-btn {
	font-family: var(--cabn-font-display); font-size: 12px; padding: 7px 16px; border-radius: 10px;
	border: 3px solid var(--cabn-border-outer); cursor: pointer;
	/* Fixed dark ink, not var(--cabn-text) — every variant below fills with a
	   bright candy accent that barely changes between day/night (see
	   pixelThemeTokens.ts's comment on why accent-* stayed put), so the label
	   needs to stay dark in both themes too; the near-white night text token
	   would be unreadable on top of a bright yellow/green/pink button. */
	color: #201a3d;
	box-shadow: 3px 3px 0 rgba(0,0,0,0.2);
}
.cabn-btn:active { box-shadow: 1px 1px 0 rgba(0,0,0,0.2); transform: translate(2px, 2px); }
.cabn-btn.confirm { background: var(--cabn-accent-green); }
.cabn-btn.cancel { background: var(--cabn-accent-pink); }
.cabn-btn.neutral { background: var(--cabn-accent-yellow); }

.cabn-hud-pill {
	display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; font-size: 12px;
}
.cabn-pill-button {
	font-family: var(--cabn-font-display); font-size: 11px; padding: 8px 14px; cursor: pointer;
	background: var(--cabn-panel-body); border: 3px solid var(--cabn-border-outer); border-radius: 20px;
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight); color: var(--cabn-text);
}
.cabn-help-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; gap: 12px; }
.cabn-help-row kbd {
	font-family: var(--cabn-font-display); background: var(--cabn-border-outer); color: #fff;
	padding: 1px 7px; border-radius: 4px; font-size: 11px;
}

/* ================= sparkle particles + open/close burst, shared per STYLE.md's "Per-tool effects" ================= */
.cabn-sparkle { position: absolute; pointer-events: none; opacity: 0.85; }
@keyframes cabn-twinkle { 0%, 100% { opacity: 0.25; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1.25); } }
.cabn-effect-burst { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.cabn-effect-burst .cabn-spark { position: absolute; top: 50%; left: 50%; width: 16px; margin: -8px; opacity: 0; }
@keyframes cabn-burst-out {
	0% { opacity: 1; transform: translate(0, 0) scale(1.3); }
	100% { opacity: 0; transform: translate(var(--cabn-tx), var(--cabn-ty)) scale(0.3); }
}
@keyframes cabn-burst-fade { 0% { opacity: 1; } 100% { opacity: 0; } }
/* Shared reduced-motion fallback for every literal-tool-screen open animation
   below (crystal ball/spyglass/satchel/spellbook/wand-cast) — plain fade in,
   no scale/rotate/clip-path, per the M10 plan's "reduced motion falls back to
   a fade" requirement for each of them. */
@keyframes cabn-fade-in { 0% { opacity: 0; } 100% { opacity: 1; } }
/* Reduced-motion default: fade in place, no radiating translate/scale — same "reduced by default, enhanced under :no-preference" shape mockup.html established. */
.cabn-effect-burst.play .cabn-spark { animation: cabn-burst-fade 500ms ease-out forwards; }

/* ================= hotbar ================= */
.cabn-hotbar-slot {
	position: relative; width: 64px; height: 64px; overflow: hidden;
	background: var(--cabn-panel-body); border: 3px solid var(--cabn-border-outer); border-radius: 12px;
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight);
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	cursor: pointer; padding: 4px;
}
.cabn-hotbar-slot img { width: 40px; height: 40px; object-fit: contain; position: relative; z-index: 1; image-rendering: pixelated; }
.cabn-hotbar-slot .cabn-key { position: relative; z-index: 1; font-size: 10px; color: var(--cabn-text-secondary); margin-top: 1px; font-family: var(--cabn-font-display); }
.cabn-hotbar-slot.selected { box-shadow: inset 0 0 0 2px var(--cabn-border-highlight), 0 0 0 3px var(--cabn-accent-yellow); transform: translateY(-3px); }
/* .cabn-badge itself (shared with the satchel's closed-count badge) is defined
   in the bag section below — kept next to its other consumer rather than
   duplicated here. */
.cabn-hotbar-slot::after {
	content: ""; position: absolute; inset: -60%; z-index: 1; pointer-events: none;
	background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,0.65) 50%, transparent 58%);
	transform: translateX(-60%);
}
@media (prefers-reduced-motion: reduce) {
	.cabn-hotbar-slot:hover { filter: brightness(1.15); }
}

/* ================= spyglass — round lens, brass rim ================= */
/* Shared by the three literal tool screens: their pixel-art frame
   (ui_screen_*.png, 3 CSS px per art cell) laid over the live content, never
   intercepting its clicks. */
.cabn-tool-frame {
	position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4;
	pointer-events: none; image-rendering: pixelated;
}
/* One-line text that ellipsizes instead of running past a round frame. */
.cabn-clip-line { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The frame box is the 136x136-cell ui_screen_spyglass art; percentages
   below are its cell coordinates (lens circle centre 58,58, radius 49;
   content rect 19,29 78x58 — the lens's inscribed rectangle, see
   tools/asset-pipeline's ui-screen-spyglass.ts). */
.cabn-spyglass-frame {
	position: relative; width: min(408px, 80vw); aspect-ratio: 1;
	filter: drop-shadow(5px 5px 0 rgba(0,0,0,0.25));
}
.cabn-spyglass-frame::after {
	content: ""; position: absolute; left: 6.62%; top: 6.62%; width: 72.06%; height: 72.06%;
	border-radius: 50%; pointer-events: none; z-index: 3;
	background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.3) 50%, transparent 65%);
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-spyglass-frame::after { animation: cabn-sheen 2.6s linear infinite; }
}
/* The lens itself: circular, clip-path iris-opens on mount — overrides
   .cabn-panel's rectangular border-radius/padding/box-shadow, keeps its
   background/color/font tokens. */
.cabn-spyglass-lens {
	position: absolute; left: 6.62%; top: 6.62%; width: 72.06%; height: 72.06%;
	border-radius: 50%; border: none; padding: 0;
	box-shadow: inset 0 0 28px rgba(0,0,0,0.3);
	overflow: hidden; clip-path: circle(50% at 50% 50%);
}
.cabn-spyglass-content {
	position: absolute; left: 10.2%; top: 20.41%; width: 79.59%; height: 59.18%;
	z-index: 1; display: flex; flex-direction: column;
}
@keyframes cabn-iris-open {
	0% { clip-path: circle(0% at 50% 50%); }
	100% { clip-path: circle(50% at 50% 50%); }
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-spyglass-lens { animation: cabn-iris-open 380ms ease-out; }
}
@media (prefers-reduced-motion: reduce) {
	.cabn-spyglass-lens { animation: cabn-fade-in 180ms ease-out; }
}

/* ================= crystal orb search — violet/cyan/pink mist ================= */
/*
 * 2026-09-28 polish pass: the original backdrop was a flat rgba(...) scrim
 * the full size of the viewport, with mist layers extending *beyond* it
 * (inset: -30%/-10%) — at night (a darker world already) that read as
 * washing out almost the whole screen instead of just framing the panel.
 * Now a radial vignette (opaque near the panel, fading to fully transparent
 * at the edges) plus mist circles sized/blurred to stay concentrated near
 * the center, so the world is still readable at the corners while walking
 * up to open the orb.
 */
.cabn-orb-backdrop {
	background: radial-gradient(
		ellipse at center,
		rgba(20, 16, 40, 0.68) 0%,
		rgba(20, 16, 40, 0.38) 42%,
		rgba(20, 16, 40, 0.08) 72%,
		rgba(20, 16, 40, 0) 100%
	);
}
.cabn-orb-mist {
	position: absolute; inset: 14%; border-radius: 50%;
	background: conic-gradient(from 0deg, var(--cabn-accent-violet), var(--cabn-accent-cyan), var(--cabn-accent-pink), var(--cabn-accent-violet));
	opacity: 0.3; filter: blur(46px);
}
.cabn-orb-mist.two { inset: 26%; opacity: 0.2; filter: blur(30px); }
@media (prefers-reduced-motion: no-preference) {
	.cabn-orb-mist { animation: cabn-swirl 10s linear infinite; }
	.cabn-orb-mist.two { animation: cabn-swirl 14s linear infinite reverse; }
}

/* The literal ball itself: the 144x184-cell ui_screen_orb art (glass rim,
   bronze stand, plum plaque) over a dark swirling glass disc that shows
   through the art's transparent interior. Percentages are art cell
   coordinates (glass centre 72,71, radius 63; results in the inscribed rect
   22,33 100x76; input on the plaque 30,155 84x15 — see tools/asset-
   pipeline's ui-screen-orb.ts). Fixed light text regardless of day/night —
   the glass interior is always dark, same reasoning as the ribbon banners'
   always-white text. */
.cabn-crystal-ball {
	position: relative; width: min(432px, 88vw, calc((88vh - 60px) * 0.7826)); aspect-ratio: 144 / 184;
	color: #f3edff;
}
.cabn-crystal-glass {
	position: absolute; left: 6.25%; top: 4.35%; width: 87.5%; height: 68.48%; border-radius: 50%;
	background: radial-gradient(circle at 32% 26%, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.05) 26%, rgba(58,35,95,0.72) 62%, rgba(18,10,36,0.94) 100%);
	box-shadow: 0 0 46px 12px rgba(138,111,214,0.5), inset 0 0 46px rgba(0,0,0,0.45);
	overflow: hidden;
}
.cabn-crystal-ball-mist {
	position: absolute; inset: 10%; border-radius: 50%;
	background: conic-gradient(from 0deg, var(--cabn-accent-violet), var(--cabn-accent-cyan), var(--cabn-accent-pink), var(--cabn-accent-violet));
	opacity: 0.28; filter: blur(30px);
}
.cabn-crystal-ball-mist.two { inset: 22%; opacity: 0.18; filter: blur(20px); }
@media (prefers-reduced-motion: no-preference) {
	.cabn-crystal-ball-mist { animation: cabn-swirl 9s linear infinite; }
	.cabn-crystal-ball-mist.two { animation: cabn-swirl 12s linear infinite reverse; }
}
.cabn-crystal-ball-content {
	position: absolute; left: 15.28%; top: 17.93%; width: 69.44%; height: 41.3%; z-index: 5;
	display: flex; flex-direction: column; overflow: auto; font-size: 13px;
	text-shadow: 0 1px 0 rgba(0,0,0,0.6);
}
.cabn-crystal-plinth {
	position: absolute; left: 20.83%; top: 84.24%; width: 58.33%; height: 8.15%; z-index: 5;
	display: flex; align-items: center; color: #f3edff;
}
@keyframes cabn-ball-rise {
	0% { transform: translateY(36px) scale(0.82); opacity: 0; }
	70% { opacity: 1; }
	100% { transform: translateY(0) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-crystal-ball { animation: cabn-ball-rise 420ms cubic-bezier(0.22, 0.8, 0.3, 1); }
}
@media (prefers-reduced-motion: reduce) {
	.cabn-crystal-ball { animation: cabn-fade-in 180ms ease-out; }
}

/* ================= bag — closed badge + literal open satchel ================= */
.cabn-satchel-closed {
	position: relative; width: 56px; height: 56px; padding: 8px; cursor: pointer;
	background: var(--cabn-panel-body); border: 3px solid var(--cabn-border-outer); border-radius: 12px;
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight), 3px 3px 0 rgba(0,0,0,0.2);
	display: flex; align-items: center; justify-content: center;
}
.cabn-satchel-closed img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }
/* Reused by both the hotbar's per-tool count badge and this satchel's slot count. */
.cabn-badge {
	position: absolute; top: -6px; right: -6px; z-index: 2;
	background: var(--cabn-accent-pink); color: #201a3d; border-radius: 50%; width: 18px; height: 18px; font-size: 10px;
	display: flex; align-items: center; justify-content: center; border: 2px solid var(--cabn-border-outer);
	font-family: var(--cabn-font-display);
}
/* The 128x116-cell ui_screen_satchel art is the whole open bag (body, side
   pouches, the flap already folded back); the animated .cabn-satchel-flap is
   the flap's outer face swinging up off the mouth, hidden once it passes
   edge-on. Percentages are art cell coordinates (flap hinge 16,30 96x30;
   content inside the stitched front panel 22,38 84x66 — see tools/asset-
   pipeline's ui-screen-satchel.ts). */
.cabn-satchel-open {
	position: relative; perspective: 420px; width: min(384px, 86vw); aspect-ratio: 128 / 116;
	background-size: 100% 100%; background-repeat: no-repeat; image-rendering: pixelated;
	filter: drop-shadow(5px 5px 0 rgba(0,0,0,0.22));
	transform-origin: bottom left;
}
.cabn-satchel-flap {
	position: absolute; left: 12.5%; top: 25.86%; width: 75%; height: 25.86%; z-index: 2;
	background-size: 100% 100%; background-repeat: no-repeat; image-rendering: pixelated;
	transform-origin: top center; backface-visibility: hidden; transform: rotateX(-180deg);
}
.cabn-satchel-content {
	position: absolute; left: 17.19%; top: 32.76%; width: 65.63%; height: 56.9%; z-index: 1;
	overflow: auto; padding: 2px;
}
.cabn-satchel-title {
	display: flex; align-items: center; justify-content: space-between; gap: 8px;
	margin: 0 0 6px; font-family: var(--cabn-font-display); font-size: 13px;
	color: #fff4dc; text-shadow: 0 2px 0 rgba(50,34,20,0.8);
}
@keyframes cabn-satchel-pop { 0% { transform: scale(0.85) translateY(10px); opacity: 0; } 100% { transform: scale(1) translateY(0); opacity: 1; } }
@keyframes cabn-flap-open { 0% { transform: rotateX(0deg); } 100% { transform: rotateX(-180deg); } }
@media (prefers-reduced-motion: no-preference) {
	.cabn-satchel-open { animation: cabn-satchel-pop 260ms ease-out; }
	.cabn-satchel-flap { animation: cabn-flap-open 380ms ease-in 120ms both; }
}
@media (prefers-reduced-motion: reduce) {
	.cabn-satchel-open { animation: cabn-fade-in 180ms ease-out; }
}
/* Each grabbed slot as a physical drawstring pouch, not a plain row. */
.cabn-bag-pouch {
	position: relative; display: flex; align-items: center; gap: 6px;
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); border-radius: 6px 6px 14px 14px;
	padding: 9px 10px 6px; font-size: 11px; color: var(--cabn-text); max-width: 100%; min-width: 0;
}
.cabn-bag-pouch::before {
	content: ""; position: absolute; top: -4px; left: 50%; transform: translateX(-50%);
	width: 18px; height: 7px; border-radius: 4px; background: var(--cabn-border-outer);
}
.cabn-bag-pouch-label { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: none; color: inherit; font: inherit; cursor: pointer; }

/*
 * ================= spellbook — open-book frame =================
 * The editor+run screen as a literal open tome (playtest feedback: "editing/
 * code running feels a little clunky... we want the editors to feel part of
 * the world but still be fully functional") — a page spread with a spine
 * down the middle and a ribbon bookmark, flat pixel-RPG style throughout, no
 * wood/parchment texture (explicitly rejected in review). Opens with a fast
 * scaleX+rotateY "cover falling open" pop, comfortably under 500ms; reduced
 * motion falls back to a plain fade via the shared cabn-fade-in keyframe.
 */
.cabn-spellbook-spread {
	position: relative; flex: 1; min-height: 0; display: flex; perspective: 1600px;
	background: var(--cabn-panel-body); border: 4px solid var(--cabn-border-outer); border-radius: 14px;
	box-shadow: inset 0 0 0 3px var(--cabn-border-highlight), 8px 8px 0 rgba(0,0,0,0.25);
	overflow: hidden; transform-origin: left center;
}
.cabn-spellbook-page { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.cabn-spellbook-page.left { padding: 0; }
.cabn-spellbook-page.right { padding: 12px 16px; background: var(--cabn-panel-body-alt); }
.cabn-spellbook-page-header {
	position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center;
	padding: 8px 16px; font-size: 13px;
}
.cabn-spellbook-page.left .cabn-spellbook-page-header { background: var(--cabn-border-outer); color: #fff; }
.cabn-spellbook-page.right .cabn-spellbook-page-header { padding: 0 0 6px; font-weight: bold; }
.cabn-spellbook-spine {
	position: relative; flex: none; width: 12px;
	background: linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0.04) 45%, rgba(0,0,0,0.04) 55%, rgba(0,0,0,0.28));
	z-index: 2; pointer-events: none;
}
.cabn-spellbook-ribbon {
	position: absolute; top: -6px; left: 26%; width: 20px; height: 44px; z-index: 3; pointer-events: none;
	background: var(--cabn-accent-pink); clip-path: polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%);
	box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
}
.cabn-spellbook-controls {
	display: flex; align-items: center; justify-content: space-between; gap: 12px;
	padding: 8px 4px 0; flex-wrap: wrap;
}
/* A readable chip, not bare text on the world behind it — floating text over
   grass/night-sky backgrounds tested poorly for contrast either theme. */
.cabn-spellbook-status {
	font-size: 11px; background: var(--cabn-panel-body); color: var(--cabn-text);
	border: 2px solid var(--cabn-border-outer); border-radius: 10px; padding: 5px 10px;
}
.cabn-spellbook-errors { font-size: 12px; }
.cabn-spellbook-error-row {
	width: 100%; display: flex; gap: 8px; text-align: left; background: none; border: none;
	border-bottom: 2px dotted var(--cabn-border-outer); font: inherit; padding: 5px 2px; cursor: pointer; color: inherit;
}
.cabn-spellbook-error-row:disabled { cursor: default; opacity: 0.6; }
.cabn-spellbook-error-line {
	flex: none; min-width: 22px; text-align: right; font-family: var(--cabn-font-mono);
	color: var(--cabn-text-secondary);
}
@keyframes cabn-book-open {
	0% { transform: scaleX(0.1) rotateY(40deg); opacity: 0; }
	100% { transform: scaleX(1) rotateY(0deg); opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-spellbook-spread { animation: cabn-book-open 420ms cubic-bezier(0.22, 0.8, 0.3, 1); }
}
@media (prefers-reduced-motion: reduce) {
	.cabn-spellbook-spread { animation: cabn-fade-in 180ms ease-out; }
}

/*
 * ================= editor (quill) — ink blot + drifting glyphs =================
 * 2026-09-28 polish pass: neither of these actually rendered before this pass
 * (EditorOverlay.tsx had no markup for them at all, despite the mockup
 * always including them) — "barely visible" was really "entirely absent".
 * Opacities here are deliberately a notch above the mockup's own (0.4/0.6
 * peak) per explicit user feedback that the quill screen read as flat —
 * still low enough not to fight code readability (STYLE.md's "subtle, by
 * design" reasoning still holds), just no longer imperceptible.
 */
.cabn-editor-ink-blot {
	position: absolute; top: -10px; right: 18px; width: 30px; height: 30px; border-radius: 50%;
	background: radial-gradient(circle, var(--cabn-border-outer) 45%, transparent 72%);
	opacity: 0.55; pointer-events: none; z-index: 2;
}
.cabn-editor-glyph {
	position: absolute; pointer-events: none; z-index: 2;
	font-family: var(--cabn-font-mono); color: var(--cabn-accent-violet);
	font-size: 20px; opacity: 0;
}
@keyframes cabn-glyph-drift {
	0% { opacity: 0; transform: translateY(0); }
	15% { opacity: 0.7; }
	100% { opacity: 0; transform: translateY(-32px); }
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-editor-glyph { animation: cabn-glyph-drift 3.4s ease-in infinite; }
}

/* ================= ribbon banners (encounter + victory) ================= */
.cabn-ribbon { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 260px; padding: 10px 36px; }
.cabn-ribbon-shape {
	position: absolute; inset: 0; background: var(--cabn-accent-pink);
	clip-path: polygon(6% 0%, 94% 0%, 100% 50%, 94% 100%, 6% 100%, 0% 50%);
	border-radius: 4px; box-shadow: 3px 3px 0 rgba(0,0,0,0.2);
}
.cabn-ribbon.victory .cabn-ribbon-shape { background: var(--cabn-accent-green); }
.cabn-ribbon span { position: relative; z-index: 1; font-size: 15px; color: #fff; text-shadow: 1px 1px 0 rgba(0,0,0,0.35); font-family: var(--cabn-font-display); }
.cabn-encounter-flash { position: absolute; inset: -4px; border-radius: 16px; background: #fff; opacity: 0; pointer-events: none; }
@keyframes cabn-shake { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(3px); } 30%, 50%, 70% { transform: translateX(-5px); } 40%, 60% { transform: translateX(5px); } }
@keyframes cabn-flash-pulse { 0% { opacity: 0.85; } 100% { opacity: 0; } }
/* The flash keeps running under reduced motion too (see STYLE.md's Motion table) — a brief opacity change isn't the vestibular-motion category that setting targets; only the positional shake is gated. */
.cabn-encounter-card.play .cabn-encounter-flash { animation: cabn-flash-pulse 450ms ease-out; }
@media (prefers-reduced-motion: no-preference) {
	.cabn-encounter-card.play { animation: cabn-shake 450ms ease-in-out; }
}
.cabn-confetti { position: absolute; width: 8px; height: 8px; top: 50%; left: 50%; margin: -4px; opacity: 0; }
@keyframes cabn-confetti-out {
	0% { opacity: 1; transform: translate(0,0) rotate(0deg); }
	100% { opacity: 0; transform: translate(var(--cabn-tx), var(--cabn-ty)) rotate(var(--cabn-rot)); }
}
.cabn-victory-toast.play .cabn-confetti { animation: cabn-burst-fade 500ms ease-out forwards; }

/* ================= wand / run — literal spell-circle cast ================= */
.cabn-rune-ring { position: absolute; inset: -26%; border-radius: 50%; border: 3px dashed var(--cabn-accent-violet); opacity: 0.55; }
.cabn-rune-ring.two { inset: -14%; border-color: var(--cabn-accent-cyan); border-width: 2px; }
.cabn-rune-ring.three { inset: -36%; border-color: var(--cabn-accent-yellow); border-width: 2px; opacity: 0.4; }
.cabn-rune-dot { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--cabn-accent-yellow); box-shadow: 0 0 8px 2px var(--cabn-accent-yellow); }
/* The wand icon itself, floating faintly behind the console — the literal
   object this screen is "opening", same idea as the crystal ball/spyglass/
   satchel screens centering their own tool icon. Low opacity + no pointer
   events: purely atmospheric, never competes with the run log for attention. */
.cabn-wand-cast-icon {
	position: absolute; top: 50%; left: 50%; width: 96px; height: 96px;
	transform: translate(-50%, -50%); opacity: 0.16; pointer-events: none;
	image-rendering: pixelated; z-index: 0;
}
@keyframes cabn-wand-cast {
	0% { transform: scale(0.2) rotate(-25deg); opacity: 0; }
	60% { transform: scale(1.06) rotate(4deg); opacity: 1; }
	100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
.cabn-wand-cast { animation: cabn-wand-cast 380ms cubic-bezier(0.2, 0.9, 0.3, 1.2); transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
	.cabn-wand-cast { animation: cabn-fade-in 180ms ease-out; }
}
.cabn-run-line-current {
	background: rgba(255,210,63,0.35); border-left: 4px solid var(--cabn-accent-yellow);
	padding: 2px 8px; font-family: var(--cabn-font-mono); font-size: 12px; border-radius: 4px;
}
.cabn-run-log { background: var(--cabn-inset-tint); padding: 6px 8px; font-family: var(--cabn-font-mono); font-size: 11px; border-radius: 6px; }
.cabn-speed-btn {
	font-family: var(--cabn-font-display); font-size: 11px; border: 2px solid var(--cabn-border-outer);
	padding: 3px 9px; background: var(--cabn-panel-body-alt); cursor: pointer; color: var(--cabn-text); border-radius: 6px;
}
/* Same fixed-dark-ink reasoning as .cabn-btn above — "active" swaps the fill for the bright accent. */
.cabn-speed-btn.active { background: var(--cabn-accent-yellow); color: #201a3d; }
@media (prefers-reduced-motion: no-preference) {
	.cabn-rune-ring { animation: cabn-spin-slow 7s linear infinite; }
	.cabn-rune-ring.two { animation-direction: reverse; animation-duration: 9s; }
	.cabn-rune-ring.three { animation-duration: 13s; }
}

@media (prefers-reduced-motion: no-preference) {
	.cabn-sparkle { animation: cabn-twinkle 1.4s ease-in-out infinite; }
	.cabn-hotbar-slot:hover::after { animation: cabn-sheen 650ms ease-out; }
	.cabn-effect-burst.play .cabn-spark { animation: cabn-burst-out 600ms ease-out forwards; }
	.cabn-victory-toast.play .cabn-confetti { animation: cabn-confetti-out 900ms ease-out forwards; }
}
@keyframes cabn-swirl { to { transform: rotate(360deg); } }
@keyframes cabn-sheen { 0% { transform: translateX(-60%); } 100% { transform: translateX(60%); } }
@keyframes cabn-spin-slow { to { transform: rotate(360deg); } }

/* ================= scene transitions (see systems/sceneTransition.ts for the timing this mirrors) ================= */
.cabn-transition-fade { position: absolute; inset: 0; background: #000; pointer-events: none; }
@keyframes cabn-fade-in-out {
	0% { opacity: 0; }
	40% { opacity: 1; }
	60% { opacity: 1; }
	100% { opacity: 0; }
}
.cabn-transition-fade.play { animation: cabn-fade-in-out linear forwards; }

.cabn-transition-bars { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cabn-transition-bars .bar { position: absolute; left: 0; right: 0; height: 52%; background: var(--cabn-border-outer, #221a4d); }
.cabn-transition-bars .bar.top { top: 0; transform: translateY(-100%); }
.cabn-transition-bars .bar.bottom { bottom: 0; transform: translateY(100%); }
@keyframes cabn-bar-close-top { 0% { transform: translateY(-100%); } 100% { transform: translateY(0); } }
@keyframes cabn-bar-close-bottom { 0% { transform: translateY(100%); } 100% { transform: translateY(0); } }
@keyframes cabn-bar-open-top { 0% { transform: translateY(0); } 100% { transform: translateY(-100%); } }
@keyframes cabn-bar-open-bottom { 0% { transform: translateY(0); } 100% { transform: translateY(100%); } }
.cabn-transition-bars.play .bar.top { animation: cabn-bar-close-top var(--cabn-wipe-ms, 200ms) ease-in forwards, cabn-bar-open-top var(--cabn-reveal-ms, 160ms) ease-out forwards var(--cabn-wipe-ms, 200ms); }
.cabn-transition-bars.play .bar.bottom { animation: cabn-bar-close-bottom var(--cabn-wipe-ms, 200ms) ease-in forwards, cabn-bar-open-bottom var(--cabn-reveal-ms, 160ms) ease-out forwards var(--cabn-wipe-ms, 200ms); }
.cabn-transition-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.cabn-transition-flash.play { animation: cabn-flash-pulse var(--cabn-flash-ms, 90ms) ease-out; }

.cabn-transition-wipe {
	position: absolute; inset: 0; pointer-events: none;
	background: linear-gradient(100deg, var(--cabn-panel-body, #f2f8ff) 45%, var(--cabn-accent-violet, #8a6fd6) 50%, transparent 55%);
	transform: translateX(-120%);
}
@keyframes cabn-wipe-across { 0% { transform: translateX(-120%); } 50% { transform: translateX(0); } 100% { transform: translateX(120%); } }
.cabn-transition-wipe.play { animation: cabn-wipe-across var(--cabn-wipe-total-ms, 340ms) ease-in-out forwards; }

@media (prefers-reduced-motion: reduce) {
	.cabn-transition-bars.play .bar,
	.cabn-transition-wipe.play {
		animation: none !important;
		display: none;
	}
}
`;

let styleInjected = false;

/** Idempotent — safe to call from multiple mounted <PixelTheme> instances (e.g. two CabnGame widgets, or a test remounting one) since the stylesheet's content never varies per-instance. */
function ensurePixelThemeStyleInjected(): void {
	if (styleInjected || typeof document === "undefined") return;
	if (document.getElementById(STYLE_ELEMENT_ID)) {
		styleInjected = true;
		return;
	}
	const style = document.createElement("style");
	style.id = STYLE_ELEMENT_ID;
	style.textContent = PIXEL_THEME_CSS;
	document.head.appendChild(style);
	styleInjected = true;
}

export interface PixelThemeProps {
	store: StoreApi<CabnStore>;
	children: React.ReactNode;
}

/**
 * Injects the token/keyframe stylesheet once and wraps `children` in a
 * `data-theme`-bearing root div — every panel/hotbar/etc. component below it
 * reads the resulting CSS custom properties via plain `var(--cabn-...)`
 * values in its own inline styles or `cabn-*` class names, per
 * IMPLEMENTATION-PLAN.md section 2's "subscribe once, let CSS cascade" shape
 * (same pattern GlowPipeline.ts already uses for glowEnabled, just for CSS
 * custom properties instead of a Phaser pipeline).
 */
export function PixelTheme({
	store,
	children,
}: PixelThemeProps): React.ReactElement {
	const timeOfDay = useCabnStore(store, (s) => s.timeOfDay);

	useEffect(() => {
		ensurePixelThemeStyleInjected();
	}, []);

	return (
		// pointerEvents: "none" so this always-present, full-bleed wrapper never
		// blocks clicks/drags meant for the Phaser canvas underneath — every
		// overlay child that has its own clickable buttons (spyglass/orb/bag/
		// settings/editor/run) sets pointerEvents: "auto" on its own root for
		// that reason, the same "none on the pass-through parent, auto on the
		// actual interactive element" shape ToolHotbar's flex container already
		// used before this wrapper existed.
		<div
			className="cabn-pixel-root"
			data-theme={timeOfDay}
			style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
		>
			{children}
		</div>
	);
}
