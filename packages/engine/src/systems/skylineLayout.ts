import { hashStringSeed, mulberry32 } from "./deterministicRandom.js";

export type SkylineLayer = "far" | "mid" | "near";
export type SkylinePieceName =
	| "castle"
	| "watchtower"
	| "village"
	| "hill"
	| "treeline";

export interface SkylineElement {
	piece: SkylinePieceName;
	layer: SkylineLayer;
	/** Horizontal center in the layer's own parallax space (see parallaxSpan). */
	u: number;
	scale: number;
	flipX: boolean;
}

/**
 * Horizontal scroll factor per layer — the farther, the slower it slides as
 * the camera pans, which is the whole depth cue on a camera that never
 * moves vertically relative to the horizon. `near` is 1 (locked to the
 * world) because the treeline is where the skyline meets the edge forest.
 */
export const LAYER_SCROLL_FACTOR: Readonly<Record<SkylineLayer, number>> = {
	far: 0.45,
	mid: 0.7,
	near: 1,
};

/**
 * The span of parallax-space x a layer must cover so no camera position
 * within [scrollMin, scrollMax] ever sees past its ends. An object with
 * scroll factor `sf` at x = u is drawn at screen x = u - scrollX * sf.
 */
export function parallaxSpan(
	scrollMin: number,
	scrollMax: number,
	viewWidth: number,
	scrollFactor: number,
	pad: number,
): [number, number] {
	const lo = Math.min(scrollMin, scrollMax);
	const hi = Math.max(scrollMin, scrollMax);
	return [lo * scrollFactor - pad, hi * scrollFactor + viewWidth + pad];
}

/** Parallax-space x that lands on screen center when the camera is centered in its scroll range — where the castle goes, so it's framed when the player is mid-world. */
export function parallaxCenter(
	scrollMin: number,
	scrollMax: number,
	viewWidth: number,
	scrollFactor: number,
): number {
	return ((scrollMin + scrollMax) / 2) * scrollFactor + viewWidth / 2;
}

export interface SkylinePlanInput {
	seed: string;
	scrollMin: number;
	scrollMax: number;
	viewWidth: number;
	/** Native pixel widths of each piece's texture, so repeats tile without gaps. */
	widths: Readonly<Record<SkylinePieceName, number>>;
	pad?: number;
}

/** Every repeating piece is laid down at no more than this fraction of its own width apart, so neighbors always overlap — a gap in a treeline reads as a rendering bug, not a clearing. */
const REPEAT_OVERLAP = 0.72;

/**
 * Deterministic horizon layout: one castle centered in the far layer with a
 * village at its feet on each side and a couple of lone watchtowers further
 * out; rolling hills overlapping across the mid layer; a continuous conifer
 * treeline across the near layer. Pure so the "same world, same skyline"
 * and "no gaps" properties are testable.
 */
export function planSkyline(input: SkylinePlanInput): SkylineElement[] {
	const rand = mulberry32(hashStringSeed(`skyline:${input.seed}`));
	const pad = input.pad ?? 400;
	const out: SkylineElement[] = [];

	const far = LAYER_SCROLL_FACTOR.far;
	const [farLo, farHi] = parallaxSpan(
		input.scrollMin,
		input.scrollMax,
		input.viewWidth,
		far,
		pad,
	);
	const castleU =
		parallaxCenter(input.scrollMin, input.scrollMax, input.viewWidth, far) +
		(rand() - 0.5) * input.viewWidth * 0.3;
	out.push({
		piece: "castle",
		layer: "far",
		u: castleU,
		scale: 1,
		flipX: rand() < 0.5,
	});
	const castleHalf = input.widths.castle / 2;
	const villageHalf = input.widths.village / 2;
	out.push({
		piece: "village",
		layer: "far",
		u: castleU - castleHalf - villageHalf * 0.6,
		scale: 1,
		flipX: false,
	});
	out.push({
		piece: "village",
		layer: "far",
		u: castleU + castleHalf + villageHalf * 0.6,
		scale: 1,
		flipX: true,
	});
	for (const side of [-1, 1]) {
		const dist = castleHalf + villageHalf * 2 + 80 + rand() * 260;
		const u = castleU + side * dist;
		if (u > farLo && u < farHi) {
			out.push({
				piece: "watchtower",
				layer: "far",
				u,
				scale: 0.8 + rand() * 0.3,
				flipX: rand() < 0.5,
			});
		}
	}

	const repeatAcross = (
		piece: SkylinePieceName,
		layer: SkylineLayer,
		minScale: number,
		maxScale: number,
	) => {
		const [lo, hi] = parallaxSpan(
			input.scrollMin,
			input.scrollMax,
			input.viewWidth,
			LAYER_SCROLL_FACTOR[layer],
			pad,
		);
		let u = lo;
		while (u < hi) {
			const scale = minScale + rand() * (maxScale - minScale);
			out.push({ piece, layer, u, scale, flipX: rand() < 0.5 });
			u +=
				input.widths[piece] * scale * (0.5 + rand() * (REPEAT_OVERLAP - 0.5));
		}
		out.push({ piece, layer, u: hi, scale: maxScale, flipX: rand() < 0.5 });
	};
	repeatAcross("hill", "mid", 1.1, 1.9);
	repeatAcross("treeline", "near", 0.9, 1.3);
	return out;
}

/**
 * The skyline for a scroll range that has grown past the base world's (a
 * world layer on): the base plan, untouched, plus hills and treeline
 * seeded apart that cover only the parallax span the base plan doesn't.
 * Replanning over the grown range moved the castle and reshuffled every
 * piece on each toggle.
 */
export function planGrownSkyline(
	base: SkylinePlanInput,
	grown: { scrollMin: number; scrollMax: number },
): SkylineElement[] {
	const out = planSkyline(base);
	if (grown.scrollMin >= base.scrollMin && grown.scrollMax <= base.scrollMax)
		return out;
	const rand = mulberry32(hashStringSeed(`skyline:${base.seed}#grown`));
	const pad = base.pad ?? 400;
	const extend = (
		piece: SkylinePieceName,
		layer: SkylineLayer,
		minScale: number,
		maxScale: number,
	) => {
		const sf = LAYER_SCROLL_FACTOR[layer];
		const [baseLo, baseHi] = parallaxSpan(
			base.scrollMin,
			base.scrollMax,
			base.viewWidth,
			sf,
			pad,
		);
		const [lo, hi] = parallaxSpan(
			Math.min(grown.scrollMin, base.scrollMin),
			Math.max(grown.scrollMax, base.scrollMax),
			base.viewWidth,
			sf,
			pad,
		);
		const fill = (from: number, to: number, dir: 1 | -1) => {
			let u = from;
			while (dir > 0 ? u < to : u > to) {
				const scale = minScale + rand() * (maxScale - minScale);
				u +=
					dir *
					base.widths[piece] *
					scale *
					(0.5 + rand() * (REPEAT_OVERLAP - 0.5));
				out.push({ piece, layer, u, scale, flipX: rand() < 0.5 });
			}
		};
		if (lo < baseLo) fill(baseLo, lo, -1);
		if (hi > baseHi) fill(baseHi, hi, 1);
	};
	extend("hill", "mid", 1.1, 1.9);
	extend("treeline", "near", 0.9, 1.3);
	return out;
}
