import { uiIconPath } from "../assetPaths.js";
import type { Tool, ToolContext } from "./tools.js";
import type { LayerTool, WorldLayerProvider } from "./worldLayer.js";

/**
 * The one owner key (2026-09-29: "there should be 1 singular owner key for
 * everything"). It replaced the sign item's P and the layer items' own keys,
 * one of which (H) collided with the pensieve.
 */
export const OWNER_TOOLKIT_HOTKEY = "O";

export type OwnerGitAction = "commit" | "switch" | "branch";

export interface OwnerToolkitEntry {
	id: string;
	label: string;
	/** A second, quieter line (what it does, or which layer tool it is). */
	detail: string;
	icon: string | null;
	/** Rows under the same heading are drawn as one group. */
	group: string | null;
	/** Shows an "on" pip: placing a sign, or the entry's layer showing. */
	active: boolean;
	run(ctx: ToolContext): void;
}

/**
 * What the owner capability offers, as the store and CabnGame see it. The
 * main engine only knows these neutral facts; a layer's own name, icon and
 * action come from its provider's tools.
 */
export interface OwnerToolkitSources {
	signs: boolean;
	/** `owner.git` in a world that has git history (the rift's picker needs it). */
	git: boolean;
	layers: readonly WorldLayerProvider[];
	signPlacing: boolean;
	activeLayerId: string | null;
}

const GIT_ENTRIES: readonly {
	action: OwnerGitAction;
	label: string;
	detail: string;
}[] = [
	{ action: "commit", label: "Commit", detail: "your saved edits" },
	{ action: "switch", label: "Switch branch", detail: "real checkout" },
	{ action: "branch", label: "Create branch", detail: "from here" },
];

/** A tool named "Label (what it does)" shows just "what it does" under its label. */
function layerToolDetail(tool: LayerTool): string {
	const label = tool.label ?? tool.name;
	const m = /^(.*) \((.+)\)$/.exec(tool.name);
	return m && m[1] === label ? (m[2] as string) : tool.name;
}

export function ownerToolkitEntries(
	sources: OwnerToolkitSources,
): OwnerToolkitEntry[] {
	const entries: OwnerToolkitEntry[] = [];
	if (sources.signs)
		entries.push({
			id: "sign",
			label: "Place sign",
			detail: "click where it stands",
			icon: uiIconPath("sign"),
			group: null,
			active: sources.signPlacing,
			run: ({ store }) => {
				const state = store.getState();
				state.setSignPlacing(!state.signPlacing);
			},
		});
	for (const layer of sources.layers)
		for (const tool of layer.tools)
			entries.push({
				id: `${layer.id}:${tool.id}`,
				label: tool.label ?? tool.name,
				detail: layerToolDetail(tool),
				icon: tool.icon,
				group: null,
				active: sources.activeLayerId === layer.id,
				run: (ctx) => tool.onUse(ctx),
			});
	if (sources.git)
		for (const git of GIT_ENTRIES)
			entries.push({
				id: `git:${git.action}`,
				label: git.label,
				detail: git.detail,
				icon: null,
				group: "Git",
				active: false,
				run: ({ store }) => store.getState().openOwnerGit(git.action),
			});
	return entries;
}

/** The hotbar's one owner slot; present only while the toolkit has entries. */
export function createOwnerToolkitTool(): Tool {
	return {
		id: "owner",
		label: "Owner",
		name: "Owner's toolkit",
		icon: uiIconPath("owner"),
		hotkey: OWNER_TOOLKIT_HOTKEY,
		onUse: ({ store }) => {
			const state = store.getState();
			state.setOwnerToolkitOpen(!state.ownerToolkitOpen);
		},
	};
}

/** Which row a digit key picks (1-based on the keyboard), or null for none. */
export function digitPick(key: string, count: number): number | null {
	if (!/^[1-9]$/.test(key)) return null;
	const index = Number(key) - 1;
	return index < count ? index : null;
}

/** Arrow movement through the rows, wrapping at both ends. */
export function stepPick(current: number, step: 1 | -1, count: number): number {
	if (count === 0) return 0;
	return (current + step + count) % count;
}
