import type { Position } from "@cabn/world-schema";
import type Phaser from "phaser";
import {
	PATH_BED_DISC_KEY,
	PATH_COBBLE_COUNT,
	PATH_EDGE_DISC_KEY,
	PATH_STAMP_COUNT,
	pathCobbleKey,
	pathStampKey,
} from "../assetPaths.js";
import {
	hashNoise2D,
	hashStringSeed,
	mulberry32,
} from "../systems/deterministicRandom.js";
import { planPathRibbon, type RibbonPlan } from "./pathRibbon.js";
import { stampPointsAlongSegment } from "./pathStamps.js";
import { indexPointsByChunk, WORLD_CHUNK_SIZE_PX } from "./worldChunkGrid.js";

export interface WorldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PathSegment {
	/** Seeds both stamp-variant choice and jitter for this segment — pass a stable id (e.g. `${from}::${to}`), not an array index, so re-ordering `manifest.paths` doesn't reshuffle the art. */
	id: string;
	from: Position;
	to: Position;
}

const STAMP_JITTER_PX = 2;
// Segments abut with a slight overlap (not edge-to-edge exactly) so a seam
// never shows even with the per-point jitter above nudging things sideways.
const STAMP_OVERLAP_RATIO = 0.86;

/**
 * Bakes every path in a world (or the shelf's tower-to-cabin spokes) into one
 * world-bounds-sized `RenderTexture` — same "one GameObject, not thousands of
 * sprites" reasoning as groundBaker.ts, and doubly so here since a path
 * spans clusters rather than sitting inside one.
 *
 * Batch 1 stamped round dirt blobs unrotated (fine — a blob has no facing).
 * Batch 2's cobblestone segments are rectangular strips, so they're drawn via
 * a reusable-per-texture-key throwaway `Image` (never added to the display
 * list — `scene.make.image({key}, false)`), rotated to the segment's own
 * `angle` before each `RenderTexture#draw` call: `draw()` given a Game
 * Object renders it with its *own* transform (rotation/scale/tint) but the
 * call's (x, y) override its position — see Phaser's
 * `DynamicTexture#batchGameObject`, which is the one thing `drawFrame()`
 * (batch 1's tool, frame-index + position only) can't do.
 */
export function bakePaths(
	scene: Phaser.Scene,
	bounds: WorldBounds,
	segments: readonly PathSegment[],
	/** A world skin's multiply tint (systems/worldLayer.ts). */
	tint?: number,
): Phaser.GameObjects.RenderTexture {
	const width = bounds.maxX - bounds.minX;
	const height = bounds.maxY - bounds.minY;
	const rt = scene.add.renderTexture(
		bounds.minX + width / 2,
		bounds.minY + height / 2,
		width,
		height,
	);

	const stampImages = new Map<string, Phaser.GameObjects.Image>();
	const getStampImage = (key: string): Phaser.GameObjects.Image => {
		let image = stampImages.get(key);
		if (!image) {
			image = scene.make.image({ key }, false);
			stampImages.set(key, image);
		}
		return image;
	};
	const stampWidth = (key: string): number =>
		(scene.textures.get(key).getSourceImage() as { width: number }).width;
	const spacing = stampWidth(pathStampKey(0)) * STAMP_OVERLAP_RATIO;

	for (const segment of segments) {
		const seed = hashStringSeed(segment.id);
		const rand = mulberry32(seed);
		const points = stampPointsAlongSegment(segment.from, segment.to, spacing, {
			jitterAmount: STAMP_JITTER_PX,
			jitterSeed: seed,
		});
		for (const point of points) {
			const key = pathStampKey(Math.floor(rand() * PATH_STAMP_COUNT));
			const image = getStampImage(key);
			image.setRotation(point.angle);
			rt.draw(image, point.x - bounds.minX, point.y - bounds.minY);
		}
	}

	for (const image of stampImages.values()) image.destroy();
	if (tint !== undefined) rt.setTint(tint);
	return rt;
}

function textureRadius(scene: Phaser.Scene, key: string): number {
	return (
		(scene.textures.get(key).getSourceImage() as { width: number }).width / 2
	);
}

