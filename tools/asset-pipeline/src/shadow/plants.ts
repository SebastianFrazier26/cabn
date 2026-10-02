import { type Grid, outlineGrid } from "../pixel-shapes.js";
import { type Pen, pen } from "../world-art/pen.js";
import type { NetherPalette } from "./palette.js";

/**
 * The realm's plants, drawn dead (2026-09-29): bare twisted trees, ember-
 * cracked stumps, withered twigs and ember or soul flowers on dead stalks.
 * They replace the first nether pass's recolours of the green shapes, which
 * still read as living bushes and canopies however charred their colours.
 * Each is drawn on its original's pen (same base-unit size, k and pad), so
 * the canvas is exactly the original's and the trunk or base sits where the
 * original's did: the engine swaps textures without moving anything.
 */

type N = NetherPalette["n"];
type Pt = readonly [number, number];

interface Bark {
	dark: number;
	base: number;
	lit: number;
}

const bark = (n: N): Bark => ({
	dark: n.char,
	base: n.charLight,
	lit: n.ashMid,
});

/** The props' pen (world-art/props.ts: PROP_K 3, one pad cell for the ink outline). */
const propPen = (w: number, h: number) => pen(w, h, 3, 1);
/** The edge scenery's pen (world-art/scenery.ts: SCENERY_K 3, no pad). */
const sceneryPen = (w: number, h: number) => pen(w, h, 3);

/**
 * A tapering limb along a quadratic curve, `w0` wide at `a` and `w1` at `b`,
 * lit on its up-left edge. Below a fine cell it is a one-cell twig line,
 * which is what keeps the tips crisp instead of vanishing.
 */
function limb(
	p: Pen,
	a: Pt,
	c: Pt,
	b: Pt,
	w0: number,
	w1: number,
	t: Bark,
): void {
	const len =
		Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
	const steps = Math.max(2, Math.ceil(len * p.k * 1.5));
	const pts: [number, number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const s = i / steps;
		const u = 1 - s;
		pts.push([
			u * u * a[0] + 2 * u * s * c[0] + s * s * b[0],
			u * u * a[1] + 2 * u * s * c[1] + s * s * b[1],
			(w0 + (w1 - w0) * s) / 2,
		]);
	}
	for (const [x, y, r] of pts) {
		if (r * p.k < 0.75) p.fine(p.at(x), p.at(y), t.base);
		else p.ellipse(x, y, r, r, t.base);
	}
	for (const [x, y, r] of pts) {
		if (r * p.k < 1.5) continue;
		p.ellipse(x + r * 0.45, y + r * 0.3, r * 0.5, r * 0.5, t.dark);
	}
	for (const [x, y, r] of pts) {
		if (r * p.k < 1.5) continue;
		p.ellipse(x - r * 0.45, y - r * 0.35, r * 0.4, r * 0.4, t.lit);
	}
}

/** A straight twig (a limb with its control point at the midpoint). */
function twig(p: Pen, a: Pt, b: Pt, w0: number, w1: number, t: Bark): void {
	limb(p, a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, w0, w1, t);
}

/** Fine-cell ember crack: a jagged run of hot cells, brightest in the middle. */
function crack(p: Pen, cells: readonly Pt[], n: N): void {
	cells.forEach(([x, y], i) => {
		const mid = i > 0 && i < cells.length - 1;
		p.fine(
			p.at(x),
			p.at(y),
			mid && i % 2 === 1 ? n.emberYellow : n.emberOrange,
		);
	});
}

/** A 2x2 fine-cell blossom (bright centre cell up-left), for ember and soul flowers on twig tips. */
function bud(p: Pen, x: number, y: number, petal: number, heart: number): void {
	const fx = p.at(x);
	const fy = p.at(y);
	p.fine(fx, fy, heart);
	p.fine(fx + 1, fy, petal);
	p.fine(fx, fy + 1, petal);
	p.fine(fx + 1, fy + 1, petal);
}

/** A 3x3 fine-cell flower: four petals round a heart, darker petal tips in the corners. */
function bloom(
	p: Pen,
	x: number,
	y: number,
	petal: number,
	heart: number,
	rim: number,
): void {
	const fx = p.at(x);
	const fy = p.at(y);
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++)
			p.fine(fx + dx, fy + dy, dx !== 0 && dy !== 0 ? rim : petal);
	p.fine(fx, fy, heart);
}

