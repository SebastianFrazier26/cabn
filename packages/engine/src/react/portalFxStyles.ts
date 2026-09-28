import { useEffect } from "react";

// Own <style> element rather than more rules in pixelTheme.tsx: those rules
// are shared with every HUD panel, while these belong only to the portal
// preview surfaces (the dock and the in-arch live page). Same scoping rule
// as the pixel theme — everything under .cabn-pixel-root, never the host's
// :root/body.
const STYLE_ELEMENT_ID = "cabn-portal-fx-style";

// Motion shape follows pixelTheme's convention: the base rules are the
// reduced-motion version (fade in place, static glow), and the movement
// only exists under prefers-reduced-motion: no-preference.
const PORTAL_FX_CSS = `
.cabn-pixel-root .cabn-dock-open { position: relative; height: 100%; animation: cabn-fade-in 160ms ease-out both; }
.cabn-pixel-root .cabn-dock-sparks { display: none; }
@keyframes cabn-dock-iris {
	0% { clip-path: inset(46% 4% 46% 4%); opacity: 0.2; transform: translateX(18px); }
	55% { clip-path: inset(0 0 0 0); opacity: 1; transform: translateX(0); }
	100% { clip-path: inset(0 0 0 0); opacity: 1; transform: translateX(0); }
}
@keyframes cabn-dock-spark {
	0% { opacity: 0; transform: translate(0, 0) scale(0.6); }
	20% { opacity: 1; }
	100% { opacity: 0; transform: translate(var(--cabn-tx), var(--cabn-ty)) scale(1.1); }
}
@keyframes cabn-dock-glow {
	0%, 100% { box-shadow: 0 0 0 2px rgba(255, 200, 97, 0.55), 0 0 0 5px rgba(127, 227, 240, 0.18); }
	50% { box-shadow: 0 0 0 2px rgba(127, 227, 240, 0.6), 0 0 0 5px rgba(255, 200, 97, 0.22); }
}
.cabn-pixel-root .cabn-dock-open > .cabn-panel,
.cabn-pixel-root .cabn-dock-open > * > .cabn-panel { box-shadow: 0 0 0 2px rgba(255, 200, 97, 0.55); }
@media (prefers-reduced-motion: no-preference) {
	.cabn-pixel-root .cabn-dock-open { animation: cabn-dock-iris 420ms steps(7, end) both; }
	.cabn-pixel-root .cabn-dock-open > .cabn-panel,
	.cabn-pixel-root .cabn-dock-open > * > .cabn-panel { animation: cabn-dock-glow 2.8s ease-in-out infinite; }
	.cabn-pixel-root .cabn-dock-sparks { display: block; position: absolute; inset: 0; pointer-events: none; z-index: 2; }
	.cabn-pixel-root .cabn-dock-sparks span {
		position: absolute; left: 0; width: 4px; height: 4px; opacity: 0;
		animation: cabn-dock-spark 760ms steps(8, end) forwards;
		animation-delay: var(--cabn-delay);
	}
}

.cabn-pixel-root .cabn-live-page {
	position: absolute; left: 0; top: 0; visibility: hidden; isolation: isolate;
	pointer-events: auto; overflow: hidden; background: #0d0a18;
	transition: opacity 180ms linear;
}
.cabn-pixel-root .cabn-live-page[data-occluded="true"] { opacity: 0.28; }
.cabn-pixel-root .cabn-live-page[data-occluded="true"],
.cabn-pixel-root .cabn-live-page[data-occluded="true"] * { pointer-events: none; }
.cabn-pixel-root .cabn-live-page-frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.cabn-pixel-root .cabn-live-page-frame .cabn-panel { border: none; border-radius: 0; box-shadow: none; }
.cabn-pixel-root .cabn-live-page-night {
	position: absolute; inset: 0; pointer-events: none; background: #7c7ec4; mix-blend-mode: multiply;
}
.cabn-pixel-root .cabn-live-page-loading {
	position: absolute; inset: 0; pointer-events: none; background: #120e22;
	display: flex; align-items: center; justify-content: center;
}
.cabn-pixel-root .cabn-live-page-loading i {
	position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1px;
	transform: rotate(var(--cabn-a)) translateY(var(--cabn-r));
}
@keyframes cabn-live-swirl { to { transform: rotate(calc(var(--cabn-a) + 360deg)) translateY(var(--cabn-r)); } }
@keyframes cabn-live-edge {
	0%, 100% { box-shadow: inset 0 0 0 1px rgba(143, 232, 255, 0.9), inset 0 0 0 3px rgba(143, 232, 255, 0.25); }
	50% { box-shadow: inset 0 0 0 1px rgba(255, 200, 97, 0.9), inset 0 0 0 3px rgba(255, 200, 97, 0.25); }
}
.cabn-pixel-root .cabn-live-page-open {
	position: absolute; inset: 0; margin: 0; padding: 0; border: none; background: transparent;
	cursor: pointer; box-shadow: inset 0 0 0 1px rgba(143, 232, 255, 0.9), inset 0 0 0 3px rgba(143, 232, 255, 0.25);
}
.cabn-pixel-root .cabn-live-page-badge {
	position: absolute; right: 3px; bottom: 3px; padding: 1px 4px; font: bold 9px "Courier New", monospace;
	color: #1d2c3a; background: #f2b544; border: 1px solid #322214; opacity: 0; transition: opacity 120ms linear;
}
.cabn-pixel-root .cabn-live-page-open:hover .cabn-live-page-badge,
.cabn-pixel-root .cabn-live-page-open:focus-visible .cabn-live-page-badge { opacity: 1; }
.cabn-pixel-root .cabn-live-page-open:hover { box-shadow: inset 0 0 0 2px #f2b544, inset 0 0 0 4px rgba(255, 200, 97, 0.35); }
@media (prefers-reduced-motion: no-preference) {
	.cabn-pixel-root .cabn-live-page-loading i { animation: cabn-live-swirl var(--cabn-d) linear infinite; }
	.cabn-pixel-root .cabn-live-page-open:not(:hover) { animation: cabn-live-edge 2.4s ease-in-out infinite; }
}

.cabn-pixel-root .cabn-web-card { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
.cabn-pixel-root .cabn-web-card-host { color: var(--cabn-text-secondary); font-size: 12px; word-break: break-all; }
.cabn-pixel-root .cabn-web-card-title { font-size: 15px; line-height: 1.3; }
.cabn-pixel-root .cabn-web-card-shot { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.cabn-pixel-root .cabn-web-card-shot img { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: pixelated; }
.cabn-pixel-root .cabn-web-card-hint { color: var(--cabn-text-secondary); font-size: 11px; }
`;

let styleInjected = false;

function injectStyle(): void {
	if (styleInjected || typeof document === "undefined") return;
	if (!document.getElementById(STYLE_ELEMENT_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ELEMENT_ID;
		style.textContent = PORTAL_FX_CSS;
		document.head.appendChild(style);
	}
	styleInjected = true;
}

export function usePortalFxStyles(): void {
	useEffect(injectStyle, []);
}

/** Warm/cool alternating, matching the in-world mote palette (render/portalFx.ts). */
export const SPARK_COLORS = [
	"#f2b544",
	"#7fe3f0",
	"#ff9f6b",
	"#9aa8ff",
	"#fff1c4",
	"#b27cd6",
] as const;