/**
 * The ribbon baker (render/pathRibbon.ts for why): one world-bounds
 * RenderTexture, three passes over every segment — sand edge discs, mortar
 * bed discs, then cobbles. Replaces bakePaths whenever the atmosphere art set
 * loaded; bakePaths stays as the fallback for a bundle without it.
 */
export function bakePathRibbons(
	scene: Phaser.Scene,
	bounds: WorldBounds,
	segments: readonly PathSegment[],
	tint?: number,
	/** A world skin's ribbon textures (systems/worldLayer.ts SkinPathTextures); omitted, the world's own. */
	keys?: {
		edge: string;
		bed: string;
		cobbles: readonly string[];
		cobbleFraction?: number;
	},
): { rt: Phaser.GameObjects.RenderTexture; plan: RibbonPlan } {
	const width = bounds.maxX - bounds.minX;
	const height = bounds.maxY - bounds.minY;
	const rt = scene.add.renderTexture(
		bounds.minX + width / 2,
		bounds.minY + height / 2,
		width,
		height,
	);
	const edgeKey = keys?.edge ?? PATH_EDGE_DISC_KEY;
	const bedKey = keys?.bed ?? PATH_BED_DISC_KEY;
	const cobbleKeys =
		keys?.cobbles ??
		Array.from({ length: PATH_COBBLE_COUNT }, (_, i) => pathCobbleKey(i));
	const plan = planPathRibbon(segments, {
		edgeRadius: textureRadius(scene, edgeKey),
		bedRadius: textureRadius(scene, bedKey),
		cobbleVariants: cobbleKeys.length,
	});

	const edge = scene.make.image({ key: edgeKey }, false);
	const bed = scene.make.image({ key: bedKey }, false);
	const cobbleImages = cobbleKeys.map((key) =>
		scene.make.image({ key }, false),
	);
	// One open batch for every stamp: a plain rt.draw() per stamp binds and
	// flushes the framebuffer each time, which for a few thousand stamps cost
	// seconds of main-thread stall on scene create.
	rt.beginDraw();
	for (const p of plan.edgeStamps) {
		rt.batchDraw(edge, p.x - bounds.minX, p.y - bounds.minY);
	}
	for (const p of plan.bedStamps) {
		rt.batchDraw(bed, p.x - bounds.minX, p.y - bounds.minY);
	}
	const fraction = keys?.cobbleFraction ?? 1;
	for (const c of plan.cobbles) {
		if (
			fraction < 1 &&
			hashNoise2D(Math.round(c.x), Math.round(c.y), 0x1a7a) >= fraction
		)
			continue;
		const image = cobbleImages[c.variant] ?? cobbleImages[0];
		if (image) rt.batchDraw(image, c.x - bounds.minX, c.y - bounds.minY);
	}
	rt.endDraw();
	edge.destroy();
	bed.destroy();
	for (const image of cobbleImages) image.destroy();
	if (tint !== undefined) rt.setTint(tint);
	return { rt, plan };
}

const PATH_CHUNK_SIZE_PX = WORLD_CHUNK_SIZE_PX;
// Guard against ever allocating a texture bigger than typical GPU
// max-texture-dimension limits (commonly 8192-16384px/side) — every chunked
// bake below only ever requests PATH_CHUNK_SIZE_PX (512) per side, and this
// constant exists so a test can assert that stays true regardless of how far
// a world's bounds (or one long segment) actually spans. See
// pathBaker.test.ts's "never requests an oversized texture" case.
export const MAX_SAFE_RENDER_TEXTURE_PX = 4096;

/**
 * The ribbon plan (render/pathRibbon.ts) plus a spatial index of every stamp
 * by chunk — split from bakePathRibbons so a chunk can be baked on its own,
 * on demand, at streaming time (WorldScene's pathStreamer), instead of one
 * RenderTexture sized to the whole world's bounds. That whole-bounds texture
 * is what made a very spread-out world's path bake hang outright (a 60,000+
 * px-wide world's bounds implies a multi-gigapixel texture request, past any
 * real GPU's max dimension) — chunking bounds every request to
 * PATH_CHUNK_SIZE_PX regardless of world size, the same fix groundField.ts
 * and sceneryBaker.ts already made for their own whole-bounds bakes.
 *
 * Stamp *planning* (planPathRibbon) still runs once, eagerly, over every
 * segment — that cost is proportional to total path length (how many stamps
 * a bake would draw either way), not to world area, so it isn't the scaling
 * bug and doesn't need to be deferred; only the draws (RenderTexture
 * creation + `batchDraw`) stream in per chunk.
 */