/** A curled dead leaf: two fine cells, dry on top. */
function deadLeaf(p: Pen, x: number, y: number, n: N): void {
	const fx = p.at(x);
	const fy = p.at(y);
	p.fine(fx, fy, n.boneShadow);
	p.fine(fx + 1, fy, n.charLight);
}

// --- Trees -----------------------------------------------------------------

interface TreeShape {
	trunk: [Pt, Pt, Pt, number, number];
	roots: [Pt, Pt, Pt][];
	limbs: [Pt, Pt, Pt, number, number][];
	twigs: [Pt, Pt][];
	cracks: Pt[][];
	/** The glowing hollow in the trunk. */
	knot: [number, number, number, number] | null;
}

function drawTree(p: Pen, s: TreeShape, n: N): void {
	const t = bark(n);
	for (const [a, c, b] of s.roots) limb(p, a, c, b, 1.4, 0.4, t);
	const [ta, tc, tb, tw0, tw1] = s.trunk;
	limb(p, ta, tc, tb, tw0, tw1, t);
	for (const [a, c, b, w0, w1] of s.limbs) limb(p, a, c, b, w0, w1, t);
	for (const [a, b] of s.twigs) twig(p, a, b, 0.5, 0.2, t);
	if (s.knot) {
		const [x, y, rx, ry] = s.knot;
		p.ellipse(x, y, rx, ry, n.netherCrack);
		p.ellipse(x, y + ry * 0.25, rx * 0.55, ry * 0.55, n.emberRed);
		p.fine(p.at(x), p.at(y + ry * 0.2), n.emberOrange);
	}
	for (const c of s.cracks) crack(p, c, n);
}

/** Tips of every twig and limb, for blossoms. */
function tips(s: TreeShape): Pt[] {
	return [...s.limbs.map((l) => l[2]), ...s.twigs.map((t) => t[1])];
}

/** The edge forest's oak (scenery.ts: 20x26, trunk centred at x 10): a bare, gnarled dead oak. */
const OAK: TreeShape = {
	trunk: [[10, 26], [9.2, 20.5], [10.2, 14.5], 3.2, 1.9],
	roots: [
		[
			[9.6, 24.6],
			[7.6, 25.6],
			[6, 26],
		],
		[
			[10.4, 24.4],
			[12.6, 25.4],
			[14.2, 26],
		],
	],
	limbs: [
		[[10, 16], [6.4, 14.6], [3.4, 9.4], 1.7, 0.6],
		[[10.4, 15.4], [14.6, 13.6], [16.8, 8.2], 1.6, 0.6],
		[[10.2, 15], [11.4, 10], [9.4, 4.4], 1.4, 0.5],
		[[10.6, 17.6], [13.8, 17.8], [16, 15.4], 0.9, 0.4],
	],
	twigs: [
		[
			[5, 11.6],
			[1.8, 8.4],
		],
		[
			[4.2, 10.4],
			[5.4, 6],
		],
		[
			[3.6, 9.8],
			[2.6, 5.8],
		],
		[
			[15.6, 10.8],
			[18.6, 7.6],
		],
		[
			[16.4, 9],
			[15, 4.8],
		],
		[
			[16.8, 8.4],
			[18.2, 5],
		],
		[
			[10.2, 7.6],
			[7.4, 3.2],
		],
		[
			[10, 6.6],
			[12.8, 2.6],
		],
		[
			[9.6, 4.8],
			[10, 1.4],
		],
		[
			[15.6, 15.8],
			[18, 14.4],
		],
	],
	cracks: [
		[
			[10.4, 18.4],
			[10.1, 19.4],
			[10.5, 20.4],
			[10.2, 21.4],
			[10.6, 22.4],
		],
	],
	knot: [9.4, 16.8, 0.7, 0.9],
};

export function deadOak(n: N, ink: number, blossoms: boolean): Grid {
	const p = sceneryPen(20, 26);
	drawTree(p, OAK, n);
	outlineGrid(p.g, ink);
	if (blossoms) {
		tips(OAK).forEach(([x, y], i) => {
			const soul = i % 4 === 3;
			bud(
				p,
				x - 0.3,
				y - 0.3,
				soul ? n.soulCyan : n.emberOrange,
				soul ? n.ashLight : n.emberYellow,
			);
		});
	}
	return p.g;
}

