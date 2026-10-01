import { useEffect } from "react";

// Own <style> element, same scoping as guideDialogStyles.ts: everything under
// .cabn-pixel-root and only the pixel theme's --cabn-* tokens, so night
// follows the theme root with no code here.
const STYLE_ELEMENT_ID = "cabn-pet-style";

const PET_CSS = `
.cabn-pixel-root .cabn-pet-corner {
	position: absolute; top: 60px; left: 16px; z-index: 6; pointer-events: auto;
	display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 6px;
}
.cabn-pixel-root .cabn-pet-corner img { width: 26px; height: 26px; image-rendering: pixelated; }
.cabn-pixel-root .cabn-pet-backdrop { position: absolute; inset: 0; z-index: 9; pointer-events: auto; background: rgba(20, 14, 30, 0.25); }
.cabn-pixel-root .cabn-pet-panel {
	position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
	width: min(640px, calc(100% - 32px)); max-height: calc(100% - 48px); overflow: auto; box-sizing: border-box;
	display: flex; flex-direction: column; gap: 10px; animation: cabn-fade-in 160ms ease-out both;
}
.cabn-pixel-root .cabn-pet-providers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.cabn-pixel-root .cabn-pet-provider {
	display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer;
	font-family: var(--cabn-font-display); font-size: 12px; padding: 6px; color: var(--cabn-text);
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); border-radius: 8px;
}
.cabn-pixel-root .cabn-pet-provider img { width: 40px; height: 40px; image-rendering: pixelated; flex: none; }
.cabn-pixel-root .cabn-pet-provider small { display: block; font-size: 10px; color: var(--cabn-text-secondary); }
.cabn-pixel-root .cabn-pet-provider[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--cabn-accent-yellow); }
.cabn-pixel-root .cabn-pet-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.cabn-pixel-root .cabn-pet-field input[type="password"], .cabn-pixel-root .cabn-pet-field input[type="text"],
.cabn-pixel-root .cabn-pet-field select, .cabn-pixel-root .cabn-pet-input {
	font-family: var(--cabn-font-mono); font-size: 13px; padding: 6px 8px; color: var(--cabn-text);
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); border-radius: 6px;
}
.cabn-pixel-root .cabn-pet-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.cabn-pixel-root .cabn-pet-row .cabn-btn { padding: 5px 12px; font-size: 11px; }
.cabn-pixel-root .cabn-pet-note { font-size: 11px; color: var(--cabn-text-secondary); line-height: 1.5; margin: 0; }
.cabn-pixel-root .cabn-pet-panel a { color: inherit; text-decoration: underline; }
.cabn-pixel-root .cabn-pet-warning {
	font-size: 11px; line-height: 1.5; margin: 0; padding: 6px 8px; border-radius: 6px;
	border: 2px dashed var(--cabn-accent-orange); color: var(--cabn-text);
}
.cabn-pixel-root .cabn-pet-status { font-size: 12px; min-height: 1.4em; margin: 0; }
/* --cabn-error-ink, not the raw accent-pink: too low-contrast as text on panelBody in day/crimson (uiContrast.test.ts). */
.cabn-pixel-root .cabn-pet-status.error { color: var(--cabn-error-ink); }
.cabn-pixel-root .cabn-pet-chat {
	position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 9; pointer-events: auto;
	width: min(720px, calc(100% - 32px)); height: min(460px, calc(100% - 140px)); box-sizing: border-box;
	display: flex; flex-direction: column; gap: 8px; padding: 18px 14px 12px; animation: cabn-fade-in 160ms ease-out both;
}
.cabn-pixel-root .cabn-pet-name {
	position: absolute; top: -15px; left: 20px; padding: 2px 12px; font-size: 13px; color: #201a3d;
	border: 3px solid var(--cabn-border-outer); border-radius: 8px; box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
}
.cabn-pixel-root .cabn-pet-log { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
.cabn-pixel-root .cabn-pet-msg { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.55; }
.cabn-pixel-root .cabn-pet-msg img { width: 36px; height: 36px; image-rendering: pixelated; flex: none; }
.cabn-pixel-root .cabn-pet-bubble {
	white-space: pre-wrap; word-break: break-word; padding: 6px 10px; border-radius: 8px;
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); max-width: 85%;
}
.cabn-pixel-root .cabn-pet-msg.player { justify-content: flex-end; }
.cabn-pixel-root .cabn-pet-msg.player .cabn-pet-bubble { background: var(--cabn-inset-tint); }
.cabn-pixel-root .cabn-pet-msg.error .cabn-pet-bubble { border-color: var(--cabn-accent-pink); }
.cabn-pixel-root .cabn-pet-bubble a { color: var(--cabn-accent-violet); }
.cabn-pixel-root .cabn-pet-cites { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.cabn-pixel-root .cabn-pet-cite {
	font-family: var(--cabn-font-mono); font-size: 11px; cursor: pointer; padding: 1px 6px; border-radius: 4px;
	color: var(--cabn-text); background: var(--cabn-panel-body); border: 2px solid var(--cabn-accent-cyan);
}
.cabn-pixel-root .cabn-pet-proposal-card {
	margin-top: 6px; padding: 6px 8px; border-radius: 6px; border: 2px solid var(--cabn-accent-violet); font-size: 12px;
	display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap;
}
.cabn-pixel-root .cabn-pet-progress { font-size: 11px; color: var(--cabn-text-secondary); min-height: 1.4em; }
.cabn-pixel-root .cabn-pet-compose { display: flex; gap: 8px; align-items: stretch; }
.cabn-pixel-root .cabn-pet-input { flex: 1; resize: none; font-family: var(--cabn-font-display); min-height: 2.6em; }
.cabn-pixel-root .cabn-pet-review {
	position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; gap: 6px;
	background: var(--cabn-panel-body); padding: 4px; box-sizing: border-box;
}
.cabn-pixel-root .cabn-pet-diff {
	flex: 1; min-height: 0; overflow: auto; margin: 0; font-family: var(--cabn-font-mono); font-size: 12px; line-height: 1.5;
	background: var(--cabn-panel-body-alt); border: 2px solid var(--cabn-border-outer); border-radius: 6px; padding: 4px 0;
}
.cabn-pixel-root .cabn-pet-diff div { white-space: pre; padding: 0 8px; }
.cabn-pixel-root .cabn-pet-diff .del { background: rgba(230, 60, 50, 0.18); }
.cabn-pixel-root .cabn-pet-diff .add { background: rgba(70, 150, 60, 0.22); }
.cabn-pixel-root .cabn-pet-diff .gap { color: var(--cabn-text-secondary); font-style: italic; }
.cabn-pixel-root .cabn-pet-diff .ln { display: inline-block; width: 3.2em; color: var(--cabn-text-secondary); user-select: none; }
`;

export function usePetStyles(): void {
	useEffect(() => {
		if (typeof document === "undefined") return;
		if (document.getElementById(STYLE_ELEMENT_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ELEMENT_ID;
		style.textContent = PET_CSS;
		document.head.appendChild(style);
	}, []);
}
