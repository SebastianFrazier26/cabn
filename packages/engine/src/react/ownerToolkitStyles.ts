import { useEffect } from "react";

// Own <style> element, same reasoning and scoping as guideDialogStyles.ts.
// Colours are only --cabn-* tokens, so Meadow/Berry and an active layer's
// palette (layerUiTokens) all reach the menu with no code here.
const STYLE_ELEMENT_ID = "cabn-owner-toolkit-style";

const OWNER_TOOLKIT_CSS = `
.cabn-pixel-root .cabn-owner-toolkit {
	position: absolute; right: -6px; bottom: calc(100% + 12px); z-index: 7;
	width: 248px; box-sizing: border-box; padding: 8px 8px 6px; pointer-events: auto;
	background: var(--cabn-panel-body); color: var(--cabn-text);
	border: 3px solid var(--cabn-border-outer); border-radius: 10px;
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight), 4px 4px 0 rgba(0,0,0,0.22);
	font-family: var(--cabn-font-display); text-align: left;
	animation: cabn-fade-in 120ms ease-out both;
}
.cabn-pixel-root .cabn-owner-toolkit::after {
	content: ""; position: absolute; right: 30px; bottom: -9px; width: 12px; height: 12px;
	background: var(--cabn-panel-body); border-right: 3px solid var(--cabn-border-outer);
	border-bottom: 3px solid var(--cabn-border-outer); transform: rotate(45deg);
}
.cabn-pixel-root .cabn-owner-toolkit-title {
	font-size: 12px; margin: 0 2px 6px; color: var(--cabn-text-secondary); letter-spacing: 0.04em;
}
.cabn-pixel-root .cabn-owner-toolkit ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.cabn-pixel-root .cabn-owner-toolkit-group {
	font-size: 10px; margin: 6px 4px 2px; color: var(--cabn-text-secondary);
	border-top: 2px solid var(--cabn-border-outer); padding-top: 5px; opacity: 0.85;
}
.cabn-pixel-root .cabn-owner-toolkit-row {
	width: 100%; display: flex; align-items: center; gap: 7px; padding: 4px 6px;
	font: inherit; font-size: 13px; color: inherit; text-align: left; cursor: pointer;
	background: none; border: 2px solid transparent; border-radius: 6px;
}
.cabn-pixel-root .cabn-owner-toolkit-row.picked {
	background: var(--cabn-panel-body-alt); border-color: var(--cabn-border-outer);
}
.cabn-pixel-root .cabn-owner-toolkit-row.picked::before {
	content: ""; flex: none; width: 0; height: 0; margin-right: -3px;
	border-top: 5px solid transparent; border-bottom: 5px solid transparent;
	border-left: 6px solid var(--cabn-accent-yellow);
}
.cabn-pixel-root .cabn-owner-toolkit-row kbd {
	flex: none; font-family: var(--cabn-font-display); font-size: 10px; line-height: 16px;
	min-width: 16px; text-align: center; border-radius: 4px;
	/* --cabn-chip-ink: see pixelTheme.tsx's .cabn-segmented button.selected comment — same background, same fix. */
	background: var(--cabn-border-outer); color: var(--cabn-chip-ink);
}
.cabn-pixel-root .cabn-owner-toolkit-row img {
	flex: none; width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated;
}
.cabn-pixel-root .cabn-owner-toolkit-glyph {
	flex: none; width: 10px; height: 10px; margin: 0 7px; border-radius: 50%;
	background: var(--cabn-accent-orange); border: 2px solid var(--cabn-border-outer);
}
.cabn-pixel-root .cabn-owner-toolkit-text { flex: 1; min-width: 0; display: grid; }
.cabn-pixel-root .cabn-owner-toolkit-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cabn-pixel-root .cabn-owner-toolkit-detail {
	font-size: 10px; color: var(--cabn-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Fixed dark ink on the bright accent, same reasoning as .cabn-btn. */
.cabn-pixel-root .cabn-owner-toolkit-on {
	flex: none; font-size: 10px; padding: 0 5px; border-radius: 4px; line-height: 15px;
	background: var(--cabn-accent-green); color: #201a3d; border: 2px solid var(--cabn-border-outer);
}
.cabn-pixel-root .cabn-owner-toolkit-hint {
	margin: 6px 2px 0; font-size: 10px; color: var(--cabn-text-secondary);
}
`;

let styleInjected = false;

function injectStyle(): void {
	if (styleInjected || typeof document === "undefined") return;
	if (!document.getElementById(STYLE_ELEMENT_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ELEMENT_ID;
		style.textContent = OWNER_TOOLKIT_CSS;
		document.head.appendChild(style);
	}
	styleInjected = true;
}

export function useOwnerToolkitStyles(): void {
	useEffect(injectStyle, []);
}