/** tree-small (props.ts: 16x24, trunk centred at x 8): a thin forked sapling, dead, a few ember buds left on it. */
const SMALL_TREE: TreeShape = {
	trunk: [[8, 24], [7.4, 18], [8.2, 12.6], 2.6, 1.3],
	roots: [
		[
			[7.6, 22.8],
			[6, 23.6],
			[4.8, 24],
		],
		[
			[8.4, 22.8],
			[10, 23.6],
			[11.2, 24],
		],
	],
	limbs: [
		[[8, 14], [5, 12], [3.4, 6.4], 1.2, 0.4],
		[[8.2, 13.2], [11.4, 11.4], [12.6, 5.8], 1.1, 0.4],
		[[8.2, 12.8], [8.6, 8.6], [7.6, 3], 1, 0.4],
	],
	twigs: [
		[
			[4.2, 9],
			[1.8, 6.8],
		],
		[
			[3.8, 7.6],
			[4.8, 4],
		],
		[
			[12, 8.2],
			[14.2, 6.4],
		],
		[
			[12.4, 6.6],
			[11.2, 3.2],
		],
		[
			[8, 5.6],
			[9.8, 2],
		],
		[
			[7.6, 16.4],
			[5.2, 15.4],
		],
	],
	cracks: [
		[
			[8.2, 17.6],
			[8, 18.6],
			[8.3, 19.6],
			[8.1, 20.6],
		],
	],
	knot: null,
};

export function deadTreeSmall(n: N, ink: number): Grid {
	const p = propPen(16, 24);
	drawTree(p, SMALL_TREE, n);
	outlineGrid(p.g, ink);
	tips(SMALL_TREE).forEach(([x, y], i) => {
		if (i % 2 === 0) bud(p, x - 0.3, y - 0.3, n.emberOrange, n.emberYellow);
	});
	return p.g;
}

/** tree-large (props.ts: 22x34, trunk centred at x 11): an old hollow giant, split and smouldering inside. */
const LARGE_TREE: TreeShape = {
	trunk: [[11, 34], [10, 26], [11.2, 18.6], 4.4, 2.6],
	roots: [
		[
			[10.2, 31.6],
			[7.4, 33.2],
			[5, 34],
		],
		[
			[11.8, 31.6],
			[14.8, 33.2],
			[17, 34],
		],
		[
			[10.6, 32.4],
			[9.4, 33.6],
			[8.6, 34],
		],
	],
	limbs: [
		[[10.8, 21], [6, 19.2], [3.4, 11.6], 2.2, 0.7],
		[[11.4, 20.4], [16.6, 18.6], [19, 10.8], 2.1, 0.7],
		[[11.2, 19.4], [12.6, 13], [10.4, 5.2], 1.8, 0.6],
		[[10.6, 24], [6.8, 23.6], [4.2, 20.8], 1.1, 0.4],
		[[11.6, 23.4], [15.4, 23], [17.6, 20], 1, 0.4],
	],
	twigs: [
		[
			[4.8, 15],
			[1.6, 11.4],
		],
		[
			[4, 13],
			[5.4, 8],
		],
		[
			[3.6, 12],
			[2.2, 7.6],
		],
		[
			[17.8, 14.4],
			[20.6, 11],
		],
		[
			[18.6, 12.4],
			[16.8, 7.4],
		],
		[
			[19, 11.2],
			[20.2, 6.8],
		],
		[
			[11.8, 10],
			[8.2, 5],
		],
		[
			[11.2, 8.4],
			[14.4, 3.6],
		],
		[
			[10.6, 5.8],
			[11.2, 1.4],
		],
		[
			[4.6, 21.4],
			[2, 19.6],
		],
		[
			[17.2, 20.6],
			[19.8, 18.8],
		],
	],
	cracks: [
		[
			[11.8, 26.4],
			[11.4, 27.4],
			[11.9, 28.4],
			[11.5, 29.4],
			[12, 30.4],
		],
		[
			[9.8, 20.4],
			[10.1, 21.4],
			[9.8, 22.4],
		],
	],
	knot: [10.4, 24.2, 1, 1.5],
};

export function deadTreeLarge(n: N, ink: number): Grid {
	const p = propPen(22, 34);
	drawTree(p, LARGE_TREE, n);
	outlineGrid(p.g, ink);
	return p.g;
}

// --- Low plants --------------------------------------------------------------

