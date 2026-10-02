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
import type { PropName, SceneryName, SkylinePiece } from "../assetPaths.js";
import type { GlowParams } from "../fx/glowParams.js";
import type { PixelThemeTokens } from "../react/pixelThemeTokens.js";
import type { WorldSearchIndex } from "../react/useWorldSearchIndex.js";
import { largestAngularGapMidpoint } from "./angularGap.js";
import type { OwnerSignSaveRequest } from "./ownerSigns.js";
import {
	resolveTimeOfDay,
	type TimeOfDay,
	type TimeOfDayOverride,
} from "./timeOfDay.js";
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
 * A texture a skin brings along. WorldScene loads it in its own preload
 * (never through assetPaths.ts or PreloadScene), so a hosted build's asset
 * list names no layer art at all.
 */
export interface SkinImage {
	key: string;
	path: string;
}

export interface SkinSheet extends SkinImage {
	frameWidth: number;
	frameHeight: number;
	frames: number;
}

/** An animated sheet: every frame in order, looping. */
export interface SkinStrip extends SkinSheet {
	frameRate: number;
}

/** The path ribbon's three stamp kinds (render/pathBaker.ts bakePathRibbons). */
export interface SkinPathTextures {
	edge: SkinImage;
	bed: SkinImage;
	cobbles: readonly SkinImage[];
	/** Share of the ribbon's cobble spots that get a stone (0..1]; the rest show the bed. */
	cobbleFraction: number;
}

/** Scenery kinds a skin may redraw; each replacement must match the original's pixel size, so edge-scenery placement never changes. */
export type SkinSceneryKind = SceneryName;

/**
 * A monster species as a skin redraws it: the same frame count and size as
 * its normal art (one idle frame for a static species, two for the rest),
 * so a sprite fitted once never jumps when its texture swaps.
 */
export interface SkinMonster {
	idle: readonly SkinImage[];
	hit: SkinImage;
	defeat: readonly SkinImage[];
}

/** World-wide ambient particles that replace the day motes and night fireflies. */
export interface SkinAmbientParticles {
	/** Flakes drifting down, picked at random from the sheet's frames. */
	ash: {
		texture: SkinSheet;
		tint: number;
		frequencyMs: number;
		alpha: number;
	};
	/** Sparks rising from anywhere in the world, additive. */
	embers: {
		texture: SkinImage;
		colors: readonly number[];
		frequencyMs: number;
	};
}

/** Night light pools laid along every path, `spacingPx` apart (render/lightPools.ts). */
export interface SkinPathGlow {
	spacingPx: number;
	radiusPx: number;
	color: number;
	alpha: number;
	flicker: boolean;
	/** Cap on pools for a whole world, so a sprawling path network stays cheap. */
	maxPools: number;
}

/**
 * Colours and keys a layer swaps into the world renderer while it is
 * active. Every field is optional in effect: null keeps today's look, so
 * DEFAULT_SKIN (all null) reproduces the unskinned world exactly — each
 * render hook only changes anything when handed a non-null value.
 */
export interface WorldSkin {
	id: string;
	/** Pins the layer to one time of day: the player's Auto/Day/Night choice and the clock are ignored while it shows. */
	fixedTimeOfDay: TimeOfDay | null;
	/** Share (0..1) of the skin's own warm lights (path glow, braziers) still lit at full day, so they glow in a pinned day. */
	dayGlowStrength: number | null;
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
	/** Around and below the file view's page (and so behind the spellbook), in place of the game's meadow green. */
	backdrop: number | null;
	/** The HUD palette while the layer is active (react/pixelTheme.tsx). */
	uiTokens: PixelThemeTokens | null;
	/** Colour of the "layer" scene transition. */
	transitionColor: number | null;
	/** Tile sheet (meadow_tiles layout) for the continuous ground field. */
	fieldTiles: SkinSheet | null;
	/** Tile sheet (same layout) for every clearing, whatever its biome. */
	clearingTiles: SkinSheet | null;
	/** Clearing decals (decals layout: 24px frames, 0 and 1 ring the clearing's edge). */
	decals: SkinSheet | null;
	pathTextures: SkinPathTextures | null;
	/** Replaces both the day and the night sky gradient. */
	sky: SkinImage | null;
	/** The portal arch strip (portal_arch_strip layout and timing) plus an overlay pulsing over it. */
	arch: { strip: SkinStrip; overlay: SkinStrip } | null;
	/** Stands in for the fountain in the layer's own clusters, and for the bonfire (world_fountain_strip layout). */
	brazier: SkinStrip | null;
	scenery: Partial<Record<SkinSceneryKind, SkinImage>> | null;
	/** Clearing props the skin redraws (same pixel size as the originals). */
	props: Partial<Record<PropName, SkinImage>> | null;
	/** Day art for skyline pieces, same pixel size as the originals so the horizon lays out the same. */
	skyline: Partial<Record<SkylinePiece, SkinImage>> | null;
	/** Monster art by species slug (assetPaths' species keys), used in the world and the file view while the layer shows. */
	monsters: Partial<Record<string, SkinMonster>> | null;
	/** Scenery kinds that hold still under this skin (the windmill's sails stop turning). */
	stillScenery: readonly SkinSceneryKind[] | null;
	/** HUD icon replacements: normal icon URL (assetPaths' uiIconPath/uiToolIconPath) -> the skin's URL. */
	uiIcons: Readonly<Record<string, string>> | null;
	/** Multiply tint on edge scenery, props and skyline pieces the skin doesn't redraw. */
	scatterTint: number | null;
	ambient: SkinAmbientParticles | null;
	pathGlow: SkinPathGlow | null;
	/** A tiling texture for the file view's parchment (drawn over parchmentTint). */
	parchment: SkinImage | null;
}

