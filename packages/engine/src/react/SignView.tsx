import type {
	SeynDocument,
	SeynInline,
	SeynLinkTarget,
} from "@cabn/world-schema";
import { useEffect } from "react";
import {
	isSafeSignUrl,
	resolveSignLink,
	type SignLinkWorld,
} from "../systems/signs.js";

export interface SignViewProps {
	doc: SeynDocument;
	/** Shown when the sign has no `# title` line. */
	fallbackTitle: string;
	world: SignLinkWorld;
	/** Absent (the approach popup): links render as plain labels, and the whole panel is the click target instead. */
	onFollow?: (target: SeynLinkTarget) => void;
}

/**
 * A parsed sign as React elements — text nodes only, never
 * dangerouslySetInnerHTML, so nothing a sign says can become markup. Web
 * links are re-checked (isSafeSignUrl) before they get an href.
 */
export function SignView({
	doc,
	fallbackTitle,
	world,
	onFollow,
}: SignViewProps): React.ReactElement {
	useSignStyles();
	return (
		<div className="cabn-sign-view">
			<div className="cabn-sign-title" data-testid="sign-title">
				{doc.title ?? fallbackTitle}
			</div>
			{doc.blocks.length === 0 && (
				<p className="cabn-sign-empty">This sign is blank.</p>
			)}
			{doc.blocks.map((block, i) =>
				block.kind === "paragraph" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks are re-derived from the text and never reordered
					<p key={i}>
						<Inlines nodes={block.inlines} world={world} onFollow={onFollow} />
					</p>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: as above
					<ul key={i}>
						{block.items.map((item, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: as above
							<li key={j}>
								<Inlines nodes={item} world={world} onFollow={onFollow} />
							</li>
						))}
					</ul>
				),
			)}
		</div>
	);
}

function Inlines({
	nodes,
	world,
	onFollow,
}: {
	nodes: SeynInline[];
	world: SignLinkWorld;
	onFollow?: (target: SeynLinkTarget) => void;
}): React.ReactElement {
	return (
		<>
			{nodes.map((node, i) => {
				if (node.kind === "text") return node.text;
				if (node.kind === "em")
					// biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
					return <em key={i}>{node.text}</em>;
				return (
					<SignLink
						// biome-ignore lint/suspicious/noArrayIndexKey: as above
						key={i}
						label={node.label}
						target={node.target}
						world={world}
						onFollow={onFollow}
					/>
				);
			})}
		</>
	);
}

function SignLink({
	label,
	target,
	world,
	onFollow,
}: {
	label: string;
	target: SeynLinkTarget;
	world: SignLinkWorld;
	onFollow?: (target: SeynLinkTarget) => void;
}): React.ReactElement {
	const resolved = resolveSignLink(target, world);
	if (!resolved || (resolved.kind === "url" && !isSafeSignUrl(resolved.url))) {
		const why = target.kind === "invalid" ? target.reason : "not in this world";
		return (
			<span
				className="cabn-sign-link broken"
				title={why}
				data-link-state="broken"
			>
				{label}
			</span>
		);
	}
	if (!onFollow)
		return (
			<span className="cabn-sign-link inert" data-link-kind={resolved.kind}>
				{label}
				{resolved.kind === "url" ? " ↗" : ""}
			</span>
		);
	if (resolved.kind === "url")
		return (
			<a
				className="cabn-sign-link external"
				href={resolved.url}
				target="_blank"
				rel="noopener noreferrer"
				data-link-kind="url"
			>
				{label} ↗
			</a>
		);
	return (
		<button
			type="button"
			className="cabn-sign-link"
			data-link-kind={resolved.kind}
			onClick={(e) => {
				e.currentTarget.blur();
				onFollow(target);
			}}
		>
			{label}
		</button>
	);
}

// Own <style> element, same reasoning and scoping as guideDialogStyles.ts:
// everything under .cabn-pixel-root and only --cabn-* tokens, so day/night
// follows the theme with no code here.
const STYLE_ELEMENT_ID = "cabn-sign-style";

