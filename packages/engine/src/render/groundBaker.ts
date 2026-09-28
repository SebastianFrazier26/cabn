import type Phaser from "phaser";
import {
	BIOME_TILE_VARIANT_COUNT,
	DECAL_COUNT,
	DECAL_FRAME_SIZE,
	DECAL_SHEET_KEY,
} from "../assetPaths.js";
import { placeScatter, type ScatterExclusion } from "../systems/scatter.js";
import {
	computeGroundGrid,
	GROUND_TILE_SIZE,
	tileFrameFor,
} from "./groundTiles.js";

export interface BakeClusterGroundParams {
	scene: Phaser.Scene;
	clusterId: string;
	/** Already-resolved Phaser texture key for this cluster's biome tile sheet (see assetPaths.ts#biomeTileSheetKey). */
	biomeSheetKey: string;
	centerX: number;
	centerY: number;
	radiusX: number;
	radiusY: number;
	/** World-space circles (portals, player spawn, path corridors) decals must never land inside. */
	exclusions: readonly ScatterExclusion[];
	decalCount: number;
	decalMinSpacing?: number;
	/** Evenly-spaced flower decals right at the clearing's edge — the "ring of flowers" the clearing-marking brief asks for, on top of (not instead of) the scattered interior decals. 0 skips the ring. */
	ringFlowerCount?: number;
	seed: number;
}

// decals.ts's buildDecals() order: 0 = flower-pink, 1 = flower-blue.
const RING_FLOWER_VARIANTS = [0, 1];

/**
 * Bakes one cluster's tiled biome ground plus its scattered decals into a
 * single static `RenderTexture` — the perf-load-bearing choice this batch
 * makes: a busy cluster's grid can be dozens of 32px tiles plus a dozen-odd
 * decals, and drawing all of that as individual sprites every cluster,
 * multiplied by however many clusters a world has, is exactly the "thousands
 * of sprites" the milestone brief called out. One `RenderTexture` per
 * cluster means one GameObject, one draw call, in the scene's render list
 * regardless of how detailed the ground underneath it is; the one-time bake
 * cost (a `drawFrame` per tile/decal at scene creation) is trivial next to
 * paying that every frame as live sprites would be.
 */
export function bakeClusterGround(
	params: BakeClusterGroundParams,
): Phaser.GameObjects.RenderTexture {
	const { scene, centerX, centerY, radiusX, radiusY } = params;
	const grid = computeGroundGrid(radiusX, radiusY, GROUND_TILE_SIZE);
	const width = grid.cols * GROUND_TILE_SIZE;
	const height = grid.rows * GROUND_TILE_SIZE;
	const rt = scene.add.renderTexture(centerX, centerY, width, height);

	for (let row = 0; row < grid.rows; row++) {
		for (let col = 0; col < grid.cols; col++) {
			const frame = tileFrameFor(grid.insideAt, col, row, {
				variantCount: BIOME_TILE_VARIANT_COUNT,
				seed: params.seed,
			});
			if (frame === null) continue;
			rt.drawFrame(
				params.biomeSheetKey,
				frame,
				col * GROUND_TILE_SIZE,
				row * GROUND_TILE_SIZE,
			);
		}
	}

	// placeScatter works in the same coordinate space its exclusions are
	// given in — run it in cluster-local space (0,0 = center) so the caller's
	// world-space exclusions need translating, not the other way around.
	const localExclusions: ScatterExclusion[] = params.exclusions.map((e) => ({
		x: e.x - centerX,
		y: e.y - centerY,
		radius: e.radius,
	}));
	const decals = placeScatter({
		clusterId: `${params.clusterId}:decals`,
		centerX: 0,
		centerY: 0,
		radiusX,
		radiusY,
		count: params.decalCount,
		minSpacing: params.decalMinSpacing ?? 20,
		variantCount: DECAL_COUNT,
		exclusions: localExclusions,
	});
	for (const decal of decals) {
		// Cluster-local (0,0 centered) -> RT-local (top-left origin), then
		// offset by half the decal frame so (decal.x, decal.y) is its center,
		// not its corner.
		const rtX = decal.x - grid.originX - DECAL_FRAME_SIZE / 2;
		const rtY = decal.y - grid.originY - DECAL_FRAME_SIZE / 2;
		rt.drawFrame(DECAL_SHEET_KEY, decal.variant, rtX, rtY);
	}

	const ringCount = params.ringFlowerCount ?? 0;
	for (let i = 0; i < ringCount; i++) {
		const angle = (Math.PI * 2 * i) / ringCount;
		const x = Math.cos(angle) * radiusX * 0.92;
		const y = Math.sin(angle) * radiusY * 0.92;
		const variant = RING_FLOWER_VARIANTS[i % RING_FLOWER_VARIANTS.length] ?? 0;
		rt.drawFrame(
			DECAL_SHEET_KEY,
			variant,
			x - grid.originX - DECAL_FRAME_SIZE / 2,
			y - grid.originY - DECAL_FRAME_SIZE / 2,
		);
	}

	return rt;
}