/** Marks a layer's entries (map, search badge) when its skin names no UI palette. */
export const LAYER_FALLBACK_COLOR = 0xc8323c;

export const DEFAULT_SKIN: WorldSkin = {
	id: "default",
	fixedTimeOfDay: null,
	dayGlowStrength: null,
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
	backdrop: null,
	uiTokens: null,
	transitionColor: null,
	fieldTiles: null,
	clearingTiles: null,
	decals: null,
	pathTextures: null,
	sky: null,
	arch: null,
	brazier: null,
	scenery: null,
	props: null,
	skyline: null,
	monsters: null,
	stillScenery: null,
	uiIcons: null,
	scatterTint: null,
	ambient: null,
	pathGlow: null,
	parchment: null,
};

/** Every texture a skin names, each once (the load list for WorldScene's preload). */
export function skinTextures(skin: WorldSkin): (SkinImage | SkinSheet)[] {
	const out: (SkinImage | SkinSheet)[] = [];
	const add = (t: SkinImage | SkinSheet | null | undefined): void => {
		if (t && !out.some((o) => o.key === t.key)) out.push(t);
	};
	add(skin.fieldTiles);
	add(skin.clearingTiles);
	add(skin.decals);
	add(skin.pathTextures?.edge);
	add(skin.pathTextures?.bed);
	for (const c of skin.pathTextures?.cobbles ?? []) add(c);
	add(skin.sky);
	add(skin.arch?.strip);
	add(skin.arch?.overlay);
	add(skin.brazier);
	for (const t of Object.values(skin.scenery ?? {})) add(t);
	for (const t of Object.values(skin.props ?? {})) add(t);
	for (const t of Object.values(skin.skyline ?? {})) add(t);
	for (const m of Object.values(skin.monsters ?? {}))
		for (const t of skinMonsterTextures(m)) add(t);
	add(skin.ambient?.ash.texture);
	add(skin.ambient?.embers.texture);
	add(skin.parchment);
	return out;
}

/**
 * The skin as it can actually be drawn: any texture group with a piece
 * that failed to load (`loaded(key)` false) falls back to today's look,
 * never half-skinned. DEFAULT_SKIN comes back as the same object.
 */
