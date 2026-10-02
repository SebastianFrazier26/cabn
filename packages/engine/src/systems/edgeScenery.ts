import { WORLD_CHUNK_SIZE_PX } from "../render/worldChunkGrid.js";
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

// M10 stream-bake: planEdgeScenery's filler grid calls a keepout-distance
// query once (forestScore) or several times (footprintClear's sample points)
// per candidate cell — for a real repo conversion with hundreds of clusters
// (each with its own portal-ring circles) this is easily a few thousand
// keepouts, over a grid that itself scales with world *area* (see
// planEdgeScenery's own doc comment: GRID_CELL_PX cells across the full
// bounds). O(cells x keepouts) with both terms scaling up independently is
// what turned a 61,000 x 67,000px real-world conversion's edge-scenery bake
// into a multi-minute stall — chunking the *bake* (sceneryBaker.ts) doesn't
// touch this, since the plan itself (not just its draws) is what was slow.
// Bigger than a typical portal-ring circle (keeps dense areas' per-bucket
// lists small — see KeepoutIndex's own maxBucketSize, measured ~7 at this
// size on a real repo conversion), but big enough that reaching
// KEEPOUT_SATURATION_PX only takes a couple of rings, not a dozen: a query
// deep in a filler-grid gap between clusters (the common case on a sprawling
// world, not the rare one) hits that saturation cap on almost every call, so
// the ring count *at* the cap dominates that call's actual cost.
const INDEX_BUCKET_PX = 768;

// Both planEdgeScenery call sites that use KeepoutIndex (forestScore's
// zoning score, the filler loop's clearance check) only ever compare the
// distance against small thresholds — clearance is a few tens of px,
// forestScore's own fromContent term already dominates fromEdge and clears
// the 0.5/0.22 zoning cutoffs well before a couple hundred px, even before
// noise (±0.35) is added. Once the true distance is provably at least this
// far, reporting this value instead of searching further changes neither
// decision — see KeepoutIndex.nearestDistance's own doc comment. This
// matters because "far from every keepout" is the *common* case for a
// filler grid cell in a real, sprawling repo conversion (that's the point
// of the filler grid: fill the gaps between far-apart clusters), not a rare
// edge case worth leaving unhandled.
const KEEPOUT_SATURATION_PX = 2048;

function indexBucketKey(col: number, row: number): string {
	return `${col},${row}`;
}

function indexBucketRange(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): { c0: number; c1: number; r0: number; r1: number } {
	return {
		c0: Math.floor(minX / INDEX_BUCKET_PX),
		c1: Math.floor(maxX / INDEX_BUCKET_PX),
		r0: Math.floor(minY / INDEX_BUCKET_PX),
		r1: Math.floor(maxY / INDEX_BUCKET_PX),
	};
}

/** Every bucket a segment's own thin corridor actually passes through — walks the line at half-bucket steps (fine enough not to skip a bucket) rather than using its full bounding box, which for a long diagonal segment is far bigger than the corridor itself. */
function segmentBucketKeys(s: SegmentKeepout): Set<string> {
	const keys = new Set<string>();
	const dx = s.bx - s.ax;
	const dy = s.by - s.ay;
	const len = Math.hypot(dx, dy);
	const steps = Math.max(1, Math.ceil(len / (INDEX_BUCKET_PX / 2)));
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const px = s.ax + dx * t;
		const py = s.ay + dy * t;
		const { c0, c1, r0, r1 } = indexBucketRange(
			px - s.halfWidth,
			py - s.halfWidth,
			px + s.halfWidth,
			py + s.halfWidth,
		);
		for (let row = r0; row <= r1; row++) {
			for (let col = c0; col <= c1; col++) keys.add(indexBucketKey(col, row));
		}
	}
	return keys;
}

/**
 * A uniform-grid spatial index over a fixed set of circles/segments, giving
 * the exact same result `keepoutDistance` would over that same set — see
 * edgeScenery.test.ts's property test comparing the two directly over random
 * points and random keepout sets — but in O(nearby keepouts) per query
 * instead of O(all keepouts). Built once per `planEdgeScenery` call (the
 * keepout set doesn't change once a reserve() has happened — see that
 * function for where each index gets (re)built) and queried once per grid
 * cell, so the index-build cost amortizes across however many cells the
 * world's bounds imply.
 *
 * Exactness relies on `maxPad` (the largest radius/half-width in the set):
 * once a search ring's *inner* edge is farther than the best distance found
 * so far, minus that pad, nothing outside the ring can still beat it — a
 * circle or segment even one bucket farther out can reach at most `maxPad`
 * back toward the query point, never more.
 */
