/**
 * A world layer: extra clusters, portals, paths, monsters and signs a host
 * can lay over the base world and take away again (world-schema's layer.ts
 * is the data format). The main engine knows only this neutral shape — what
 * a layer means, where its data comes from and how it is authenticated all
 * live in the provider a host page hands CabnGame (`owner.layers`), so a
 * hosted build carries the seam but never any layer's data, names or art.
 */
import {
	assertWorldLayerFits,
	type Cluster,
	type Position,
	type SignEntry,
	type WorldChunk,
	type WorldLayerManifest,
	type WorldManifest,
	type WorldPath,
} from "@cabn/world-schema";
import type { GlowParams } from "../fx/glowParams.js";
import type { PixelThemeTokens } from "../react/pixelThemeTokens.js";
import type { WorldSearchIndex } from "../react/useWorldSearchIndex.js";
import { largestAngularGapMidpoint } from "./angularGap.js";
import type { OwnerSignSaveRequest } from "./ownerSigns.js";
import type { Tool } from "./tools.js";

/** Ambient particle colours (render/effects.ts), as data so a skin can swap them. */
export interface WorldParticleSkin {
	firefly: number;
	mote: number;
	embers: readonly number[];
	smoke: number;
	/** The burst a layer's objects kick up as they rise or sink. */
	dust: number;
}

/**
 * Colours and keys a layer swaps into the world renderer while it is
 * active. Every field is optional in effect: null keeps today's look, so
 * DEFAULT_SKIN (all null) reproduces the unskinned world exactly — each
 * render hook only changes anything when handed a non-null value.
 */
export interface WorldSkin {
	id: string;
	/** Multiply grade colour at full day / full night (render/atmosphere.ts). */
	grade: { day: number; night: number } | null;
	/** The normal-blend wash over the grade; alpha is lerped by the day/night blend. */
	wash: { color: number; dayAlpha: number; nightAlpha: number } | null;
	skylineTint: number | null;
	/** Multiply tint on the baked ground field and clearings. */
	groundTint: number | null;
	pathTint: number | null;
	/** Replaces the warm gold of lamp, window and bonfire light pools. */
	lightColor: number | null;
	/** Multiply tint on every arch and its type trim, and the colour of its plaque glow. */
	archTint: number | null;
	particles: WorldParticleSkin | null;
	glow: { day: GlowParams; night: GlowParams } | null;
	/** The file view's parchment. */
	parchmentTint: number | null;
	/** The HUD palette while the layer is active (react/pixelTheme.tsx). */
	uiTokens: PixelThemeTokens | null;
	/** Colour of the "layer" scene transition. */
	transitionColor: number | null;
}

/** Marks a layer's entries (map, search badge) when its skin names no UI palette. */
export const LAYER_FALLBACK_COLOR = 0xc8323c;

export const DEFAULT_SKIN: WorldSkin = {
	id: "default",
	grade: null,
	wash: null,
	skylineTint: null,
	groundTint: null,
	pathTint: null,
	lightColor: null,
	archTint: null,
	particles: null,
	glow: null,
	parchmentTint: null,
	uiTokens: null,
	transitionColor: null,
};

export type WorldLayerSaveResult =
	| { ok: true; sha256: string }
	| { ok: false; conflict: boolean; message: string };

export interface WorldLayerProvider {
	id: string;
	/** Short badge text for the layer's entries in search results. */
	label: string;
	/** Entries the layer adds to the owner's toolkit (world mode only). Their own `hotkey` is never bound: the toolkit's one key reaches them. */
	tools: readonly Tool[];
	/** The layer without contents; fetched afresh every time the layer is entered. */
	load(): Promise<WorldLayerManifest>;
	fetchChunk(clusterId: string): Promise<WorldChunk>;
	searchIndex(): Promise<WorldSearchIndex>;
	/** Writes one layer text file wherever the layer lives. Never touches the browser's save. */
	saveFile(
		path: string,
		content: string,
		baseSha256: string,
	): Promise<WorldLayerSaveResult>;
	saveSign(request: OwnerSignSaveRequest): Promise<SignEntry>;
	removeSign(path: string): Promise<void>;
	skin: WorldSkin;
}

/** What WorldScene is handed when it (re)starts with a layer on. */
export interface ActiveWorldLayer {
	provider: WorldLayerProvider;
	manifest: WorldLayerManifest;
}

export interface LayerIds {
	clusterIds: ReadonlySet<string>;
	portalIds: ReadonlySet<string>;
	pathIds: ReadonlySet<string>;
	monsterIds: ReadonlySet<string>;
	signPaths: ReadonlySet<string>;
}

export interface MergedWorld {
	manifest: WorldManifest;
	layer: LayerIds;
}

export function worldPathId(path: Pick<WorldPath, "from" | "to">): string {
	return `${path.from}::${path.to}`;
}

/**
 * Base ∪ layer, after checking the layer fits this exact base (throws
 * WorldLayerMismatchError otherwise). Base entries keep their order and
 * come first; nothing in the base is changed or moved. Layer monsters from
 * both of the layer's lists join `monsters`, the same merge BootScene does
 * for monsters.json.
 */
export function mergeLayer(
	base: WorldManifest,
	delta: WorldLayerManifest,
): MergedWorld {
	assertWorldLayerFits(base, delta);
	const layerMonsters = [...delta.monsters, ...delta.extendedMonsters];
	return {
		manifest: {
			...base,
			clusters: [...base.clusters, ...delta.clusters],
			portals: [...base.portals, ...delta.portals],
			paths: [...base.paths, ...delta.paths],
			monsters: [...base.monsters, ...layerMonsters],
		},
		layer: {
			clusterIds: new Set(delta.clusters.map((c) => c.id)),
			portalIds: new Set(delta.portals.map((p) => p.id)),
			pathIds: new Set(delta.paths.map(worldPathId)),
			monsterIds: new Set(layerMonsters.map((m) => m.id)),
			signPaths: new Set(delta.signs.map((s) => s.path)),
		},
	};
}