/** A charred heap at a plant's foot, embers glinting in it. */
function ashHeap(
	p: Pen,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	n: N,
	embers: readonly Pt[],
): void {
	p.ellipse(cx, cy, rx, ry, n.char);
	p.ellipse(cx - rx * 0.15, cy - ry * 0.3, rx * 0.7, ry * 0.55, n.charLight);
	p.ellipse(cx - rx * 0.35, cy - ry * 0.5, rx * 0.3, ry * 0.3, n.ashMid);
	for (const [x, y] of embers) p.fine(p.at(x), p.at(y), n.emberOrange);
}

/** bush (props.ts: 14x10): a withered tangle of bare twigs over an ash heap. */
export function deadBush(n: N, ink: number): Grid {
	const p = propPen(14, 10);
	const t = bark(n);
	const root: Pt = [7, 8.4];
	for (const [c, b, w] of [
		[[4.6, 6.8], [1.8, 3.6], 0.9],
		[[5.6, 5.4], [4.4, 1.4], 0.9],
		[[7.2, 5], [7.6, 0.8], 1],
		[[8.8, 5.6], [10.4, 1.6], 0.9],
		[[9.8, 7], [12.4, 3.8], 0.9],
	] as const)
		limb(p, root, c, b, w, 0.3, t);
	for (const [a, b] of [
		[
			[3.2, 5.4],
			[1.2, 5],
		],
		[
			[4.8, 3.4],
			[3.2, 1.8],
		],
		[
			[7.4, 3],
			[9, 1.4],
		],
		[
			[10.8, 3.8],
			[12.4, 2.4],
		],
		[
			[11, 5],
			[12.8, 5.4],
		],
	] as const)
		twig(p, a, b, 0.4, 0.2, t);
	ashHeap(p, 7, 8.6, 5, 1.4, n, [
		[5, 8.8],
		[8.6, 9.2],
		[10.4, 8.6],
	]);
	outlineGrid(p.g, ink);
	for (const [x, y] of [
		[1.6, 3.4],
		[10.6, 1.4],
		[12.6, 5],
	] as const)
		deadLeaf(p, x, y, n);
	return p.g;
}

/** hedge (props.ts: 22x12): a row of burnt-off stumps, broken tops glowing, charred brush between them. */
export function deadHedge(n: N, ink: number): Grid {
	const p = propPen(22, 12);
	const t = bark(n);
	p.rect(1, 9.6, 20, 1.4, n.char);
	p.rect(1.2, 9.4, 19.6, 0.67, n.charLight);
	for (const [a, c, b] of [
		[
			[3, 10],
			[4.4, 6.6],
			[6.4, 4.6],
		],
		[
			[8, 10],
			[9.4, 7],
			[11.6, 5.8],
		],
		[
			[13, 10],
			[14.4, 7.4],
			[16.8, 5.4],
		],
		[
			[10, 10],
			[8.8, 7.6],
			[6.8, 6.8],
		],
		[
			[17, 10],
			[15.6, 7],
			[13.6, 6.6],
		],
	] as const)
		limb(p, a, c, b, 0.6, 0.25, t);
	const stumps: [number, number, number][] = [
		[3.4, 4.6, 2.6],
		[8.4, 3.2, 2.8],
		[13.6, 4.2, 2.6],
		[18.6, 3.6, 2.6],
	];
	for (const [x, top, w] of stumps) {
		limb(
			p,
			[x, 10.4],
			[x - 0.2, (top + 10.4) / 2],
			[x + 0.1, top + 0.6],
			w,
			w * 0.85,
			t,
		);
		// A snapped, jagged top rather than a clean cut.
		p.tri(
			x - w * 0.42,
			top + 0.8,
			x + w * 0.1,
			top + 0.8,
			x - w * 0.25,
			top,
			t.base,
		);
		p.tri(
			x - w * 0.05,
			top + 0.8,
			x + w * 0.42,
			top + 0.8,
			x + w * 0.3,
			top - 0.3,
			t.dark,
		);
		p.rect(x - w * 0.3, top + 0.8, w * 0.6, 0.34, n.emberRed);
		p.rect(x - w * 0.1, top + 0.8, w * 0.25, 0.34, n.emberYellow);
	}
	crack(
		p,
		[
			[8.8, 5.4],
			[8.5, 6.4],
			[8.9, 7.4],
			[8.6, 8.4],
		],
		n,
	);
	crack(
		p,
		[
			[18.9, 5.8],
			[18.6, 6.8],
			[19, 7.8],
		],
		n,
	);
	outlineGrid(p.g, ink);
	return p.g;
}

