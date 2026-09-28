import {
	hashNoise2D,
	hashStringSeed,
	mulberry32,
} from "./deterministicRandom.js";

export interface SceneryBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface CircleKeepout {
	x: number;
	y: number;
	radius: number;
}

/** A path corridor: nothing may cover the capsule of `halfWidth` around the segment a->b. */
export interface SegmentKeepout {
	ax: number;
	ay: number;
	bx: number;
	by: number;
	halfWidth: number;
}

/** A sprite's size, anchored bottom-center at its (x, y) — the trunk base / the spot it stands on. */
export interface Footprint {
	w: number;
	h: number;
}

export const FILLER_KINDS = [
	"pine",
	"oak",
	"blossom-oak",
	"shrub",
	"berry-shrub",
	"boulder",
	"rock-small",
	"flower-patch",
	"stump",
	"reeds",
] as const;
export const POI_KINDS = [
	"pond",
	"windmill",
	"ruin",
	"mushroom-ring",
	"fallen-log",
	"waymarker",
] as const;
export type FillerKind = (typeof FILLER_KINDS)[number];
export type PoiKind = (typeof POI_KINDS)[number];
/** "mushroom" is the ring's individual piece — the ring itself is a POI that expands into several. */
export type SceneryKind =
	| FillerKind
	| Exclude<PoiKind, "mushroom-ring">
	| "mushroom";

export interface SceneryItem {
	kind: SceneryKind;
	x: number;
	y: number;
	/** 0xRRGGBB multiply tint — slight per-tree variation so a forest isn't one repeated sprite. */
	tint: number;
	flipX: boolean;
}

export interface PointOfInterest {
	kind: PoiKind;
	x: number;
	y: number;
}

export interface EdgeSceneryInput {
	bounds: SceneryBounds;
	/** Stable per-world string (e.g. the world id) — same world, same forest, every load. */
	seed: string;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
	footprints: Readonly<Record<SceneryKind, Footprint>>;
	/** Cap on filler items (trees/shrubs/rocks) — POIs and ponds are always kept. Bounds bake time and RenderTexture draw count on a sprawling world. */
	maxItems?: number;
	/** Minimum gap between any sprite and a keepout. */
	clearance?: number;
	/** Diameter of the windmill's turning sails, which reach well past its body's footprint. */
	windmillSailSpan?: number;
	/** A sprite's top edge must stay at least this far below bounds.minY — that strip belongs to the skyline (render/skyline.ts), which draws over it. */
	topMargin?: number;
}

export interface EdgeSceneryPlan {
	items: SceneryItem[];
	pointsOfInterest: PointOfInterest[];
}

const DEFAULT_MAX_ITEMS = 650;
const DEFAULT_CLEARANCE = 14;
const GRID_CELL_PX = 40;
const GRID_JITTER_PX = 16;
/** Distance from the world edge over which the border forest thins out into meadow. */
const FOREST_EDGE_BAND_PX = 300;
/** Distance from any clearing/path beyond which open ground turns to forest even away from the edge — what fills the big empty gaps between far-apart clusters. */
const FOREST_INTERIOR_START_PX = 240;
const NOISE_CELL_PX = 180;
const TREE_TINTS = [0xffffff, 0xeef4ea, 0xdfe8dc, 0xd2dccf, 0xe8efe0];
const MUSHROOM_RING_RADIUS = 34;
const MUSHROOM_RING_COUNT = 8;

function distToSegment(px: number, py: number, seg: SegmentKeepout): number {
	const dx = seg.bx - seg.ax;
	const dy = seg.by - seg.ay;
	const lenSq = dx * dx + dy * dy;
	const t =
		lenSq === 0
			? 0
			: Math.min(
					1,
					Math.max(0, ((px - seg.ax) * dx + (py - seg.ay) * dy) / lenSq),
				);
	return Math.hypot(px - (seg.ax + dx * t), py - (seg.ay + dy * t));
}

/** Signed distance from a point to the nearest keepout edge — negative inside one. Infinity with no keepouts at all. */
export function keepoutDistance(
	x: number,
	y: number,
	circles: readonly CircleKeepout[],
	segments: readonly SegmentKeepout[],
): number {
	let best = Number.POSITIVE_INFINITY;
	for (const c of circles) {
		best = Math.min(best, Math.hypot(x - c.x, y - c.y) - c.radius);
	}
	for (const s of segments) {
		best = Math.min(best, distToSegment(x, y, s) - s.halfWidth);
	}
	return best;
}