/**
 * The paths that claim a gate in a cluster's portal ring. A base cluster's
 * ring only ever sees base paths, so turning a layer on never moves a base
 * arch; a layer path leaves a base cluster through an existing gap instead
 * (layerPathRoutes). A layer cluster's ring gates all of its paths.
 */
export function ringPathsFor(
	manifest: Pick<WorldManifest, "paths">,
	clusterId: string,
	layer: LayerIds | null,
): WorldPath[] {
	const isLayerCluster = layer?.clusterIds.has(clusterId) ?? false;
	return manifest.paths.filter(
		(p) =>
			(p.from === clusterId || p.to === clusterId) &&
			(isLayerCluster || !layer?.pathIds.has(worldPathId(p))),
	);
}

export interface RingGeometry {
	radius: number;
	/** Angles (radians) of the arches on the ring. */
	archAngles: readonly number[];
}

/** How far past the arch ring a layer path's bend sits, so it clears the arches' feet. */
export const LAYER_PATH_GATE_OUT_PX = 110;

/**
 * Polylines for the layer paths that touch a base cluster: out from the
 * base hub along the middle of its widest free gap (between arches and the
 * base paths' own gates), bending just past the ring towards the layer
 * cluster. Several layer paths from one hub take successive widest gaps.
 * Paths between two layer clusters are left out (drawn straight).
 */
export function layerPathRoutes(
	manifest: Pick<WorldManifest, "clusters" | "paths">,
	layer: LayerIds,
	ring: (clusterId: string) => RingGeometry | undefined,
): Map<string, Position[]> {
	const clusters = new Map<string, Cluster>(
		manifest.clusters.map((c) => [c.id, c]),
	);
	const byHub = new Map<string, WorldPath[]>();
	for (const path of manifest.paths) {
		if (!layer.pathIds.has(worldPathId(path))) continue;
		const hubId = !layer.clusterIds.has(path.from)
			? path.from
			: !layer.clusterIds.has(path.to)
				? path.to
				: null;
		if (!hubId) continue;
		const list = byHub.get(hubId) ?? [];
		list.push(path);
		byHub.set(hubId, list);
	}
	const routes = new Map<string, Position[]>();
	for (const [hubId, paths] of byHub) {
		const hub = clusters.get(hubId);
		const geometry = ring(hubId);
		if (!hub || !geometry) continue;
		const occupied = [...geometry.archAngles];
		for (const path of ringPathsFor(manifest, hubId, layer)) {
			const other = clusters.get(path.from === hubId ? path.to : path.from);
			if (other)
				occupied.push(
					Math.atan2(other.pos.y - hub.pos.y, other.pos.x - hub.pos.x),
				);
		}
		const ordered = [...paths].sort((a, b) =>
			worldPathId(a) < worldPathId(b) ? -1 : 1,
		);
		for (const path of ordered) {
			const far = clusters.get(path.from === hubId ? path.to : path.from);
			if (!far) continue;
			const angle = largestAngularGapMidpoint(occupied);
			occupied.push(angle);
			const out = geometry.radius + LAYER_PATH_GATE_OUT_PX;
			const bend = {
				x: hub.pos.x + Math.cos(angle) * out,
				y: hub.pos.y + Math.sin(angle) * out,
			};
			const points =
				path.from === hubId
					? [{ ...hub.pos }, bend, { ...far.pos }]
					: [{ ...far.pos }, bend, { ...hub.pos }];
			routes.set(worldPathId(path), points);
		}
	}
	return routes;
}

/** The world's save slot's sibling, for a layer's own visited clusters and defeated monsters. */
export function layerSaveSlotId(worldId: string, layerId: string): string {
	return `${worldId}#${layerId}`;
}

/**
 * Where an editor save goes: a layer file is written by its provider, never
 * into the browser's save (`fileOverrides`) — only base files get an
 * override.
 */
export function editorSaveTarget(
	portalId: string,
	layer: Pick<LayerIds, "portalIds"> | null,
): "override" | "layer" {
	return layer?.portalIds.has(portalId) ? "layer" : "override";
}

/** Any segment starting with `.` — the same rule as the converter's walk.ts. */
export function isHiddenPath(path: string): boolean {
	return path.split("/").some((s) => s.startsWith("."));
}

export interface SignWriter {
	save(request: OwnerSignSaveRequest): Promise<SignEntry>;
	remove(path: string): Promise<void>;
}

/**
 * Who writes a sign at `path`: a hidden folder's sign belongs to the active
 * layer (and only while one is showing), every other sign to the owner's
 * normal sign API. Null when neither applies.
 */
export function signWriterFor(
	state: {
		ownerSigns: SignWriter | null;
		worldLayers: readonly WorldLayerProvider[];
		activeLayerId: string | null;
	},
	path: string,
): SignWriter | null {
	if (!isHiddenPath(path)) return state.ownerSigns;
	const layer = state.worldLayers.find((l) => l.id === state.activeLayerId);
	if (!layer || !state.ownerSigns) return null;
	return {
		save: (request) => layer.saveSign(request),
		remove: (p) => layer.removeSign(p),
	};
}

/** Clearings a layer's objects belong to, for picking them out of the scene after it's built. */
export interface LayerClearing {
	x: number;
	y: number;
	radius: number;
}

export function inLayerClearing(
	point: Position,
	clearings: readonly LayerClearing[],
): boolean {
	return clearings.some(
		(c) => Math.hypot(point.x - c.x, point.y - c.y) <= c.radius,
	);
}