/** shrub / berry-shrub (scenery.ts: 13x10): a sparse withered clump; the berry shrub keeps ember berries. */
export function deadShrub(n: N, ink: number, berries: boolean): Grid {
	const p = sceneryPen(13, 10);
	const t = bark(n);
	const root: Pt = [6.5, 8.6];
	for (const [c, b, w] of [
		[[4.4, 7.2], [2, 4.4], 0.8],
		[[5.8, 6], [5, 2.2], 0.8],
		[[7.2, 5.6], [8, 1.8], 0.8],
		[[8.6, 7], [11, 4], 0.8],
	] as const)
		limb(p, root, c, b, w, 0.3, t);
	for (const [a, b] of [
		[
			[3.2, 5.8],
			[1.4, 6],
		],
		[
			[5.4, 3.8],
			[3.8, 2.6],
		],
		[
			[7.6, 3.4],
			[9.4, 2.6],
		],
		[
			[9.8, 5.6],
			[11.6, 6.2],
		],
	] as const)
		twig(p, a, b, 0.35, 0.2, t);
	ashHeap(p, 6.5, 8.8, 4.4, 1.1, n, [
		[4.6, 9],
		[8.4, 9.2],
	]);
	outlineGrid(p.g, ink);
	if (berries) {
		for (const [x, y] of [
			[2, 4.2],
			[5, 2],
			[8, 1.6],
			[10.8, 3.8],
			[1.4, 5.8],
			[11.6, 6],
		] as const)
			bud(p, x - 0.3, y - 0.3, n.emberRed, n.emberYellow);
	} else {
		for (const [x, y] of [
			[1.8, 4.2],
			[9.2, 2.4],
			[11.2, 6],
		] as const)
			deadLeaf(p, x, y, n);
	}
	return p.g;
}

/** flower-patch (scenery.ts: 14x9, the same nine bloom spots): ember and soul flowers on dead stalks, a few already burnt out. */
export function emberFlowerPatch(n: N, ink: number): Grid {
	const p = sceneryPen(14, 9);
	const stalk: Bark = { dark: n.char, base: n.char, lit: n.charLight };
	type Kind = "ember" | "soul" | "burnt";
	const blooms: [number, number, Kind, number][] = [
		[2, 5, "ember", -0.5],
		[5, 3, "soul", 0.4],
		[8, 6, "ember", 0.3],
		[11, 4, "burnt", -0.6],
		[4, 7, "ember", 0.2],
		[10, 7, "soul", -0.3],
		[7, 2, "ember", -0.2],
		[12.5, 6.5, "ember", 0.5],
		[1, 7.5, "burnt", 0.4],
	];
	for (const [x, y, kind, lean] of blooms) {
		const head: Pt = [x + 0.5 + lean, y + 0.3];
		limb(
			p,
			[x + 0.5, Math.min(9, y + 2.4)],
			[x + 0.5, y + 1.2],
			head,
			0.55,
			0.4,
			stalk,
		);
		if (kind === "burnt") {
			// Drooping: the head has bowed over its stalk.
			p.fine(
				p.at(head[0]) + (lean < 0 ? -1 : 1),
				p.at(head[1]) + 1,
				n.charLight,
			);
		}
	}
	outlineGrid(p.g, ink);
	for (const [x, y, kind, lean] of blooms) {
		const hx = x + 0.5 + lean;
		const hy = y + 0.3;
		if (kind === "ember")
			bloom(p, hx, hy, n.emberOrange, n.emberYellow, n.emberRed);
		else if (kind === "soul")
			bloom(p, hx, hy, n.soulCyan, n.ashLight, n.soulDeep);
		else p.fine(p.at(hx), p.at(hy), n.ashMid);
	}
	return p.g;
}

/** Prop name -> redraw, for the plant props netherProps would otherwise recolour. */
export function deadPlantProps(n: N, ink: number): Record<string, Grid> {
	return {
		hedge: deadHedge(n, ink),
		"tree-small": deadTreeSmall(n, ink),
		"tree-large": deadTreeLarge(n, ink),
		bush: deadBush(n, ink),
	};
}

/** Scenery kind -> redraw. */
export function deadPlantScenery(n: N, ink: number): Record<string, Grid> {
	return {
		oak: deadOak(n, ink, false),
		"blossom-oak": deadOak(n, ink, true),
		shrub: deadShrub(n, ink, false),
		"berry-shrub": deadShrub(n, ink, true),
		"flower-patch": emberFlowerPatch(n, ink),
	};
}