const SIGN_CSS = `
.cabn-pixel-root .cabn-sign-view { font-size: 14px; line-height: 1.55; color: var(--cabn-text); overflow-wrap: anywhere; }
.cabn-pixel-root .cabn-sign-title { font-size: 16px; margin: 0 0 8px; color: var(--cabn-border-outer); }
.cabn-pixel-root .cabn-sign-view p { margin: 0 0 8px; }
.cabn-pixel-root .cabn-sign-view ul { margin: 0 0 8px; padding-left: 20px; }
.cabn-pixel-root .cabn-sign-view li { margin: 2px 0; }
.cabn-pixel-root .cabn-sign-view em { font-style: normal; color: var(--cabn-accent-orange); }
.cabn-pixel-root .cabn-sign-empty { color: var(--cabn-text-secondary); font-style: italic; }
.cabn-pixel-root .cabn-sign-link {
	font: inherit; color: var(--cabn-syntax-function); background: none; border: none; padding: 0;
	text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: pointer;
}
.cabn-pixel-root .cabn-sign-link.inert { cursor: inherit; }
.cabn-pixel-root .cabn-sign-link.broken { color: var(--cabn-text-secondary); text-decoration-style: dashed; cursor: help; }
.cabn-pixel-root .cabn-sign-backdrop { position: absolute; inset: 0; z-index: 9; pointer-events: auto; background: rgba(0,0,0,0.25); }
.cabn-pixel-root .cabn-sign-popup {
	position: absolute; left: 16px; top: 50%; transform: translateY(-50%); z-index: 6;
	width: min(360px, 40vw); max-height: 52vh; overflow: hidden; box-sizing: border-box;
	pointer-events: auto; cursor: pointer; animation: cabn-fade-in 140ms ease-out both;
}
.cabn-pixel-root .cabn-sign-popup .cabn-sign-body { max-height: calc(52vh - 72px); overflow: hidden;
	-webkit-mask-image: linear-gradient(to bottom, #000 75%, transparent); mask-image: linear-gradient(to bottom, #000 75%, transparent); }
.cabn-pixel-root .cabn-sign-hint { font-size: 11px; color: var(--cabn-text-secondary); margin-top: 6px; }
.cabn-pixel-root .cabn-sign-reader {
	position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
	width: min(560px, calc(100% - 32px)); max-height: min(640px, calc(100% - 140px)); box-sizing: border-box;
	display: flex; flex-direction: column; animation: cabn-fade-in 140ms ease-out both;
}
.cabn-pixel-root .cabn-sign-reader .cabn-sign-body { overflow: auto; flex: 1; min-height: 0; padding-right: 4px; }
.cabn-pixel-root .cabn-sign-path { font-family: var(--cabn-font-mono); font-size: 11px; color: var(--cabn-text-secondary); margin: -4px 0 8px; }
.cabn-pixel-root .cabn-sign-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 10px; align-items: center; }
.cabn-pixel-root .cabn-sign-actions .cabn-sign-confirm { font-size: 12px; margin-right: auto; }
.cabn-pixel-root .cabn-sign-error { color: var(--cabn-accent-pink); font-size: 12px; margin-right: auto; }
.cabn-pixel-root .cabn-sign-banner {
	position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 7;
	padding: 8px 16px; font-size: 13px; pointer-events: auto; max-width: calc(100% - 32px); box-sizing: border-box; text-align: center;
}
.cabn-pixel-root .cabn-sign-editor {
	position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
	width: min(920px, calc(100% - 32px)); max-height: calc(100% - 120px); box-sizing: border-box;
	display: flex; flex-direction: column; animation: cabn-fade-in 140ms ease-out both;
}
.cabn-pixel-root .cabn-sign-editor-cols { display: flex; gap: 14px; min-height: 0; flex: 1; }
.cabn-pixel-root .cabn-sign-editor-cols > * { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
@media (max-width: 640px) { .cabn-pixel-root .cabn-sign-editor-cols { flex-direction: column; overflow: auto; } }
.cabn-pixel-root .cabn-sign-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; margin-bottom: 8px; }
.cabn-pixel-root .cabn-sign-field-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.cabn-pixel-root .cabn-sign-field input, .cabn-pixel-root .cabn-sign-field select, .cabn-pixel-root .cabn-sign-field textarea {
	font-family: var(--cabn-font-mono); font-size: 13px; color: var(--cabn-text); background: var(--cabn-panel-body-alt);
	border: 3px solid var(--cabn-border-outer); border-radius: 8px; padding: 5px 7px; box-sizing: border-box; width: 100%;
}
.cabn-pixel-root .cabn-sign-field input[type="number"] { width: 90px; }
.cabn-pixel-root .cabn-sign-field textarea { min-height: 220px; flex: 1; resize: vertical; line-height: 1.45; }
.cabn-pixel-root .cabn-sign-cheat { font-family: var(--cabn-font-mono); font-size: 11px; color: var(--cabn-text-secondary); }
.cabn-pixel-root .cabn-sign-preview { overflow: auto; background: var(--cabn-panel-body-alt); border: 3px dashed var(--cabn-border-outer); border-radius: 10px; padding: 10px; flex: 1; min-height: 160px; }
.cabn-pixel-root .cabn-sign-warnings { font-size: 11px; color: var(--cabn-accent-orange); margin: 6px 0 0; padding-left: 16px; }
`;

export function useSignStyles(): void {
	useEffect(() => {
		if (document.getElementById(STYLE_ELEMENT_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ELEMENT_ID;
		style.textContent = SIGN_CSS;
		document.head.appendChild(style);
	}, []);
}
