import type Phaser from "phaser";
import { PROP_NAMES, type PropName, propKey } from "../assetPaths.js";
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
	/** Restricts the random pick to a subset of PROP_NAMES — e.g. the shelf only ever wants a couple of cottagecore accents near the tower, not the full pool including things sized for a cluster clearing. */
	allowedNames?: readonly PropName[];
	/** Forwarded to placeScatter — confines props to the outer annulus of the clearing so they frame its edge instead of scattering anywhere non-excluded. */
	minRadiusFrac?: number;
}

export interface PlacedProp {
	sprite: Phaser.GameObjects.Image;
	name: PropName;
	x: number;
	y: number;
}

/** Chimney position as a fraction of the sprite's own displayWidth/Height from its center — hand-measured against cottage()'s grid layout in tools/asset-pipeline/src/world-art/props.ts (fillRect(g, 14, 3, 3, 9, chimney) on a 20x24 grid). Only cottage has a chimney; render/effects.ts's smoke emitter is the one thing that reads this. */
const PROP_SMOKE_OFFSET: Partial<
	Record<PropName, { xFrac: number; yFrac: number }>
> = {
	cottage: { xFrac: 0.28, yFrac: -0.19 },
};

export function propSmokeWorldPos(
	prop: PlacedProp,
): { x: number; y: number } | null {
	const offset = PROP_SMOKE_OFFSET[prop.name];
	if (!offset) return null;
	return {
		x: prop.x + offset.xFrac * prop.sprite.displayWidth,
		y: prop.y + offset.yFrac * prop.sprite.displayHeight,
	};
}

/**
 * Same fractional-offset trick as PROP_SMOKE_OFFSET, for the bright glow spot
 * each lit prop's art already has (lampPost's glow slit, cottage's window —
 * see world-art/props.ts). M10b batch 3: night now draws a real additive
 * light pool at each of these (render/effects.ts#createLightPool) instead of
 * relying on the post-fx bloom alone to make them read as "lit".
 */
const PROP_LIGHT_OFFSET: Partial<
	Record<PropName, { xFrac: number; yFrac: number }>
> = {
	"lamp-post": { xFrac: 0, yFrac: -0.3 },
	cottage: { xFrac: -0.2, yFrac: 0.17 },
};

export function propLightWorldPos(
	prop: PlacedProp,
): { x: number; y: number } | null {
	const offset = PROP_LIGHT_OFFSET[prop.name];
	if (!offset) return null;
	return {
		x: prop.x + offset.xFrac * prop.sprite.displayWidth,
		y: prop.y + offset.yFrac * prop.sprite.displayHeight,
	};
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
export function placeProps(params: PlacePropsParams): PlacedProp[] {
	const pool = params.allowedNames?.length ? params.allowedNames : PROP_NAMES;
	const points = placeScatter({
		clusterId: `${params.clusterId}:props`,
		centerX: params.centerX,
		centerY: params.centerY,
		radiusX: params.radiusX,
		radiusY: params.radiusY,
		count: params.count,
		minSpacing: params.minSpacing ?? 60,
		variantCount: pool.length,
		exclusions: params.exclusions,
		minRadiusFrac: params.minRadiusFrac,
	});

	return points.map((point) => {
		const name = pool[point.variant] ?? pool[0];
		if (!name) throw new Error("placeProps: prop pool is empty");
		const sprite = params.scene.add.image(point.x, point.y, propKey(name));
		sprite.setDepth(params.depth);
		return { sprite, name, x: point.x, y: point.y };
	});
}