// A circle/segment padded above this goes into a small linear-scanned
// "wide" list instead of the bucketed grid — one arch-heavy cluster (a
// directory with hundreds of files gets a proportionally wider portal ring,
// see WorldScene's groundReach) would otherwise both (a) get inserted into
// hundreds of buckets at once (its bounding box divided by INDEX_BUCKET_PX
// squared) and (b) inflate maxPad for every other query in the whole world,
// forcing every single ring search to expand further before it can prove
// nothing farther out beats what it's already found — one outlier
// shouldn't cost every other query its early exit.
const WIDE_PAD_THRESHOLD_PX = INDEX_BUCKET_PX * 2;

export class KeepoutIndex {
	private readonly circleBuckets = new Map<string, CircleKeepout[]>();
	private readonly segmentBuckets = new Map<string, SegmentKeepout[]>();
	private readonly wideCircles: CircleKeepout[] = [];
	private readonly wideSegments: SegmentKeepout[] = [];
	private readonly maxPad: number;
	private readonly empty: boolean;

	constructor(
		circles: readonly CircleKeepout[],
		segments: readonly SegmentKeepout[],
	) {
		let maxPad = 0;
		for (const c of circles) {
			if (c.radius > WIDE_PAD_THRESHOLD_PX) {
				this.wideCircles.push(c);
				continue;
			}
			maxPad = Math.max(maxPad, c.radius);
			const { c0, c1, r0, r1 } = indexBucketRange(
				c.x - c.radius,
				c.y - c.radius,
				c.x + c.radius,
				c.y + c.radius,
			);
			for (let row = r0; row <= r1; row++) {
				for (let col = c0; col <= c1; col++) {
					const key = indexBucketKey(col, row);
					const list = this.circleBuckets.get(key);
					if (list) list.push(c);
					else this.circleBuckets.set(key, [c]);
				}
			}
		}
		for (const s of segments) {
			if (s.halfWidth > WIDE_PAD_THRESHOLD_PX) {
				this.wideSegments.push(s);
				continue;
			}
			maxPad = Math.max(maxPad, s.halfWidth);
			// A path segment's own bounding box (not just its thin corridor) can
			// span most of a sprawling world's whole layout — two clusters many
			// buckets apart with a segment drawn diagonally between them would
			// otherwise insert into every bucket in that box, not just the ones
			// the segment's own line actually reaches, ballooning bucket counts
			// (a real repo world with a couple hundred segments measured ~39,000
			// bucket entries this way — most of them nowhere near the segment
			// itself). Walking the line and inserting each sample's own small
			// box instead keeps insertion proportional to the segment's length,
			// not the area of its bounding rectangle.
			for (const key of segmentBucketKeys(s)) {
				const list = this.segmentBuckets.get(key);
				if (list) list.push(s);
				else this.segmentBuckets.set(key, [s]);
			}
		}
		this.maxPad = maxPad;
		this.empty =
			circles.length === 0 &&
			segments.length === 0 &&
			this.wideCircles.length === 0 &&
			this.wideSegments.length === 0;
	}

