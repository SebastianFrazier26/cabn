import type Phaser from "phaser";
import { DECAL_SHEET_KEY } from "../assetPaths.js";
import type { ScatterExclusion } from "../systems/scatter.js";
import { acquireChunkRT } from "./chunkRenderTextures.js";
import {
	CLUSTER_TILE_PX,
	type ClusterGroundDraw,
	planClusterGroundDraws,
} from "./clusterGroundPlan.js";
import { computeGroundGrid, GROUND_TILE_SIZE } from "./groundTiles.js";

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
	/** A world skin's multiply tint (systems/worldLayer.ts); omitted, the art's own colours. */
	tint?: number;
	/** A world skin's decal sheet (DECAL_SHEET layout); omitted, the world's own. */
	decalSheetKey?: string;
}

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
	drawClusterGround(rt, planBakeClusterGround(params), params);
	if (params.tint !== undefined) rt.setTint(params.tint);
	return rt;
}

/** The plan for a cluster given world-space exclusions (placeScatter works cluster-local, so they're translated here, not in the caller). */
export function planBakeClusterGround(
	params: BakeClusterGroundParams,
): ClusterGroundDraw[] {
	return planClusterGroundDraws({
		clusterId: params.clusterId,
		radiusX: params.radiusX,
		radiusY: params.radiusY,
		localExclusions: params.exclusions.map((e) => ({
			x: e.x - params.centerX,
			y: e.y - params.centerY,
			radius: e.radius,
		})),
		decalCount: params.decalCount,
		...(params.decalMinSpacing !== undefined
			? { decalMinSpacing: params.decalMinSpacing }
			: {}),
		...(params.ringFlowerCount !== undefined
			? { ringFlowerCount: params.ringFlowerCount }
			: {}),
		seed: params.seed,
	});
}

/** Paints `draws` into `rt`, shifted so (offsetX, offsetY) in cluster-grid px is the RT's top-left. Draws partly outside the RT are clipped by the GPU, which is what makes tile seams invisible. */
export function drawClusterGround(
	rt: Phaser.GameObjects.RenderTexture,
	draws: readonly ClusterGroundDraw[],
	params: Pick<BakeClusterGroundParams, "biomeSheetKey" | "decalSheetKey">,
	offsetX = 0,
	offsetY = 0,
): void {
	const decalKey = params.decalSheetKey ?? DECAL_SHEET_KEY;
	rt.beginDraw();
	for (const draw of draws) {
		rt.batchDrawFrame(
			draw.sheet === "tile" ? params.biomeSheetKey : decalKey,
			draw.frame,
			draw.x - offsetX,
			draw.y - offsetY,
		);
	}
	rt.endDraw();
}

/** One CLUSTER_TILE_PX square of a cluster's ground, whose top-left sits at (worldX, worldY); `draws` is that tile's slice of the cluster plan (assignDrawsToTiles), in cluster-grid px, and `tileCol`/`tileRow` locate the tile in that grid. */
export function bakeClusterGroundTile(
	scene: Phaser.Scene,
	draws: readonly ClusterGroundDraw[],
	params: Pick<
		BakeClusterGroundParams,
		"biomeSheetKey" | "decalSheetKey" | "tint"
	>,
	tileCol: number,
	tileRow: number,
	worldX: number,
	worldY: number,
): Phaser.GameObjects.RenderTexture {
	const rt = acquireChunkRT(
		scene,
		worldX + CLUSTER_TILE_PX / 2,
		worldY + CLUSTER_TILE_PX / 2,
	);
	drawClusterGround(
		rt,
		draws,
		params,
		tileCol * CLUSTER_TILE_PX,
		tileRow * CLUSTER_TILE_PX,
	);
	if (params.tint !== undefined) rt.setTint(params.tint);
	return rt;
}