/** Sample points over a bottom-anchored sprite box — enough to catch a canopy leaning over a path without a full box/capsule intersection test. */
function footprintSamples(
	x: number,
	y: number,
	fp: Footprint,
): [number, number][] {
	return [
		[x, y],
		[x, y - fp.h * 0.5],
		[x, y - fp.h * 0.88],
		[x - fp.w * 0.42, y - fp.h * 0.35],
		[x + fp.w * 0.42, y - fp.h * 0.35],
		[x - fp.w * 0.3, y - fp.h * 0.75],
		[x + fp.w * 0.3, y - fp.h * 0.75],
	];
}

export function footprintClear(
	x: number,
	y: number,
	fp: Footprint,
	circles: readonly CircleKeepout[],
	segments: readonly SegmentKeepout[],
	clearance: number,
): boolean {
	return footprintSamples(x, y, fp).every(
		([sx, sy]) => keepoutDistance(sx, sy, circles, segments) >= clearance,
	);
}

function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0,1] — clumps trees into groves and glades instead of the uniform speckle a per-cell coin flip gives. */
export function valueNoise(
	x: number,
	y: number,
	cell: number,
	seed: number,
): number {
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const fx = smooth(x / cell - gx);
	const fy = smooth(y / cell - gy);
	const a = hashNoise2D(gx, gy, seed);
	const b = hashNoise2D(gx + 1, gy, seed);
	const c = hashNoise2D(gx, gy + 1, seed);
	const d = hashNoise2D(gx + 1, gy + 1, seed);
	return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function edgeDistance(x: number, y: number, b: SceneryBounds): number {
	return Math.min(x - b.minX, b.maxX - x, y - b.minY, b.maxY - y);
}

/**
 * Deterministically dresses a world's empty margins: a dense forest that
 * thickens toward the world edge (and into any large gap far from every
 * clearing), a scrubby fringe, sparse meadow detail near the clearings, one
 * or two ponds, and a handful of points of interest (windmill, ruin,
 * mushroom ring, fallen log, a waymarker beside a path). Pure — the engine
 * bakes the result (render/sceneryBaker.ts) — so determinism and "never
 * covers a path/portal/cabin/spawn" are unit-testable without Phaser.
 *
 * Every placement is checked against the caller's keepouts over the
 * sprite's whole bottom-anchored footprint, not just its anchor point,
 * because a tall tree planted well clear of a path can still lean its
 * canopy over it.
 */
export function planEdgeScenery(input: EdgeSceneryInput): EdgeSceneryPlan {
	const { bounds, footprints } = input;
	const baseSeed = hashStringSeed(`edge-scenery:${input.seed}`);
	const rand = mulberry32(baseSeed);
	const clearance = input.clearance ?? DEFAULT_CLEARANCE;
	const topLimit = bounds.minY + (input.topMargin ?? 0);
	const circles: CircleKeepout[] = [...input.circles];
	const segments = input.segments;

	const inBounds = (x: number, y: number, fp: Footprint): boolean =>
		y <= bounds.maxY &&
		y - fp.h >= topLimit &&
		x >= bounds.minX &&
		x <= bounds.maxX;

	const forestScore = (x: number, y: number): number => {
		const d = keepoutDistance(x, y, input.circles, segments);
		const fromEdge = 1 - edgeDistance(x, y, bounds) / FOREST_EDGE_BAND_PX;
		const fromContent = (d - FOREST_INTERIOR_START_PX) / 200;
		const n = valueNoise(x, y, NOISE_CELL_PX, baseSeed) - 0.5;
		return Math.max(fromEdge, fromContent) + n * 0.7;
	};

	const reserve = (x: number, y: number, fp: Footprint, pad: number): void => {
		circles.push({
			x,
			y: y - fp.h / 2,
			radius: Math.max(fp.w, fp.h) / 2 + pad,
		});
	};

	const items: SceneryItem[] = [];
	const pointsOfInterest: PointOfInterest[] = [];
	const push = (kind: SceneryKind, x: number, y: number, tint = 0xffffff) => {
		items.push({ kind, x, y, tint, flipX: rand() < 0.5 });
	};

	const randomPoint = (): [number, number] => [
		bounds.minX + rand() * (bounds.maxX - bounds.minX),
		bounds.minY + rand() * (bounds.maxY - bounds.minY),
	];

	/** Up to `attempts` random candidates; the first that satisfies `accept` wins. */
	const findSpot = (
		fp: Footprint,
		pad: number,
		accept: (x: number, y: number, d: number, score: number) => boolean,
		attempts = 80,
	): [number, number] | null => {
		for (let i = 0; i < attempts; i++) {
			const [x, y] = randomPoint();
			if (!inBounds(x, y, fp)) continue;
			if (!footprintClear(x, y, fp, circles, segments, pad)) continue;
			const d = keepoutDistance(x, y, input.circles, segments);
			if (!accept(x, y, d, forestScore(x, y))) continue;
			return [x, y];
		}
		return null;
	};

	// Ponds first — they need the most open room.
	const pondFp = footprints.pond;
	const reedFp = footprints.reeds;
	const pondCount = 1 + (rand() < 0.6 ? 1 : 0);
	for (let p = 0; p < pondCount; p++) {
		const spot = findSpot(
			pondFp,
			40,
			(_x, _y, d, score) => d > 90 && score < 0.45,
		);
		if (!spot) continue;
		const [x, y] = spot;
		push("pond", x, y);
		pointsOfInterest.push({ kind: "pond", x, y });
		const reedSpots: [number, number][] = [
			[-0.44, -0.12],
			[-0.36, 0.02],
			[0.4, -0.55],
			[0.46, -0.3],
		];
		for (const [fx, fy] of reedSpots) {
			if (rand() < 0.25) continue;
			push("reeds", x + fx * pondFp.w, y + fy * pondFp.h + reedFp.h * 0.5);
		}
		reserve(x, y, pondFp, 24);
	}

	const poi = (
		kind: PoiKind,
		fp: Footprint,
		accept: (x: number, y: number, d: number, score: number) => boolean,
	): [number, number] | null => {
		const spot = findSpot(fp, clearance + 16, accept);
		if (!spot) return null;
		pointsOfInterest.push({ kind, x: spot[0], y: spot[1] });
		reserve(spot[0], spot[1], fp, 20);
		return spot;
	};

	// The sails, not the body, set the windmill's real reach.
	const sailSpan = input.windmillSailSpan ?? footprints.windmill.w;
	const windmillFp: Footprint = {
		w: Math.max(footprints.windmill.w, sailSpan),
		h: footprints.windmill.h + sailSpan * 0.25,
	};
	const windmill = poi(
		"windmill",
		windmillFp,
		(_x, _y, d, score) => d > 110 && d < 520 && score < 0.45,
	);
	if (windmill) push("windmill", windmill[0], windmill[1]);

	const ruin = poi(
		"ruin",
		footprints.ruin,
		(_x, _y, d, score) => d > 90 && d < 560 && score < 0.7,
	);
	if (ruin) push("ruin", ruin[0], ruin[1]);

	const ringFp: Footprint = {
		w: MUSHROOM_RING_RADIUS * 2 + footprints.mushroom.w,
		h: MUSHROOM_RING_RADIUS * 2 + footprints.mushroom.h,
	};
	const ring = poi(
		"mushroom-ring",
		ringFp,
		(_x, _y, d, score) => d > 60 && d < 420 && score > 0.05 && score < 0.65,
	);
	if (ring) {
		const cy = ring[1] - ringFp.h / 2;
		for (let i = 0; i < MUSHROOM_RING_COUNT; i++) {
			const a = (Math.PI * 2 * i) / MUSHROOM_RING_COUNT;
			push(
				"mushroom",
				ring[0] + Math.cos(a) * MUSHROOM_RING_RADIUS,
				cy +
					Math.sin(a) * MUSHROOM_RING_RADIUS * 0.7 +
					footprints.mushroom.h / 2,
			);
		}
	}

	const log = poi(
		"fallen-log",
		footprints["fallen-log"],
		(_x, _y, d, score) => d > 60 && d < 460 && score < 0.75,
	);
	if (log) push("fallen-log", log[0], log[1]);

	// Waymarker: beside a path, a little way along it, so it reads as marking
	// the way rather than standing in a field.
	const signFp = footprints.waymarker;
	for (let attempt = 0; attempt < 30 && segments.length > 0; attempt++) {
		const seg = segments[Math.floor(rand() * segments.length)];
		if (!seg) break;
		const t = 0.3 + rand() * 0.4;
		const dx = seg.bx - seg.ax;
		const dy = seg.by - seg.ay;
		const len = Math.hypot(dx, dy) || 1;
		const side = rand() < 0.5 ? -1 : 1;
		const off = seg.halfWidth + clearance + signFp.w * 0.5 + 4;
		const x = seg.ax + dx * t + (-dy / len) * off * side;
		const y = seg.ay + dy * t + (dx / len) * off * side + signFp.h * 0.5;
		if (!inBounds(x, y, signFp)) continue;
		if (!footprintClear(x, y, signFp, circles, segments, clearance * 0.5))
			continue;
		push("waymarker", x, y);
		pointsOfInterest.push({ kind: "waymarker", x, y });
		reserve(x, y, signFp, 6);
		break;
	}

	// Filler: a jittered grid, each cell deciding by zone what (if anything) grows there.
	const filler: SceneryItem[] = [];
	const cols = Math.ceil((bounds.maxX - bounds.minX) / GRID_CELL_PX);
	const rows = Math.ceil((bounds.maxY - bounds.minY) / GRID_CELL_PX);
	for (let row = 0; row <= rows; row++) {
		for (let col = 0; col <= cols; col++) {
			const x =
				bounds.minX + col * GRID_CELL_PX + (rand() * 2 - 1) * GRID_JITTER_PX;
			const y =
				bounds.minY + row * GRID_CELL_PX + (rand() * 2 - 1) * GRID_JITTER_PX;
			const roll = rand();
			const pick = rand();
			const score = forestScore(x, y);
			let kind: FillerKind | null = null;
			if (score > 0.5) {
				if (roll < 0.86) {
					kind = pick < 0.55 ? "pine" : pick < 0.88 ? "oak" : "blossom-oak";
				} else if (roll < 0.94) {
					kind = pick < 0.6 ? "shrub" : "berry-shrub";
				}
			} else if (score > 0.22) {
				if (roll < 0.14)
					kind = pick < 0.35 ? "blossom-oak" : pick < 0.7 ? "oak" : "pine";
				else if (roll < 0.32) kind = pick < 0.55 ? "shrub" : "berry-shrub";
				else if (roll < 0.38) kind = "flower-patch";
				else if (roll < 0.41) kind = pick < 0.5 ? "boulder" : "rock-small";
				else if (roll < 0.425) kind = "stump";
			} else {
				if (roll < 0.05) kind = "flower-patch";
				else if (roll < 0.075) kind = "shrub";
				else if (roll < 0.1) kind = "rock-small";
				else if (roll < 0.11) kind = "berry-shrub";
				else if (roll < 0.117) kind = "boulder";
				else if (roll < 0.122) kind = "stump";
			}
			if (!kind) continue;
			const fp = footprints[kind];
			if (!inBounds(x, y, fp)) continue;
			if (!footprintClear(x, y, fp, circles, segments, clearance)) continue;
			const isTree =
				kind === "pine" || kind === "oak" || kind === "blossom-oak";
			const tint = isTree
				? (TREE_TINTS[Math.floor(rand() * TREE_TINTS.length)] ?? 0xffffff)
				: 0xffffff;
			filler.push({ kind, x, y, tint, flipX: rand() < 0.5 });
		}
	}

	const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;
	let kept = filler;
	if (filler.length > maxItems) {
		// Seeded Fisher-Yates, then keep the first N: thins evenly everywhere
		// instead of truncating whole rows off the bottom of the world.
		kept = [...filler];
		for (let i = kept.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			const tmp = kept[i] as SceneryItem;
			kept[i] = kept[j] as SceneryItem;
			kept[j] = tmp;
		}
		kept = kept.slice(0, maxItems);
	}

	// Painter's order: lower on screen draws later, so nearer trees overlap farther ones.
	const all = [...items, ...kept].sort((a, b) => a.y - b.y || a.x - b.x);
	return { items: all, pointsOfInterest };
}