	/**
	 * Exactly what `keepoutDistance(x, y, circles, segments)` would return
	 * over this index's own circles/segments — unless `saturateAt` is given,
	 * in which case a query point far enough from everything that the true
	 * distance is provably >= `saturateAt` returns `saturateAt` itself rather
	 * than searching further to find the exact (larger) value. Only safe for
	 * a caller whose own decisions saturate below that point too (see
	 * planEdgeScenery's own call sites for why 2048px is safe there — the
	 * forest/meadow zoning and clearance checks it drives never care about
	 * distances anywhere near that large). Without it, a query deep in a
	 * mostly-empty world (its own filler grid's whole point: fill the big
	 * gaps between far-apart clusters, see planEdgeScenery's doc comment) has
	 * to expand its search ring outward until it's *sure* nothing farther out
	 * could still be closer — for a real sprawling repo conversion, exactly
	 * that "far from everything" case is common, not rare, so leaving this
	 * uncapped measurably reintroduces the same area-scaling cost chunking
	 * the bake alone doesn't touch.
	 */
	nearestDistance(
		x: number,
		y: number,
		saturateAt = Number.POSITIVE_INFINITY,
	): number {
		if (this.empty) return Number.POSITIVE_INFINITY;
		let best = Number.POSITIVE_INFINITY;
		for (const c of this.wideCircles) {
			best = Math.min(best, Math.hypot(x - c.x, y - c.y) - c.radius);
		}
		for (const s of this.wideSegments) {
			best = Math.min(best, distToSegment(x, y, s) - s.halfWidth);
		}
		const cx = Math.floor(x / INDEX_BUCKET_PX);
		const cy = Math.floor(y / INDEX_BUCKET_PX);
		const seenCircle = new Set<CircleKeepout>();
		const seenSegment = new Set<SegmentKeepout>();
		// Generous but finite — see this class's doc comment on why the ring
		// search terminates on its own almost always; this only guards the
		// pathological case (a query point in a void far past every keepout,
		// with no `saturateAt` given) from searching forever instead of just
		// returning its best guess so far, which for a point that remote is
		// Infinity either way.
		const maxRing = 512;
		for (let ring = 0; ring <= maxRing; ring++) {
			for (let row = cy - ring; row <= cy + ring; row++) {
				const onHorizontalEdge = row === cy - ring || row === cy + ring;
				for (let col = cx - ring; col <= cx + ring; col++) {
					if (
						ring > 0 &&
						!onHorizontalEdge &&
						col !== cx - ring &&
						col !== cx + ring
					)
						continue; // interior of this ring, already covered by an earlier ring
					const key = indexBucketKey(col, row);
					for (const c of this.circleBuckets.get(key) ?? []) {
						if (seenCircle.has(c)) continue;
						seenCircle.add(c);
						best = Math.min(best, Math.hypot(x - c.x, y - c.y) - c.radius);
					}
					for (const s of this.segmentBuckets.get(key) ?? []) {
						if (seenSegment.has(s)) continue;
						seenSegment.add(s);
						best = Math.min(best, distToSegment(x, y, s) - s.halfWidth);
					}
				}
			}
			if (ring * INDEX_BUCKET_PX - this.maxPad > best) return best;
			if (ring * INDEX_BUCKET_PX - this.maxPad > saturateAt)
				return Math.max(best, saturateAt);
		}
		return best;
	}
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
	// See KeepoutIndex's own doc comment: the filler grid below calls
	// forestScore once per candidate cell, so for a world with hundreds of
	// clusters' worth of circles this is the difference between a fast plan
	// and one that never finishes at real repo-conversion scale.
	const forestScoreIndex = new KeepoutIndex(input.circles, segments);

	const inBounds = (x: number, y: number, fp: Footprint): boolean =>
		y <= bounds.maxY &&
		y - fp.h >= topLimit &&
		x >= bounds.minX &&
		x <= bounds.maxX;