export interface PathRibbonChunkPlan {
	plan: RibbonPlan;
	edgeIndex: Map<string, number[]>;
	bedIndex: Map<string, number[]>;
	cobbleIndex: Map<string, number[]>;
	edgeKey: string;
	bedKey: string;
	cobbleKeys: readonly string[];
	cobbleFraction: number;
}

export function planPathRibbonChunks(
	scene: Phaser.Scene,
	segments: readonly PathSegment[],
	keys?: {
		edge: string;
		bed: string;
		cobbles: readonly string[];
		cobbleFraction?: number;
	},
): PathRibbonChunkPlan {
	const edgeKey = keys?.edge ?? PATH_EDGE_DISC_KEY;
	const bedKey = keys?.bed ?? PATH_BED_DISC_KEY;
	const cobbleKeys =
		keys?.cobbles ??
		Array.from({ length: PATH_COBBLE_COUNT }, (_, i) => pathCobbleKey(i));
	const edgeRadius = textureRadius(scene, edgeKey);
	const bedRadius = textureRadius(scene, bedKey);
	const cobbleRadius = textureRadius(scene, cobbleKeys[0] ?? bedKey);
	const plan = planPathRibbon(segments, {
		edgeRadius,
		bedRadius,
		cobbleVariants: cobbleKeys.length,
	});
	return {
		plan,
		edgeIndex: indexPointsByChunk(
			plan.edgeStamps,
			edgeRadius,
			PATH_CHUNK_SIZE_PX,
		),
		bedIndex: indexPointsByChunk(plan.bedStamps, bedRadius, PATH_CHUNK_SIZE_PX),
		cobbleIndex: indexPointsByChunk(
			plan.cobbles,
			cobbleRadius,
			PATH_CHUNK_SIZE_PX,
		),
		edgeKey,
		bedKey,
		cobbleKeys,
		cobbleFraction: keys?.cobbleFraction ?? 1,
	};
}

/** One chunk's ribbon bake — null if the plan assigned it no stamps at all (a chunk far from every path). Same three-pass draw order (edge, then bed, then cobbles) as the whole-world bake, so a seam stamp drawn into two neighboring chunks layers identically in both. */
export function bakePathRibbonChunk(
	scene: Phaser.Scene,
	chunkCol: number,
	chunkRow: number,
	chunkKey: string,
	chunkPlan: PathRibbonChunkPlan,
	tint?: number,
): Phaser.GameObjects.RenderTexture | null {
	const edgeIdx = chunkPlan.edgeIndex.get(chunkKey) ?? [];
	const bedIdx = chunkPlan.bedIndex.get(chunkKey) ?? [];
	const cobbleIdx = chunkPlan.cobbleIndex.get(chunkKey) ?? [];
	if (edgeIdx.length === 0 && bedIdx.length === 0 && cobbleIdx.length === 0)
		return null;
	const originX = chunkCol * PATH_CHUNK_SIZE_PX;
	const originY = chunkRow * PATH_CHUNK_SIZE_PX;
	const rt = scene.add.renderTexture(
		originX + PATH_CHUNK_SIZE_PX / 2,
		originY + PATH_CHUNK_SIZE_PX / 2,
		PATH_CHUNK_SIZE_PX,
		PATH_CHUNK_SIZE_PX,
	);
	const edge = scene.make.image({ key: chunkPlan.edgeKey }, false);
	const bed = scene.make.image({ key: chunkPlan.bedKey }, false);
	const cobbleImages = chunkPlan.cobbleKeys.map((key) =>
		scene.make.image({ key }, false),
	);
	rt.beginDraw();
	for (const i of edgeIdx) {
		const p = chunkPlan.plan.edgeStamps[i];
		if (p) rt.batchDraw(edge, p.x - originX, p.y - originY);
	}
	for (const i of bedIdx) {
		const p = chunkPlan.plan.bedStamps[i];
		if (p) rt.batchDraw(bed, p.x - originX, p.y - originY);
	}
	for (const i of cobbleIdx) {
		const c = chunkPlan.plan.cobbles[i];
		if (!c) continue;
		if (
			chunkPlan.cobbleFraction < 1 &&
			hashNoise2D(Math.round(c.x), Math.round(c.y), 0x1a7a) >=
				chunkPlan.cobbleFraction
		)
			continue;
		const image = cobbleImages[c.variant] ?? cobbleImages[0];
		if (image) rt.batchDraw(image, c.x - originX, c.y - originY);
	}
	rt.endDraw();
	edge.destroy();
	bed.destroy();
	for (const image of cobbleImages) image.destroy();
	if (tint !== undefined) rt.setTint(tint);
	return rt;
}

