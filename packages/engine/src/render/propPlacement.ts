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
 * Landmark-ish props that read as repetitive when a clearing gets two —
 * the M10 playtest's "too many wells". Everything else in the pool is
 * small/generic enough (bushes, flower pots, fences) that repeats look
 * natural.
 */
export const PROP_MAX_PER_CLEARING: Partial<Record<PropName, number>> = {
	well: 1,
	bench: 1,
};

/**
 * Maps each scatter point's random variant to a prop name, re-picking any
 * pick that would exceed its per-clearing cap by stepping forward through
 * the pool to the next name still under its cap. Deterministic (same
 * variants in, same names out), so layouts stay stable between visits; only
 * capped picks move, so an uncapped clearing lays out exactly as before.
 */
export function assignCappedPropNames(
	variants: readonly number[],
	pool: readonly PropName[],
	caps: Partial<Record<PropName, number>> = PROP_MAX_PER_CLEARING,
): PropName[] {
	if (pool.length === 0) throw new Error("placeProps: prop pool is empty");
	const used = new Map<PropName, number>();
	const underCap = (name: PropName) =>
		(used.get(name) ?? 0) < (caps[name] ?? Number.POSITIVE_INFINITY);
	return variants.map((variant) => {
		const start = ((variant % pool.length) + pool.length) % pool.length;
		let pick = pool[start] as PropName;
		for (let step = 0; step < pool.length; step++) {
			const candidate = pool[(start + step) % pool.length] as PropName;
			if (underCap(candidate)) {
				pick = candidate;
				break;
			}
		}
		used.set(pick, (used.get(pick) ?? 0) + 1);
		return pick;
	});
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

	const names = assignCappedPropNames(
		points.map((point) => point.variant),
		pool,
	);
	return points.map((point, i) => {
		const name = names[i] as PropName;
		const sprite = params.scene.add.image(point.x, point.y, propKey(name));
		sprite.setDepth(params.depth);
		return { sprite, name, x: point.x, y: point.y };
	});
}
