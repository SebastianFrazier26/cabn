import { useEffect } from "react";

// Own <style> element, same reasoning and scoping as portalFxStyles.ts:
// these rules belong to one component, and everything stays under
// .cabn-pixel-root. Colours are only the pixel theme's --cabn-* tokens, so
// day/night follows the theme root's data-theme with no code here.
const STYLE_ELEMENT_ID = "cabn-guide-dialog-style";

const GUIDE_DIALOG_CSS = `
.cabn-pixel-root .cabn-guide-backdrop { position: absolute; inset: 0; z-index: 9; pointer-events: auto; }
.cabn-pixel-root .cabn-guide-box {
	position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%);
	width: min(660px, calc(100% - 32px)); box-sizing: border-box;
	display: flex; gap: 14px; align-items: flex-start; padding: 18px 18px 12px;
	animation: cabn-fade-in 160ms ease-out both;
}
.cabn-pixel-root .cabn-guide-portrait {
	flex: none; width: 96px; height: 84px; box-sizing: border-box; overflow: hidden;
	background: var(--cabn-panel-body-alt); border: 3px solid var(--cabn-border-outer); border-radius: 10px;
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight);
	display: flex; align-items: flex-end; justify-content: center;
}
.cabn-pixel-root .cabn-guide-portrait img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.cabn-pixel-root .cabn-guide-body { flex: 1; min-width: 0; }
/* Fixed dark ink on the bright accent, same reasoning as .cabn-btn. */
.cabn-pixel-root .cabn-guide-name {
	position: absolute; top: -15px; left: 124px; padding: 2px 12px; font-size: 13px;
	background: var(--cabn-accent-green); color: #201a3d;
	border: 3px solid var(--cabn-border-outer); border-radius: 8px; box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
}
.cabn-pixel-root .cabn-guide-text {
	margin: 2px 0 10px; min-height: 4.6em; font-size: 15px; line-height: 1.55;
	white-space: pre-line; color: var(--cabn-text); cursor: pointer;
}
.cabn-pixel-root .cabn-guide-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.cabn-pixel-root .cabn-guide-more { display: inline-block; margin-left: 6px; color: var(--cabn-accent-orange); font-size: 11px; }
@keyframes cabn-guide-more-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.cabn-pixel-root .cabn-guide-topics {
	list-style: none; margin: 0 0 10px; padding: 0;
	display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px;
}
.cabn-pixel-root .cabn-guide-topic {
	width: 100%; box-sizing: border-box; display: flex; gap: 8px; align-items: flex-start; text-align: left;
	font-family: var(--cabn-font-display); font-size: 13px; padding: 6px 8px; cursor: pointer;
	background: var(--cabn-panel-body-alt); color: var(--cabn-text);
	border: 2px solid var(--cabn-border-outer); border-radius: 8px;
}
.cabn-pixel-root .cabn-guide-topic:hover { background: var(--cabn-inset-tint); }
.cabn-pixel-root .cabn-guide-topic.selected { box-shadow: 0 0 0 3px var(--cabn-accent-yellow); }
.cabn-pixel-root .cabn-guide-topic kbd {
	flex: none; font-family: var(--cabn-font-display); font-size: 11px; padding: 1px 6px; border-radius: 4px;
	background: var(--cabn-border-outer); color: #fff;
}
.cabn-pixel-root .cabn-guide-topic small { display: block; font-size: 11px; color: var(--cabn-text-secondary); margin-top: 2px; }
.cabn-pixel-root .cabn-guide-footer {
	display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
	font-size: 11px; color: var(--cabn-text-secondary);
}
.cabn-pixel-root .cabn-guide-footer .cabn-guide-actions { display: flex; gap: 6px; }
.cabn-pixel-root .cabn-guide-footer .cabn-btn { padding: 4px 10px; font-size: 11px; }
.cabn-pixel-root .cabn-guide-footer .cabn-btn:disabled { opacity: 0.45; cursor: default; }
@keyframes cabn-guide-pop {
	0% { transform: translateX(-50%) translateY(14px) scale(0.94); opacity: 0; }
	100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
	.cabn-pixel-root .cabn-guide-box { animation: cabn-guide-pop 220ms cubic-bezier(0.22, 0.8, 0.3, 1.1) both; }
	.cabn-pixel-root .cabn-guide-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.cabn-pixel-root .cabn-guide-more { animation: cabn-guide-more-bob 900ms ease-in-out infinite; }
}
`;

let styleInjected = false;

function injectStyle(): void {
	if (styleInjected || typeof document === "undefined") return;
	if (!document.getElementById(STYLE_ELEMENT_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ELEMENT_ID;
		style.textContent = GUIDE_DIALOG_CSS;
		document.head.appendChild(style);
	}
	styleInjected = true;
}

export function useGuideDialogStyles(): void {
	useEffect(injectStyle, []);
}