export function resolveSkin(
	skin: WorldSkin,
	loaded: (key: string) => boolean,
): WorldSkin {
	if (skinTextures(skin).every((t) => loaded(t.key))) return skin;
	const ok = (t: SkinImage | null | undefined): boolean =>
		t !== null && t !== undefined && loaded(t.key);
	const path = skin.pathTextures;
	const loadedOnly = <K extends string>(
		map: Partial<Record<K, SkinImage>> | null,
	): Partial<Record<K, SkinImage>> | null =>
		map
			? (Object.fromEntries(
					Object.entries<SkinImage | undefined>(map).filter(([, t]) => ok(t)),
				) as Partial<Record<K, SkinImage>>)
			: null;
	return {
		...skin,
		fieldTiles: ok(skin.fieldTiles) ? skin.fieldTiles : null,
		clearingTiles: ok(skin.clearingTiles) ? skin.clearingTiles : null,
		decals: ok(skin.decals) ? skin.decals : null,
		pathTextures:
			path && ok(path.edge) && ok(path.bed) && path.cobbles.every(ok)
				? path
				: null,
		sky: ok(skin.sky) ? skin.sky : null,
		arch:
			skin.arch && ok(skin.arch.strip) && ok(skin.arch.overlay)
				? skin.arch
				: null,
		brazier: ok(skin.brazier) ? skin.brazier : null,
		scenery: loadedOnly(skin.scenery),
		props: loadedOnly(skin.props),
		skyline: loadedOnly(skin.skyline),
		monsters: skin.monsters
			? Object.fromEntries(
					Object.entries(skin.monsters).filter(
						([, m]) => m && skinMonsterTextures(m).every(ok),
					),
				)
			: null,
		ambient:
			skin.ambient &&
			ok(skin.ambient.ash.texture) &&
			ok(skin.ambient.embers.texture)
				? skin.ambient
				: null,
		parchment: ok(skin.parchment) ? skin.parchment : null,
	};
}

/**
 * The time of day a scene shows: the skin's pin when it has one, else the
 * player's choice resolved against the clock. No skin, or DEFAULT_SKIN, is
 * exactly resolveTimeOfDay.
 */
export function resolveSkinTimeOfDay(
	skin: Pick<WorldSkin, "fixedTimeOfDay"> | null,
	override: TimeOfDayOverride,
	now: Date = new Date(),
): TimeOfDay {
	return skin?.fixedTimeOfDay ?? resolveTimeOfDay(override, now);
}

function skinMonsterTextures(m: SkinMonster | undefined): SkinImage[] {
	return m ? [...m.idle, m.hit, ...m.defeat] : [];
}

/** Animation keys for a skin's monster, registered once per game by WorldScene (idle only when it has two or more frames). */
export function skinMonsterAnims(m: SkinMonster): {
	idle: string | null;
	hit: string;
	defeat: string;
} {
	const first = m.idle[0]?.key ?? m.hit.key;
	return {
		idle: m.idle.length > 1 ? `${first}:idle` : null,
		hit: `${m.hit.key}:hit`,
		defeat: `${first}:defeat`,
	};
}

/** Animation key for a skin strip, registered once per game by WorldScene. */
export function skinAnimKey(strip: SkinStrip): string {
	return `${strip.key}:loop`;
}

/** Evenly spaced points along a polyline (both ends included when it has length), for lights laid along paths. */
export function pointsAlongPolyline(
	points: readonly Position[],
	spacingPx: number,
): Position[] {
	const out: Position[] = [];
	let carry = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (!a || !b) continue;
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (len === 0) continue;
		let d = carry;
		while (d <= len) {
			out.push({
				x: a.x + ((b.x - a.x) * d) / len,
				y: a.y + ((b.y - a.y) * d) / len,
			});
			d += spacingPx;
		}
		carry = d - len;
	}
	return out;
}

/** The point halfway along a polyline by length, and the heading of the segment it falls on. */
export function polylineMidpoint(points: readonly Position[]): {
	center: Position;
	angle: number;
} {
	const first = points[0] ?? { x: 0, y: 0 };
	const last = points[points.length - 1] ?? first;
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
	}
	let remaining = total / 2;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (!a || !b) continue;
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (len > 0 && remaining <= len) {
			return {
				center: {
					x: a.x + ((b.x - a.x) * remaining) / len,
					y: a.y + ((b.y - a.y) * remaining) / len,
				},
				angle: Math.atan2(b.y - a.y, b.x - a.x),
			};
		}
		remaining -= len;
	}
	return {
		center: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
		angle: Math.atan2(last.y - first.y, last.x - first.x),
	};
}

export type WorldLayerSaveResult =
	| { ok: true; sha256: string }
	| { ok: false; conflict: boolean; message: string };

/** A layer's toolkit entry: a tool without a hotkey of its own. */
export type LayerTool = Omit<Tool, "hotkey"> & {
	/** Shown when `icon` fails to load: a layer's own art can be absent (owner-served, optional package). */
	fallbackIcon?: string;
};

