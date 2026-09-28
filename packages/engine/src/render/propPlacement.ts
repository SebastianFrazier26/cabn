import type Phaser from "phaser";
import { PROP_NAMES, propKey } from "../assetPaths.js";
import { placeScatter, type ScatterExclusion } from "../systems/scatter.js";

export interface PlacePropsParams {
	scene: Phaser.Scene;
	clusterId: string;
	centerX: number;
	centerY: number;
	radiusX: number;
	radiusY: number;
	exclusions: readonly ScatterExclusion[];
	count: number;
	minSpacing?: number;
	depth: number;
}

/**
 * Props are real sprites, not baked into the ground `RenderTexture` the way
 * decals are (see groundBaker.ts's doc comment) — a handful per cluster is
 * nowhere near "thousands," and unlike a flat decal, a prop wants a fixed
 * depth of its own to sit above the tiled ground but (like every other
 * cluster-level GameObject in this codebase — cabinets, portals, the
 * bonfire) below the always-on-top player; there's no y-sort anywhere else
 * in WorldScene/ShelfScene either, so introducing one just for props would
 * be an inconsistent one-off, not a real fix.
 */
export function placeProps(
	params: PlacePropsParams,
): Phaser.GameObjects.Image[] {
	const points = placeScatter({
		clusterId: `${params.clusterId}:props`,
		centerX: params.centerX,
		centerY: params.centerY,
		radiusX: params.radiusX,
		radiusY: params.radiusY,
		count: params.count,
		minSpacing: params.minSpacing ?? 60,
		variantCount: PROP_NAMES.length,
		exclusions: params.exclusions,
	});

	return points.map((point) => {
		const name = PROP_NAMES[point.variant] ?? PROP_NAMES[0];
		if (!name) throw new Error("placeProps: PROP_NAMES is empty");
		const sprite = params.scene.add.image(point.x, point.y, propKey(name));
		sprite.setDepth(params.depth);
		return sprite;
	});
}
