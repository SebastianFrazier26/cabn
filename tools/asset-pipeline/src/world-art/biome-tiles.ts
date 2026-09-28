import {
	createGrid,
	fillRect,
	type Grid,
	type GroundTonesLike,
	setPixel,
} from "../pixel-shapes.js";

// Matches packages/engine/src/render/groundTiles.ts's GROUND_TILE_SIZE (32)
// at soften's cellSize 2 — keep the two in sync by hand if either changes,
// same "engine doesn't read this package's files at runtime" boundary the
// wizard-tower/palette.ts comments already document elsewhere.
export const TILE_GRID = 16;
export const VARIANT_COUNT = 4;
const MARGIN = 4;

export type GroundTones = GroundTonesLike;

// User feedback on the first pass: per-pixel random speckle (readable at
// larger sizes as "TV static") read as "Minecraft dirt", not clean pixel
// art — rejected outright, not just toned down. This version replaces it
// with what Stardew Valley/Pokémon grass tiles actually do: a flat base
// fill plus a handful of small, deliberately-placed highlight/shadow tufts
// at fixed positions (one lookup table per variant, not randomized per
// pixel) for texture breakup between the VARIANT_COUNT base tiles.
const TUFT_LAYOUTS: readonly (readonly [
	number,
	number,
	"highlight" | "shadow",
])[][] = [
	[
		[3, 4, "highlight"],
		[4, 4, "highlight"],
		[11, 10, "shadow"],
		[12, 10, "shadow"],
	],
	[
		[9, 3, "highlight"],
		[10, 3, "highlight"],
		[4, 11, "shadow"],
		[5, 11, "shadow"],
		[4, 12, "shadow"],
	],
	[
		[6, 7, "highlight"],
		[7, 7, "highlight"],
		[7, 8, "highlight"],
		[13, 5, "shadow"],
	],
	[
		[2, 9, "highlight"],
		[2, 10, "highlight"],
		[10, 2, "shadow"],
		[11, 2, "shadow"],
		[9, 13, "highlight"],
	],
];

function buildBaseVariant(tones: GroundTones, variantIndex: number): Grid {
	const grid = createGrid(TILE_GRID, TILE_GRID);
	fillRect(grid, 0, 0, TILE_GRID, TILE_GRID, tones.base);
	const tufts = TUFT_LAYOUTS[variantIndex % TUFT_LAYOUTS.length] ?? [];
	for (const [x, y, tone] of tufts) {
		setPixel(grid, x, y, tone === "highlight" ? tones.highlight : tones.shadow);
	}
	return grid;
}

/** True if (x, y) is inside the inset rect [insetLeft..size-1-insetRight] x [insetTop..size-1-insetBottom], with concave corners rounded (radius = MARGIN) wherever *both* sides meeting at that corner are inset — i.e. wherever both neighbors on that corner are missing. A corner with only one side inset stays a sharp right angle, since it has to butt cleanly against a neighbor tile that isn't receding on that side. */
function insideRoundedInset(
	x: number,
	y: number,
	insetTop: number,
	insetRight: number,
	insetBottom: number,
	insetLeft: number,
): boolean {
	const left = insetLeft;
	const right = TILE_GRID - 1 - insetRight;
	const top = insetTop;
	const bottom = TILE_GRID - 1 - insetBottom;
	if (x < left || x > right || y < top || y > bottom) return false;

	const corner = (
		cx: number,
		cy: number,
		nearX: boolean,
		nearY: boolean,
	): boolean => {
		if (!nearX || !nearY) return true;
		return Math.hypot(x - cx, y - cy) <= MARGIN;
	};
	if (insetLeft > 0 && insetTop > 0) {
		if (
			!corner(left + MARGIN, top + MARGIN, x < left + MARGIN, y < top + MARGIN)
		)
			return false;
	}
	if (insetRight > 0 && insetTop > 0) {
		if (
			!corner(
				right - MARGIN,
				top + MARGIN,
				x > right - MARGIN,
				y < top + MARGIN,
			)
		)
			return false;
	}
	if (insetLeft > 0 && insetBottom > 0) {
		if (
			!corner(
				left + MARGIN,
				bottom - MARGIN,
				x < left + MARGIN,
				y > bottom - MARGIN,
			)
		) {
			return false;
		}
	}
	if (insetRight > 0 && insetBottom > 0) {
		if (
			!corner(
				right - MARGIN,
				bottom - MARGIN,
				x > right - MARGIN,
				y > bottom - MARGIN,
			)
		) {
			return false;
		}
	}
	return true;
}