export interface WorldLayerProvider {
	id: string;
	/** Short badge text for the layer's entries in search results. */
	label: string;
	/** Entries the layer adds to the owner's toolkit (world mode only), reached through the toolkit's one key. */
	tools: readonly LayerTool[];
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
	/**
	 * While shown, the layer replaces the base world's contents instead of
	 * adding to them: base portals, their monsters, the base path monsters and
	 * the base signs all go (mergeLayer), and search and the pet see none of
	 * the base files. Base clearings, fountains and paths stay as the layer's
	 * skeleton, laid out exactly as without it. Absent means false.
	 */
	exclusive?: boolean;
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
	/** The layer hides the base world's portals, monsters and signs (WorldLayerProvider.exclusive). */
	exclusive: boolean;
	/** Base clusters an exclusive layer leaves with nothing to show (emptyBaseClusters); always empty otherwise. */
	emptyClusterIds: ReadonlySet<string>;
}

export interface MergeOptions {
	exclusive?: boolean;
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
 *
 * An exclusive layer drops every base portal and base monster from the
 * view. Base clusters keep their `portalIds` all the same: those name the
 * arch spots the ring layout reserves, so clearings keep their size, paths
 * their gates and scenery its place, and a consumer that shows portals has
 * to look each id up in `portals` (the hidden ones aren't there).
 */
export function mergeLayer(
	base: WorldManifest,
	delta: WorldLayerManifest,
	options: MergeOptions = {},
): MergedWorld {
	assertWorldLayerFits(base, delta);
	const exclusive = options.exclusive === true;
	const layerMonsters = [...delta.monsters, ...delta.extendedMonsters];
	const manifest: WorldManifest = {
		...base,
		clusters: [...base.clusters, ...delta.clusters],
		portals: exclusive
			? [...delta.portals]
			: [...base.portals, ...delta.portals],
		paths: [...base.paths, ...delta.paths],
		monsters: exclusive ? layerMonsters : [...base.monsters, ...layerMonsters],
	};
	const layer: LayerIds = {
		clusterIds: new Set(delta.clusters.map((c) => c.id)),
		portalIds: new Set(delta.portals.map((p) => p.id)),
		pathIds: new Set(delta.paths.map(worldPathId)),
		monsterIds: new Set(layerMonsters.map((m) => m.id)),
		signPaths: new Set(delta.signs.map((s) => s.path)),
	};
	return {
		exclusive,
		manifest,
		layer,
		emptyClusterIds: exclusive
			? emptyBaseClusters(manifest, layer)
			: new Set<string>(),
	};
}

/**
 * Base clusters with nothing left to show in a merged view: no portal of
 * theirs in it and no layer path leaving them. Base paths don't count —
 * they only pass through on the way to somewhere else.
 */
export function emptyBaseClusters(
	manifest: Pick<WorldManifest, "clusters" | "portals" | "paths">,
	layer: Pick<LayerIds, "clusterIds" | "pathIds">,
): Set<string> {
	const busy = new Set(manifest.portals.map((p) => p.clusterId));
	for (const path of manifest.paths) {
		if (!layer.pathIds.has(worldPathId(path))) continue;
		busy.add(path.from);
		busy.add(path.to);
	}
	return new Set(
		manifest.clusters
			.filter((c) => !layer.clusterIds.has(c.id) && !busy.has(c.id))
			.map((c) => c.id),
	);
}

/** An empty clearing's drawn ground: a patch just big enough for its fountain or bonfire. */
export const EMPTY_CLEARING_PATCH = { x: 110, y: 80 } as const;

/**
 * The ground a clearing draws (tiles, flower ring, decals, props). Only an
 * empty one shrinks, to a patch around its centre; its layout (arch spots,
 * path gates, scenery keepouts) keeps the full size either way.
 */
export function drawnClearingRadii(
	full: { x: number; y: number },
	empty: boolean,
): { x: number; y: number } {
	return empty
		? {
				x: Math.min(full.x, EMPTY_CLEARING_PATCH.x),
				y: Math.min(full.y, EMPTY_CLEARING_PATCH.y),
			}
		: full;
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

/**
 * Which signs a world shows: all of them, or, while an exclusive layer hides
 * the base world's, only the layer's own — its manifest's signs plus any
 * hidden-folder sign written since (the same ownership rule as signWriterFor).
 */
export function signShown(
	sign: Pick<SignEntry, "path">,
	layer: Pick<LayerIds, "signPaths"> | null,
	exclusive: boolean,
): boolean {
	return (
		!exclusive ||
		isHiddenPath(sign.path) ||
		(layer?.signPaths.has(sign.path) ?? false)
	);
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
