import { hashNoise2D, hashStringSeed } from "../systems/deterministicRandom.js";

export interface RibbonPoint {
	x: number;
	y: number;
}

export interface RibbonSegment {
	id: string;
	from: RibbonPoint;
	to: RibbonPoint;
}

export interface Cobble {
	x: number;
	y: number;
	variant: number;
}

export interface Plaza {
	x: number;
	y: number;
	radius: number;
}

export interface RibbonPlanOptions {
	/** Radius of the sand edge disc texture — the path's outer half-width. */
	edgeRadius: number;
	/** Radius of the mortar-bed disc texture, inside the edge. */
	bedRadius: number;
	cobbleVariants: number;
	/** Nodes where at least this many paths meet get a round plaza. */
	plazaMinDegree?: number;
}

export interface RibbonPlan {
	edgeStamps: RibbonPoint[];
	bedStamps: RibbonPoint[];
	cobbles: Cobble[];
	plazas: Plaza[];
}

const DISC_STEP_RATIO = 0.35;
const COBBLE_PITCH = 7;
const COBBLE_MIN_GAP = 5.5;
/** Plaza radius as a multiple of the path's half-width. */
const PLAZA_RADIUS_RATIO = 2.1;

function nodeKey(p: RibbonPoint): string {
	return `${Math.round(p.x)},${Math.round(p.y)}`;
}

function discsAlong(
	from: RibbonPoint,
	to: RibbonPoint,
	step: number,
	out: RibbonPoint[],
): void {
	const len = Math.hypot(to.x - from.x, to.y - from.y);
	const n = Math.max(1, Math.ceil(len / step));
	for (let i = 0; i <= n; i++) {
		out.push({
			x: from.x + ((to.x - from.x) * i) / n,
			y: from.y + ((to.y - from.y) * i) / n,
		});
	}
}

function discsFillingCircle(
	c: Plaza,
	discRadius: number,
	step: number,
	out: RibbonPoint[],
): void {
	const inner = Math.max(0, c.radius - discRadius);
	for (let y = -inner; y <= inner; y += step) {
		for (let x = -inner; x <= inner; x += step) {
			if (x * x + y * y <= inner * inner) out.push({ x: c.x + x, y: c.y + y });
		}
	}
}

/**
 * Plans a world's path network as a ribbon instead of per-segment strip
 * stamps. The old baker rotated a rectangular cobble strip to each segment's
 * angle and laid strips end to end, so wherever two segments met — at every
 * cluster, and five or six at once around the bonfire — square strip ends
 * and their sand borders crossed over each other ("clunky joints", 2026-09-28
 * playtest). Here every path is a chain of round discs, drawn in passes
 * across ALL segments (every edge disc, then every bed disc, then every
 * cobble), so segments union into one shape with round corners, one
 * consistent width, and no border line ever crossing another path's bed.
 * Busy junctions get a round plaza of concentric cobble rings, laid before
 * the segment cobbles so it claims the junction center.
 */
export function planPathRibbon(
	segments: readonly RibbonSegment[],
	opts: RibbonPlanOptions,
): RibbonPlan {
	const degree = new Map<string, { p: RibbonPoint; n: number }>();
	for (const seg of segments) {
		for (const p of [seg.from, seg.to]) {
			const key = nodeKey(p);
			const entry = degree.get(key);
			if (entry) entry.n++;
			else degree.set(key, { p, n: 1 });
		}
	}
	const minDegree = opts.plazaMinDegree ?? 3;
	const plazas: Plaza[] = [...degree.values()]
		.filter((e) => e.n >= minDegree)
		.map((e) => ({
			x: e.p.x,
			y: e.p.y,
			radius: opts.edgeRadius * PLAZA_RADIUS_RATIO,
		}));

	const edgeStamps: RibbonPoint[] = [];
	const bedStamps: RibbonPoint[] = [];
	const edgeStep = opts.edgeRadius * DISC_STEP_RATIO;
	const bedStep = opts.bedRadius * DISC_STEP_RATIO;
	const inset = opts.edgeRadius - opts.bedRadius;
	for (const seg of segments) {
		discsAlong(seg.from, seg.to, edgeStep, edgeStamps);
		discsAlong(seg.from, seg.to, bedStep, bedStamps);
	}
	for (const plaza of plazas) {
		discsFillingCircle(plaza, opts.edgeRadius, edgeStep, edgeStamps);
		discsFillingCircle(
			{ ...plaza, radius: plaza.radius - inset },
			opts.bedRadius,
			bedStep,
			bedStamps,
		);
	}

	// Spatial hash so overlapping segments/plazas never double up cobbles.
	const cell = COBBLE_MIN_GAP;
	const taken = new Map<string, Cobble[]>();
	const cobbles: Cobble[] = [];
	const tryPlace = (x: number, y: number, seed: number): void => {
		const cx = Math.floor(x / cell);
		const cy = Math.floor(y / cell);
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				for (const other of taken.get(`${cx + dx},${cy + dy}`) ?? []) {
					if (Math.hypot(other.x - x, other.y - y) < COBBLE_MIN_GAP) return;
				}
			}
		}
		const variant = Math.floor(
			hashNoise2D(Math.round(x), Math.round(y), seed) * opts.cobbleVariants,
		);
		const cobble = { x, y, variant };
		cobbles.push(cobble);
		const key = `${cx},${cy}`;
		const list = taken.get(key);
		if (list) list.push(cobble);
		else taken.set(key, [cobble]);
	};

	// Cobble centers stay far enough inside the bed that a whole stone fits.
	const usable = opts.bedRadius - 4.5;
	for (const plaza of plazas) {
		const seed = hashStringSeed(`plaza:${nodeKey(plaza)}`);
		tryPlace(plaza.x, plaza.y, seed);
		for (
			let r = COBBLE_PITCH;
			r <= plaza.radius - inset - 4.5;
			r += COBBLE_PITCH
		) {
			const count = Math.max(6, Math.floor((Math.PI * 2 * r) / COBBLE_PITCH));
			const offset = (r / COBBLE_PITCH) * 0.5;
			for (let i = 0; i < count; i++) {
				const a = ((i + offset) / count) * Math.PI * 2;
				tryPlace(plaza.x + Math.cos(a) * r, plaza.y + Math.sin(a) * r, seed);
			}
		}
	}
	for (const seg of segments) {
		const seed = hashStringSeed(seg.id);
		const dx = seg.to.x - seg.from.x;
		const dy = seg.to.y - seg.from.y;
		const len = Math.hypot(dx, dy);
		if (len === 0) continue;
		const ux = dx / len;
		const uy = dy / len;
		const rows = Math.max(1, Math.floor((usable * 2) / COBBLE_PITCH) + 1);
		for (let row = 0; row < rows; row++) {
			const across =
				-usable + (rows === 1 ? usable : (row * usable * 2) / (rows - 1));
			// Brick-style stagger between rows.
			const start = row % 2 === 0 ? 0 : COBBLE_PITCH / 2;
			for (let along = start; along <= len; along += COBBLE_PITCH) {
				const j = (hashNoise2D(row, Math.round(along), seed) - 0.5) * 1.6;
				tryPlace(
					seg.from.x + ux * (along + j) - uy * across,
					seg.from.y + uy * (along + j) + ux * across,
					seed,
				);
			}
		}
	}

	return { edgeStamps, bedStamps, cobbles, plazas };
}