// M10b batch-3 review: the old opaque dirt-colored background outside the
// grass inset baked a hard, sand-colored square border around every clearing
// once batch 2 put a continuous grass field underneath everything — there's
// no dirt anywhere else in the world anymore for that square to blend into.
// Fix: the "outside" is transparent instead, so the field shows straight
// through and only the grass silhouette itself reads. That silhouette also
// gets a few small fixed-position "grass tuft" pixels poking a little past
// the smooth inset curve (not randomized — same fixed-lookup-table
// philosophy as TUFT_LAYOUTS above), so the edge reads as an uneven tuft
// line instead of a geometrically perfect rounded rectangle.
const FRINGE_OFFSETS: readonly (readonly [number, number])[] = [
	[1, -1],
	[3, 1],
	[-2, 1],
	[1, 2],
	[-1, -2],
	[2, -2],
];

/**
 * One of the 16 blob-lite edge tiles: transparent background (the field
 * shows through), with a grass region inset from any side whose neighbor
 * tile isn't also ground (mask bit unset) — see groundTiles.ts's edgeMask
 * doc comment for the bit layout (N=1, E=2, S=4, W=8). Concave corners (both
 * adjacent sides missing) get a real rounded arc rather than a sharp cut —
 * that, plus the tuft fringe above, is what makes an autotiled edge read as
 * organic rather than a grid of rectangles.
 */
function buildEdgeTile(mask: number, grass: GroundTones): Grid {
	const grid = createGrid(TILE_GRID, TILE_GRID);

	const insetTop = mask & 1 ? 0 : MARGIN;
	const insetRight = mask & 2 ? 0 : MARGIN;
	const insetBottom = mask & 4 ? 0 : MARGIN;
	const insetLeft = mask & 8 ? 0 : MARGIN;
	const inside = (x: number, y: number): boolean =>
		insideRoundedInset(x, y, insetTop, insetRight, insetBottom, insetLeft);

	for (let y = 0; y < TILE_GRID; y++) {
		for (let x = 0; x < TILE_GRID; x++) {
			if (inside(x, y)) setPixel(grid, x, y, grass.base);
		}
	}

	// A one-pixel shadow line just inside the grass boundary reads as the
	// grass's own edge catching a little shade — deliberate, static shading,
	// not a texture pass.
	for (let y = 0; y < TILE_GRID; y++) {
		for (let x = 0; x < TILE_GRID; x++) {
			if (!inside(x, y)) continue;
			const onEdge = ![
				[x + 1, y],
				[x - 1, y],
				[x, y + 1],
				[x, y - 1],
			].every(([nx, ny]) =>
				nx === undefined || ny === undefined ? true : inside(nx, ny),
			);
			if (onEdge) setPixel(grid, x, y, grass.shadow);
		}
	}

	// Tuft fringe — only along sides that are actually inset (a side that
	// butts cleanly against another ground tile shouldn't get a ragged edge
	// where the two tiles meet).
	const midX = TILE_GRID / 2;
	const midY = TILE_GRID / 2;
	for (const [dx, dy] of FRINGE_OFFSETS) {
		if (insetTop > 0 && dy < 0)
			setPixel(grid, Math.round(midX + dx), insetTop + dy, grass.base);
		if (insetBottom > 0 && dy > 0) {
			setPixel(
				grid,
				Math.round(midX + dx),
				TILE_GRID - 1 - insetBottom + dy,
				grass.base,
			);
		}
		if (insetLeft > 0 && dx < 0)
			setPixel(grid, insetLeft + dx, Math.round(midY + dy), grass.base);
		if (insetRight > 0 && dx > 0) {
			setPixel(
				grid,
				TILE_GRID - 1 - insetRight + dx,
				Math.round(midY + dy),
				grass.base,
			);
		}
	}

	return grid;
}

/** VARIANT_COUNT base grass variants followed by 16 blob-edge frames (mask 0-15) — see groundTiles.ts's tileFrameFor for how a mask maps to a frame index. */
export function buildBiomeTileFrames(grass: GroundTones): Grid[] {
	const frames: Grid[] = [];
	for (let v = 0; v < VARIANT_COUNT; v++) {
		frames.push(buildBaseVariant(grass, v));
	}
	for (let mask = 0; mask < 16; mask++) {
		frames.push(buildEdgeTile(mask, grass));
	}
	return frames;
}