/**
 * The fallback (non-atmosphere-art) dirt-stamp plan, chunked the same way —
 * see planPathRibbonChunks's doc comment for why planning stays eager while
 * only the draws stream. A stamp's key depends on how many earlier stamps
 * its own segment already drew (a per-segment seeded RNG walked in order),
 * so stamps are planned once per segment, in full, regardless of which
 * chunk(s) end up drawing them — chunking here only changes when a stamp's
 * `rt.draw()` call happens, never which stamp a given position gets.
 */
export interface PathStamp {
	x: number;
	y: number;
	angle: number;
	key: string;
}

export function planPathStamps(
	scene: Phaser.Scene,
	segments: readonly PathSegment[],
): { stamps: PathStamp[]; index: Map<string, number[]> } {
	const stampWidth = (key: string): number =>
		(scene.textures.get(key).getSourceImage() as { width: number }).width;
	const spacing = stampWidth(pathStampKey(0)) * STAMP_OVERLAP_RATIO;
	// Conservative (half-diagonal, not half-width) since each stamp rotates to
	// its segment's own angle — a tight half-width radius could under-count
	// which chunks a rotated stamp actually touches near a seam.
	const footprintRadius = (stampWidth(pathStampKey(0)) * Math.SQRT2) / 2;

	const stamps: PathStamp[] = [];
	for (const segment of segments) {
		const seed = hashStringSeed(segment.id);
		const rand = mulberry32(seed);
		const points = stampPointsAlongSegment(segment.from, segment.to, spacing, {
			jitterAmount: STAMP_JITTER_PX,
			jitterSeed: seed,
		});
		for (const point of points) {
			const key = pathStampKey(Math.floor(rand() * PATH_STAMP_COUNT));
			stamps.push({ x: point.x, y: point.y, angle: point.angle, key });
		}
	}
	return {
		stamps,
		index: indexPointsByChunk(stamps, footprintRadius, PATH_CHUNK_SIZE_PX),
	};
}

export function bakePathChunk(
	scene: Phaser.Scene,
	chunkCol: number,
	chunkRow: number,
	chunkKey: string,
	stamps: readonly PathStamp[],
	index: Map<string, number[]>,
	tint?: number,
): Phaser.GameObjects.RenderTexture | null {
	const idx = index.get(chunkKey);
	if (!idx || idx.length === 0) return null;
	const originX = chunkCol * PATH_CHUNK_SIZE_PX;
	const originY = chunkRow * PATH_CHUNK_SIZE_PX;
	const rt = scene.add.renderTexture(
		originX + PATH_CHUNK_SIZE_PX / 2,
		originY + PATH_CHUNK_SIZE_PX / 2,
		PATH_CHUNK_SIZE_PX,
		PATH_CHUNK_SIZE_PX,
	);
	const images = new Map<string, Phaser.GameObjects.Image>();
	const getImage = (key: string): Phaser.GameObjects.Image => {
		let image = images.get(key);
		if (!image) {
			image = scene.make.image({ key }, false);
			images.set(key, image);
		}
		return image;
	};
	for (const i of idx) {
		const stamp = stamps[i];
		if (!stamp) continue;
		const image = getImage(stamp.key);
		image.setRotation(stamp.angle);
		rt.draw(image, stamp.x - originX, stamp.y - originY);
	}
	for (const image of images.values()) image.destroy();
	if (tint !== undefined) rt.setTint(tint);
	return rt;
}
