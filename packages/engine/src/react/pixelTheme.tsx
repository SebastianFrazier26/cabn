import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { DOT_GOTHIC16_LATIN_WOFF2_BASE64 } from "./fonts/dotGothic16.js";
import { useCabnStore } from "./useCabnStore.js";

// Every class/custom-property name here is prefixed `cabn-`/`--cabn-` and
// every selector is scoped under `.cabn-pixel-root` rather than `:root`/
// `body` (the mockup's own scoping) — this package is an embeddable widget
// inside a host page, not a full page it owns, so it must never reach past
// its own container into the host's global `:root`/`body` styles.
const STYLE_ELEMENT_ID = "cabn-pixel-theme-style";

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

.cabn-pixel-root {
	--cabn-panel-body: #f2f8ff;
	--cabn-panel-body-alt: #dff0ff;
	--cabn-border-outer: #3b2f6b;
	--cabn-border-highlight: #8fd6ef;
	--cabn-text: #201a3d;
	--cabn-text-secondary: #55507f;
	--cabn-accent-yellow: #ffd23f;
	--cabn-accent-green: #5ec26a;
	--cabn-accent-pink: #ef5fa0;
	--cabn-accent-orange: #ff9142;
	--cabn-accent-cyan: #4fd0d8;
	--cabn-accent-violet: #8a6fd6;
	--cabn-font-display: "CabnDotGothic16", system-ui, sans-serif;
	--cabn-font-mono: "JetBrains Mono", "Courier New", monospace;
	font-family: var(--cabn-font-display);
	color: var(--cabn-text);
}
.cabn-pixel-root[data-theme="night"] {
	--cabn-panel-body: #eeeaff;
	--cabn-panel-body-alt: #ded6ff;
	--cabn-border-outer: #221a4d;
	--cabn-border-highlight: #ffd23f;
	--cabn-text: #1c1640;
	--cabn-text-secondary: #635ca8;
	--cabn-accent-yellow: #ffcf4d;
	--cabn-accent-green: #46d19a;
	--cabn-accent-pink: #ff4fa0;
	--cabn-accent-orange: #ff7a45;
	--cabn-accent-cyan: #46c9e0;
	--cabn-accent-violet: #7a5fe0;
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
	border: 3px solid var(--cabn-border-outer); cursor: pointer; color: var(--cabn-text);
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
.cabn-hotbar-slot .cabn-badge {
	position: absolute; top: -6px; right: -6px; z-index: 2;
	background: var(--cabn-accent-pink); color: var(--cabn-text); border-radius: 50%; width: 18px; height: 18px; font-size: 10px;
	display: flex; align-items: center; justify-content: center; border: 2px solid var(--cabn-border-outer);
	font-family: var(--cabn-font-display);
}
.cabn-hotbar-slot::after {
	content: ""; position: absolute; inset: -60%; z-index: 1; pointer-events: none;
	background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,0.65) 50%, transparent 58%);
	transform: translateX(-60%);
}
@media (prefers-reduced-motion: reduce) {
	.cabn-hotbar-slot:hover { filter: brightness(1.15); }
}

/* ================= spyglass — lens vignette ================= */
.cabn-spyglass-frame { width: 260px; position: relative; overflow: hidden; }
.cabn-spyglass-frame::before {
	content: ""; position: absolute; inset: 0; border-radius: 10px; pointer-events: none; z-index: 2;
	background: radial-gradient(circle at center, transparent 45%, rgba(10,8,30,0.65) 100%);
}
.cabn-spyglass-frame::after {
	content: ""; position: absolute; inset: -40%; pointer-events: none; z-index: 2;
	background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.5) 50%, transparent 65%);
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-spyglass-frame::after { animation: cabn-sheen 2.6s linear infinite; }
}

/* ================= crystal orb search — violet/cyan/pink mist ================= */
.cabn-orb-mist {
	position: absolute; inset: -30%;
	background: conic-gradient(from 0deg, var(--cabn-accent-violet), var(--cabn-accent-cyan), var(--cabn-accent-pink), var(--cabn-accent-violet));
	opacity: 0.5; filter: blur(22px);
}
.cabn-orb-mist.two { inset: -10%; opacity: 0.3; filter: blur(14px); }
@media (prefers-reduced-motion: no-preference) {
	.cabn-orb-mist { animation: cabn-swirl 10s linear infinite; }
	.cabn-orb-mist.two { animation: cabn-swirl 14s linear infinite reverse; }
}

/* ================= bag tray — open satchel interior ================= */
.cabn-bag-frame { position: relative; overflow: hidden; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.cabn-bag-frame::before {
	content: ""; position: absolute; inset: 6px; border-radius: 8px; pointer-events: none;
	background: radial-gradient(ellipse at 50% 0%, rgba(120,70,30,0.32), transparent 70%);
	border: 2px dashed rgba(120,70,30,0.45);
}
.cabn-bag-slot {
	position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between;
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); border-radius: 8px;
	padding: 5px 10px; font-size: 11px; color: var(--cabn-text); max-width: 220px;
}
.cabn-bag-slot.filled { box-shadow: 0 0 0 2px var(--cabn-accent-yellow); }
.cabn-bag-slot .cabn-x { opacity: 0.55; cursor: pointer; }

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

/* ================= wand / run — rune scroll ================= */
.cabn-rune-ring { position: absolute; inset: -26%; border-radius: 50%; border: 3px dashed var(--cabn-accent-violet); opacity: 0.55; }
.cabn-rune-ring.two { inset: -14%; border-color: var(--cabn-accent-cyan); border-width: 2px; }
.cabn-rune-ring.three { inset: -36%; border-color: var(--cabn-accent-yellow); border-width: 2px; opacity: 0.4; }
.cabn-rune-dot { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--cabn-accent-yellow); box-shadow: 0 0 8px 2px var(--cabn-accent-yellow); }
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
