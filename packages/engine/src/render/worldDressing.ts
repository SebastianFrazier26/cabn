import type Phaser from "phaser";
import { type SceneryName, sceneryKey } from "../assetPaths.js";
import { PALETTE } from "../palette.js";
import {
	type CircleKeepout,
	type EdgeSceneryLayer,
	FILLER_KINDS,
	type LayeredSceneryItem,
	type PointOfInterest,
	planLayeredEdgeScenery,
	type SceneryKind,
	type SegmentKeepout,
} from "../systems/edgeScenery.js";
import type { AtmosphereHandle } from "./atmosphere.js";
import { attachCloudShadows } from "./cloudShadows.js";
import type { LightPoolOptions } from "./lightPools.js";
import {
	addWindmillSails,
	bakeScenery,
	sceneryFootprints,
} from "./sceneryBaker.js";
import {
	attachSkyline,
	HORIZON_OVERLAP_PX,
	SKY_BAND_HEIGHT_PX,
	type SkylineHandle,
	type SkylineOptions,
} from "./skyline.js";

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Above the paths (1) and clearing ground (0.5-0.6), below props/cabinets (2) — the edge forest is background. */
const SCENERY_DEPTH = 1.5;
const SAILS_DEPTH = 1.6;
/**
 * Negative on purpose: the sky band is opaque everywhere above the horizon
 * and the treeline's solid base straddles its bottom edge, so a border tree
 * whose crown rises past the top bound simply disappears behind the treeline
 * — which reads as the forest continuing into the distance. Keeping crowns
 * fully below the band instead left a bare strip of grass under a hard edge.
 */
const SCENERY_TOP_MARGIN = HORIZON_OVERLAP_PX - 110;
/** Keeps the player (and their sprite's head) below the horizon — the sky band draws above the player (see skyline.ts). */
const PLAYER_TOP_MARGIN = HORIZON_OVERLAP_PX + 70;

const ALL_KINDS: readonly SceneryKind[] = [
	...FILLER_KINDS,
	"pond",
	"windmill",
	"ruin",
	"mushroom",
	"fallen-log",
	"waymarker",
];

export interface EdgeDressingInput {
	scene: Phaser.Scene;
	bounds: Bounds;
	seed: string;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
	reducedMotion: boolean;
	/** A world layer's content and grown bounds; `bounds`, `circles` and `segments` then describe the base world alone (planLayeredEdgeScenery). */
	layer?: EdgeSceneryLayer | null;
	/** A world skin's replacement textures, by kind (same pixel size as the originals). */
	textureFor?: (kind: SceneryName) => string | undefined;
	/** A world skin's multiply tint on every piece it doesn't redraw. */
	tint?: number;
	/** Kinds that hold still (a world skin's stillScenery): the windmill's sails don't turn. */
	still?: ReadonlySet<SceneryName>;
}

export interface EdgeDressing {
	/** Night light sources the dressing adds (the windmill's window) — merged into the scene's atmosphere lights. */
	lights: LightPoolOptions[];
	itemCount: number;
	/** The planned pieces (read by the shadow owner e2e to check the scenery never moves). */
	items: readonly LayeredSceneryItem[];
	pointsOfInterest: readonly PointOfInterest[];
	destroy(): void;
}

/**
 * Plans (systems/edgeScenery.ts) and bakes (render/sceneryBaker.ts) the
 * border forest, meadow detail and points of interest for one scene. Shared
 * by WorldScene and ShelfScene, which differ only in what they keep clear.
 */
export function dressEdges(input: EdgeDressingInput): EdgeDressing {
	const { scene } = input;
	const footprints = sceneryFootprints(scene, ALL_KINDS);
	const sails = scene.textures
		.get(sceneryKey("windmill-sails"))
		.getSourceImage() as {
		width: number;
	};
	const plan = planLayeredEdgeScenery(
		{
			bounds: input.bounds,
			seed: input.seed,
			circles: input.circles,
			segments: input.segments,
			footprints,
			windmillSailSpan: sails.width,
			topMargin: SCENERY_TOP_MARGIN,
		},
		input.layer ?? null,
	);
	const chunks = bakeScenery(
		scene,
		input.layer?.bounds ?? input.bounds,
		plan.items,
		footprints,
		SCENERY_DEPTH,
		{ textureFor: input.textureFor, tint: input.tint },
	);

	const live: Phaser.GameObjects.GameObject[] = [];
	const lights: LightPoolOptions[] = [];
	for (const poi of plan.pointsOfInterest) {
		if (poi.kind !== "windmill") continue;
		live.push(
			addWindmillSails(
				scene,
				poi.x,
				poi.y,
				footprints.windmill.h,
				SAILS_DEPTH,
				input.reducedMotion || (input.still?.has("windmill-sails") ?? false),
				input.tint,
				input.textureFor?.("windmill-sails"),
			),
		);
		// Window rows 16-19 of the 30-row windmill grid (world-art/scenery.ts).
		lights.push({
			x: poi.x,
			y: poi.y - footprints.windmill.h * 0.42,
			radiusPx: 34,
			color: PALETTE.gold,
			alpha: 0.65,
		});
	}

	return {
		lights,
		itemCount: plan.items.length,
		items: plan.items,
		pointsOfInterest: plan.pointsOfInterest,
		destroy: () => {
			for (const chunk of chunks) chunk.destroy();
			for (const object of live) object.destroy();
		},
	};
}

/** Horizon skyline + drifting day cloud shadows, both driven by the scene's atmosphere blend. */
export function attachSky(
	scene: Phaser.Scene,
	bounds: Bounds,
	seed: string,
	atmosphere: AtmosphereHandle,
	reducedMotion: boolean,
	skylineTint?: number,
	/** With a world layer on: the base world's bounds (the skyline keeps its pieces) and the skin's sky gradient. */
	options: Pick<
		SkylineOptions,
		"baseBounds" | "skyKey" | "pieceTextureFor"
	> = {},
): { skyline: SkylineHandle; destroy(): void } {
	const skyline = attachSkyline(scene, {
		bounds,
		seed,
		atmosphere,
		reducedMotion,
		...(skylineTint !== undefined ? { tint: skylineTint } : {}),
		...options,
	});
	const clouds = attachCloudShadows(
		scene,
		bounds,
		seed,
		atmosphere,
		reducedMotion,
	);
	return {
		skyline,
		destroy: () => {
			skyline.destroy();
			clouds.destroy();
		},
	};
}

/**
 * Camera and physics bounds for a scene with a skyline: the camera may rise
 * SKY_BAND_HEIGHT_PX above the world's top edge to show the horizon, while
 * the player stays below it.
 */
export function boundsWithSky(bounds: Bounds): {
	camera: Bounds;
	physics: Bounds;
} {
	return {
		camera: { ...bounds, minY: bounds.minY - SKY_BAND_HEIGHT_PX },
		physics: { ...bounds, minY: bounds.minY + PLAYER_TOP_MARGIN },
	};
}