	const forestScore = (x: number, y: number): number => {
		const d = forestScoreIndex.nearestDistance(x, y, KEEPOUT_SATURATION_PX);
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

	// Filler: a jittered grid, each cell deciding by zone what (if anything)
	// grows there. `circles` is frozen from here on (every reserve() above
	// already ran), so one index covers every cell's footprintClear check —
	// same reasoning as forestScoreIndex above, over the reserve-augmented set.
	const fillerIndex = new KeepoutIndex(circles, segments);
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
			if (
				!footprintSamples(x, y, fp).every(
					([sx, sy]) =>
						fillerIndex.nearestDistance(sx, sy, KEEPOUT_SATURATION_PX) >=
						clearance,
				)
			)
				continue;
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

/** Content a world layer adds over the base world, for planLayeredEdgeScenery. */
export interface EdgeSceneryLayer {
	/** The world's bounds with the layer on (they only ever grow). */
	bounds: SceneryBounds;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
}

export interface LayeredSceneryItem extends SceneryItem {
	/** True for scenery planned for ground only the layer exposes. */
	layer?: true;
}

export interface LayeredEdgeSceneryPlan {
	items: LayeredSceneryItem[];
	pointsOfInterest: PointOfInterest[];
	/** Base items dropped because the layer's content stands on them. */
	removed: number;
}

export function boxOverlapsBounds(
	x: number,
	y: number,
	fp: Footprint,
	b: SceneryBounds,
): boolean {
	return (
		x + fp.w / 2 > b.minX &&
		x - fp.w / 2 < b.maxX &&
		y > b.minY &&
		y - fp.h < b.maxY
	);
}

/**
 * Edge scenery that stays put when a world layer comes and goes: the base
 * plan is made from the base world alone (its bounds, clearings, paths and
 * seed), exactly as without the layer. With a layer, base items its content
 * would stand on are dropped, and a second plan, seeded apart, fills only
 * ground outside the base bounds. Planning over the grown bounds instead
 * reshuffled the whole forest, the windmill and the ponds on every toggle.
 */
export function planLayeredEdgeScenery(
	base: EdgeSceneryInput,
	layer: EdgeSceneryLayer | null,
): LayeredEdgeSceneryPlan {
	const plan = planEdgeScenery(base);
	if (!layer) return { ...plan, removed: 0 };
	const clearance = base.clearance ?? DEFAULT_CLEARANCE;
	const clearOfLayer = (x: number, y: number, fp: Footprint): boolean =>
		footprintClear(x, y, fp, layer.circles, layer.segments, clearance);
	const poiFootprint = (kind: PoiKind): Footprint =>
		kind === "mushroom-ring" ? base.footprints.mushroom : base.footprints[kind];
	const kept = plan.items.filter((item) =>
		clearOfLayer(item.x, item.y, base.footprints[item.kind]),
	);
	const pointsOfInterest = plan.pointsOfInterest.filter((poi) =>
		clearOfLayer(poi.x, poi.y, poiFootprint(poi.kind)),
	);
	const grown =
		layer.bounds.minX < base.bounds.minX ||
		layer.bounds.minY < base.bounds.minY ||
		layer.bounds.maxX > base.bounds.maxX ||
		layer.bounds.maxY > base.bounds.maxY;
	const extra: LayeredSceneryItem[] = [];
	if (grown) {
		const outer = planEdgeScenery({
			...base,
			bounds: layer.bounds,
			seed: `${base.seed}#layer`,
			circles: [...base.circles, ...layer.circles],
			segments: [...base.segments, ...layer.segments],
		});
		for (const item of outer.items) {
			if (
				!boxOverlapsBounds(
					item.x,
					item.y,
					base.footprints[item.kind],
					base.bounds,
				)
			)
				extra.push({ ...item, layer: true });
		}
		for (const poi of outer.pointsOfInterest) {
			if (!boxOverlapsBounds(poi.x, poi.y, poiFootprint(poi.kind), base.bounds))
				pointsOfInterest.push(poi);
		}
	}
	return {
		items: [...kept, ...extra].sort((a, b) => a.y - b.y || a.x - b.x),
		pointsOfInterest,
		removed: plan.items.length - kept.length,
	};
}

// --- Lazy, per-chunk planning (M10 stream-bake round 3) --------------------
//
// planEdgeScenery's filler grid above always visits every GRID_CELL_PX cell
// across the *whole world's bounds*, so its own cost scales with world area
// even once KeepoutIndex makes each individual query fast (round 2's fix).
// The functions below replan a 512px chunk's own filler independently, the
// first time that chunk comes within streaming range — so entry cost is
// bounded by the viewport, the same fix already applied to the ground field,
// paths and edge-scenery *bake*. `planEdgeScenery`/`planLayeredEdgeScenery`
// above are kept as they are (ShelfScene's small, fixed cabin count has no
// reason to pay chunk-planning's extra bookkeeping, and the existing tests
// pin their exact whole-world behaviour).
//
// Determinism without an ordering dependency: a filler item's kind/tint/flip
// and even *whether* a cell has anything at all come from
// `hashNoise2D(col, row, seed)` — a pure function of that cell's own absolute
// grid position, not a sequentially-consumed RNG stream. A chunk's plan is
// therefore identical however many other chunks have already been planned,
// in whatever order — there is no "chunk A's plan depends on chunk B having
// gone first" the way a single mulberry32() stream walked across the whole
// grid would have. Filler items were never checked against each other for
// spacing in the original algorithm either (only against clusters/paths/POI
// keepouts), so a chunk's own plan doesn't need its neighbours' filler at
// all — only the shared keepout set (clusters, paths, POI reservations),
// which is computed once for the whole world, not per chunk.
//
// The one thing that does need to stay continuous across a chunk seam is
// `valueNoise`'s smooth field (forestScore's density) — it already is, being
// a pure function of absolute (x, y) and a single shared seed, unaffected by
// which chunk asks for it.

export interface EdgeSceneryWorld {
	bounds: SceneryBounds;
	/** Stable per-world string (`computeScenerySeed`, not the world id — see systems/save.ts) — same world, same forest, every load. */
	seed: string;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
	footprints: Readonly<Record<SceneryKind, Footprint>>;
	clearance?: number;
	windmillSailSpan?: number;
	topMargin?: number;
}

function forestNoiseSeedFor(seed: string): number {
	return hashStringSeed(`edge-scenery-forest:${seed}`);
}

function forestScoreFrom(
	x: number,
	y: number,
	bounds: SceneryBounds,
	distance: number,
	noiseSeed: number,
): number {
	const fromEdge = 1 - edgeDistance(x, y, bounds) / FOREST_EDGE_BAND_PX;
	const fromContent = (distance - FOREST_INTERIOR_START_PX) / 200;
	const n = valueNoise(x, y, NOISE_CELL_PX, noiseSeed) - 0.5;
	return Math.max(fromEdge, fromContent) + n * 0.7;
}

/**
 * A point near the *content* the world actually has — a random cluster/path
 * keepout, offset outward past its own edge — rather than a uniform point
 * over the whole bounds box. Used only for POI candidate search (a handful
 * of attempts total, not a per-area grid), so windmills/ponds/ruins land
 * near where the world's clusters and paths actually are without ever
 * scanning the bounds area to find them. Null for a genuinely empty world
 * (no circles or segments at all) — POIs simply don't place anywhere then,
 * same as the grid-based planner finding nowhere valid.
 */
function randomContentPoint(
	rand: () => number,
	circles: readonly CircleKeepout[],
	segments: readonly SegmentKeepout[],
): [number, number] | null {
	const total = circles.length + segments.length;
	if (total === 0) return null;
	const idx = Math.floor(rand() * total);
	if (idx < circles.length) {
		const c = circles[idx] as CircleKeepout;
		const angle = rand() * Math.PI * 2;
		const dist = c.radius + 60 + rand() * 500;
		return [c.x + Math.cos(angle) * dist, c.y + Math.sin(angle) * dist];
	}
	const s = segments[idx - circles.length] as SegmentKeepout;
	const t = rand();
	const dx = s.bx - s.ax;
	const dy = s.by - s.ay;
	const len = Math.hypot(dx, dy) || 1;
	const px = s.ax + dx * t;
	const py = s.ay + dy * t;
	const side = rand() < 0.5 ? -1 : 1;
	const off = s.halfWidth + 60 + rand() * 400;
	return [px + (-dy / len) * off * side, py + (dx / len) * off * side];
}

export interface EdgeSceneryPoisResult {
	/** Pond/reed/windmill/ruin/mushroom(s)/fallen-log/waymarker sprites — few, so baked wherever their own chunk happens to be (see worldDressing.ts), not streamed themselves. */
	items: SceneryItem[];
	pointsOfInterest: PointOfInterest[];
	/** Keepout circles reserved around each placed POI — fold these into whatever KeepoutIndex the filler chunks use, so filler never grows inside a pond or the windmill's footprint. */
	reserveCircles: CircleKeepout[];
}

/**
 * Whole-world POI placement, but O(clusters + paths) attempts, not O(area):
 * candidates come from `randomContentPoint` (the actual cluster/path layout)
 * instead of a uniform sample over the whole bounds box. Same acceptance
 * criteria (distance-from-content bands, forest score) as the grid-based
 * `planEdgeScenery`, so a world with the same content places its POIs in
 * similar (not bit-identical — see this module's own report) neighbourhoods.
 */
export function planEdgeSceneryPois(
	world: EdgeSceneryWorld,
	forestNoiseSeed: number,
): EdgeSceneryPoisResult {
	const { bounds, footprints } = world;
	const baseSeed = hashStringSeed(`edge-scenery-pois:${world.seed}`);
	const rand = mulberry32(baseSeed);
	const clearance = world.clearance ?? DEFAULT_CLEARANCE;
	const topLimit = bounds.minY + (world.topMargin ?? 0);

	const inBounds = (x: number, y: number, fp: Footprint): boolean =>
		y <= bounds.maxY &&
		y - fp.h >= topLimit &&
		x >= bounds.minX &&
		x <= bounds.maxX;

	const reserves: CircleKeepout[] = [];
	const items: SceneryItem[] = [];
	const pointsOfInterest: PointOfInterest[] = [];
	const push = (kind: SceneryKind, x: number, y: number, tint = 0xffffff) => {
		items.push({ kind, x, y, tint, flipX: rand() < 0.5 });
	};
	const reserve = (x: number, y: number, fp: Footprint, pad: number): void => {
		reserves.push({
			x,
			y: y - fp.h / 2,
			radius: Math.max(fp.w, fp.h) / 2 + pad,
		});
	};

	const findSpot = (
		fp: Footprint,
		pad: number,
		accept: (x: number, y: number, d: number, score: number) => boolean,
		attempts = 80,
	): [number, number] | null => {
		for (let i = 0; i < attempts; i++) {
			const candidate = randomContentPoint(rand, world.circles, world.segments);
			if (!candidate) return null; // no content anywhere in this world to anchor near
			const [x, y] = candidate;
			if (!inBounds(x, y, fp)) continue;
			const allCircles = [...world.circles, ...reserves];
			if (!footprintClear(x, y, fp, allCircles, world.segments, pad)) continue;
			const d = keepoutDistance(x, y, world.circles, world.segments);
			const score = forestScoreFrom(x, y, bounds, d, forestNoiseSeed);
			if (!accept(x, y, d, score)) continue;
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
	const sailSpan = world.windmillSailSpan ?? footprints.windmill.w;
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
	for (let attempt = 0; attempt < 30 && world.segments.length > 0; attempt++) {
		const seg = world.segments[Math.floor(rand() * world.segments.length)];
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
		const allCircles = [...world.circles, ...reserves];
		if (
			!footprintClear(x, y, signFp, allCircles, world.segments, clearance * 0.5)
		)
			continue;
		push("waymarker", x, y);
		pointsOfInterest.push({ kind: "waymarker", x, y });
		reserve(x, y, signFp, 6);
		break;
	}

	return { items, pointsOfInterest, reserveCircles: reserves };
}

export interface FillerChunkParams {
	world: EdgeSceneryWorld;
	/** Built once per world (base keepouts + every POI's reserveCircles) and reused across every chunk — see this section's own doc comment on why chunk-local planning doesn't need per-chunk indices. */
	keepoutIndex: KeepoutIndex;
	forestNoiseSeed: number;
	chunkCol: number;
	chunkRow: number;
}

/**
 * One 512px chunk's filler trees/shrubs/rocks — the chunked replacement for
 * planEdgeScenery's whole-bounds grid loop. Absolute grid cell coordinates
 * (not chunk-local ones) keep the GRID_CELL_PX pitch continuous across a
 * chunk seam even though 512 isn't a multiple of 40; each cell's own
 * kind/tint/flip comes from `hashNoise2D(col, row, ...)`, not a sequential
 * RNG, so this chunk's result never depends on whether any other chunk has
 * been planned yet, or in what order.
 */
export function planFillerChunk(params: FillerChunkParams): SceneryItem[] {
	const { world, keepoutIndex, forestNoiseSeed, chunkCol, chunkRow } = params;
	const { bounds, footprints } = world;
	const clearance = world.clearance ?? DEFAULT_CLEARANCE;
	const topLimit = bounds.minY + (world.topMargin ?? 0);
	const inBounds = (x: number, y: number, fp: Footprint): boolean =>
		y <= bounds.maxY &&
		y - fp.h >= topLimit &&
		x >= bounds.minX &&
		x <= bounds.maxX;
	const cellSeed = hashStringSeed(`edge-scenery-filler:${world.seed}`);

	// 512 isn't a multiple of GRID_CELL_PX (40), so this chunk's own absolute
	// cell range must be the *smallest* integer cols/rows whose cell center
	// actually falls at or past this chunk's own origin (ceil, not floor) —
	// floor here would let a cell from just before the chunk boundary bleed
	// in, duplicating it with the neighbouring chunk's own range.
	const originX = chunkCol * WORLD_CHUNK_SIZE_PX;
	const originY = chunkRow * WORLD_CHUNK_SIZE_PX;
	const startCol = Math.ceil(originX / GRID_CELL_PX);
	const endCol = Math.ceil((originX + WORLD_CHUNK_SIZE_PX) / GRID_CELL_PX);
	const startRow = Math.ceil(originY / GRID_CELL_PX);
	const endRow = Math.ceil((originY + WORLD_CHUNK_SIZE_PX) / GRID_CELL_PX);

	const items: SceneryItem[] = [];
	for (let row = startRow; row < endRow; row++) {
		for (let col = startCol; col < endCol; col++) {
			const jitterX =
				(hashNoise2D(col, row, cellSeed ^ 0x9e3779b9) * 2 - 1) * GRID_JITTER_PX;
			const jitterY =
				(hashNoise2D(col, row, cellSeed ^ 0x85ebca6b) * 2 - 1) * GRID_JITTER_PX;
			const x = col * GRID_CELL_PX + jitterX;
			const y = row * GRID_CELL_PX + jitterY;
			const roll = hashNoise2D(col, row, cellSeed ^ 0xc2b2ae35);
			const pick = hashNoise2D(col, row, cellSeed ^ 0x27d4eb2f);
			const score = forestScoreFrom(
				x,
				y,
				bounds,
				keepoutIndex.nearestDistance(x, y, KEEPOUT_SATURATION_PX),
				forestNoiseSeed,
			);
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
			if (
				!footprintSamples(x, y, fp).every(
					([sx, sy]) =>
						keepoutIndex.nearestDistance(sx, sy, KEEPOUT_SATURATION_PX) >=
						clearance,
				)
			)
				continue;
			const isTree =
				kind === "pine" || kind === "oak" || kind === "blossom-oak";
			const tint = isTree
				? (TREE_TINTS[
						Math.floor(
							hashNoise2D(col, row, cellSeed ^ 0x165667b1) * TREE_TINTS.length,
						)
					] ?? 0xffffff)
				: 0xffffff;
			const flipX = hashNoise2D(col, row, cellSeed ^ 0xd3a2646c) < 0.5;
			items.push({ kind, x, y, tint, flipX });
		}
	}
	return items;
}

/** Everything a streamer needs to plan any chunk's filler, in or out of a world layer, computed once per world (not per chunk) — see buildLazySceneryContext. */
export interface LazySceneryContext {
	base: EdgeSceneryWorld;
	baseIndex: KeepoutIndex;
	baseNoiseSeed: number;
	layer: EdgeSceneryLayer | null;
	/** Set only when the layer actually grows the bounds — see planLayeredEdgeScenery's own doc comment on why an unchanged-bounds layer needs no second plan at all. */
	layerWorld: EdgeSceneryWorld | null;
	layerIndex: KeepoutIndex | null;
	layerNoiseSeed: number;
}

export interface LazySceneryPois {
	/** POI + reed/mushroom sprites, ready to bake wherever their own position's chunk falls. */
	items: LayeredSceneryItem[];
	pointsOfInterest: PointOfInterest[];
}

/**
 * The whole-world part of lazy scenery planning: POIs (base and, if the
 * layer grows the bounds, its own outer set) plus the shared KeepoutIndexes
 * every chunk's filler plan will query. Call once per world/layer state, not
 * per chunk — see this section's own doc comment for why chunk planning
 * itself needs none of this recomputed.
 */
export function buildLazySceneryContext(
	base: EdgeSceneryWorld,
	layer: EdgeSceneryLayer | null,
): { context: LazySceneryContext; pois: LazySceneryPois } {
	const baseNoiseSeed = forestNoiseSeedFor(base.seed);
	const basePois = planEdgeSceneryPois(base, baseNoiseSeed);
	const baseIndex = new KeepoutIndex(
		[...base.circles, ...basePois.reserveCircles],
		base.segments,
	);
	if (!layer) {
		return {
			context: {
				base,
				baseIndex,
				baseNoiseSeed,
				layer: null,
				layerWorld: null,
				layerIndex: null,
				layerNoiseSeed: 0,
			},
			pois: {
				items: basePois.items,
				pointsOfInterest: basePois.pointsOfInterest,
			},
		};
	}

	const clearance = base.clearance ?? DEFAULT_CLEARANCE;
	const clearOfLayer = (x: number, y: number, fp: Footprint): boolean =>
		footprintClear(x, y, fp, layer.circles, layer.segments, clearance);
	const poiFootprint = (kind: PoiKind): Footprint =>
		kind === "mushroom-ring" ? base.footprints.mushroom : base.footprints[kind];
	const keptItems: LayeredSceneryItem[] = basePois.items.filter((i) =>
		clearOfLayer(i.x, i.y, base.footprints[i.kind]),
	);
	const keptPois = basePois.pointsOfInterest.filter((p) =>
		clearOfLayer(p.x, p.y, poiFootprint(p.kind)),
	);

	const grown =
		layer.bounds.minX < base.bounds.minX ||
		layer.bounds.minY < base.bounds.minY ||
		layer.bounds.maxX > base.bounds.maxX ||
		layer.bounds.maxY > base.bounds.maxY;
	let layerWorld: EdgeSceneryWorld | null = null;
	let layerIndex: KeepoutIndex | null = null;
	let layerNoiseSeed = 0;
	if (grown) {
		layerWorld = {
			...base,
			bounds: layer.bounds,
			seed: `${base.seed}#layer`,
			circles: [...base.circles, ...layer.circles],
			segments: [...base.segments, ...layer.segments],
		};
		layerNoiseSeed = forestNoiseSeedFor(layerWorld.seed);
		const outerPois = planEdgeSceneryPois(layerWorld, layerNoiseSeed);
		layerIndex = new KeepoutIndex(
			[...layerWorld.circles, ...outerPois.reserveCircles],
			layerWorld.segments,
		);
		for (const item of outerPois.items) {
			if (
				!boxOverlapsBounds(
					item.x,
					item.y,
					base.footprints[item.kind],
					base.bounds,
				)
			)
				keptItems.push({ ...item, layer: true });
		}
		for (const p of outerPois.pointsOfInterest) {
			if (!boxOverlapsBounds(p.x, p.y, poiFootprint(p.kind), base.bounds))
				keptPois.push(p);
		}
	}

	return {
		context: {
			base,
			baseIndex,
			baseNoiseSeed,
			layer,
			layerWorld,
			layerIndex,
			layerNoiseSeed,
		},
		pois: { items: keptItems, pointsOfInterest: keptPois },
	};
}

/** True if any part of the given chunk's own 512px square could fall within `bounds` — used to decide whether a chunk is a "base" chunk (always base-seeded, just filtered when the layer is on) or a "grown-bounds-only" chunk (only ever reachable/visible with the layer on, so always layer-seeded). */
function chunkOverlapsBounds(
	chunkCol: number,
	chunkRow: number,
	bounds: SceneryBounds,
): boolean {
	const originX = chunkCol * WORLD_CHUNK_SIZE_PX;
	const originY = chunkRow * WORLD_CHUNK_SIZE_PX;
	return (
		originX + WORLD_CHUNK_SIZE_PX > bounds.minX &&
		originX < bounds.maxX &&
		originY + WORLD_CHUNK_SIZE_PX > bounds.minY &&
		originY < bounds.maxY
	);
}

/**
 * One chunk's filler, aware of the layer state: a chunk inside the base
 * world's bounds is *always* planned from `context.base` (identical in and
 * out of the realm, per this task's own guarantee) and only filtered
 * (never added to) once the layer stands on part of it; a chunk reachable
 * only because the layer grew the bounds is planned from `context.layerWorld`
 * instead, marked `layer: true`, and dropped if it actually overlaps the
 * base bounds (avoiding double coverage at the seam — same rule
 * buildLazySceneryContext already applies to POIs).
 */
export function planFillerChunkForContext(
	context: LazySceneryContext,
	chunkCol: number,
	chunkRow: number,
): LayeredSceneryItem[] {
	if (
		!context.layer ||
		chunkOverlapsBounds(chunkCol, chunkRow, context.base.bounds)
	) {
		let items = planFillerChunk({
			world: context.base,
			keepoutIndex: context.baseIndex,
			forestNoiseSeed: context.baseNoiseSeed,
			chunkCol,
			chunkRow,
		});
		if (context.layer) {
			const clearance = context.base.clearance ?? DEFAULT_CLEARANCE;
			const layer = context.layer;
			items = items.filter((i) =>
				footprintClear(
					i.x,
					i.y,
					context.base.footprints[i.kind],
					layer.circles,
					layer.segments,
					clearance,
				),
			);
		}
		return items;
	}
	// Grown-bounds-only chunk: buildLazySceneryContext only leaves
	// layerWorld/layerIndex null when the layer never grows the bounds, in
	// which case chunkOverlapsBounds(base.bounds) is always true above (the
	// layer's own bounds can only ever grow, never shrink, past the base's),
	// so this branch is unreachable with either null — asserted, not guarded,
	// so a real bug here throws instead of silently planning nothing.
	if (!context.layerWorld || !context.layerIndex) {
		throw new Error(
			"planFillerChunkForContext: grown-bounds chunk requested but the context has no layer world",
		);
	}
	const items = planFillerChunk({
		world: context.layerWorld,
		keepoutIndex: context.layerIndex,
		forestNoiseSeed: context.layerNoiseSeed,
		chunkCol,
		chunkRow,
	});
	return items
		.filter(
			(i) =>
				!boxOverlapsBounds(
					i.x,
					i.y,
					context.base.footprints[i.kind],
					context.base.bounds,
				),
		)
		.map((i) => ({ ...i, layer: true }) as LayeredSceneryItem);
}
