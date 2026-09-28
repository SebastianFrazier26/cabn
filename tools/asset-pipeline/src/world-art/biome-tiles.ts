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

/**
 * One of the 16 blob-lite edge tiles: dirt background, with a grass region
 * inset from any side whose neighbor tile isn't also ground (mask bit unset)
 * — see groundTiles.ts's edgeMask doc comment for the bit layout (N=1, E=2,
 * S=4, W=8). Concave corners (both adjacent sides missing) get a real
 * rounded arc rather than a sharp cut — a deliberate curve, not noise, is
 * what makes an autotiled edge read as "hand-drawn blob set" instead of a
 * grid of rectangles.
 */
function buildEdgeTile(
	mask: number,
	grass: GroundTones,
	dirt: GroundTones,
): Grid {
	const grid = createGrid(TILE_GRID, TILE_GRID);
	fillRect(grid, 0, 0, TILE_GRID, TILE_GRID, dirt.base);

	const insetTop = mask & 1 ? 0 : MARGIN;
	const insetRight = mask & 2 ? 0 : MARGIN;
	const insetBottom = mask & 4 ? 0 : MARGIN;
	const insetLeft = mask & 8 ? 0 : MARGIN;

	for (let y = 0; y < TILE_GRID; y++) {
		for (let x = 0; x < TILE_GRID; x++) {
			if (
				insideRoundedInset(x, y, insetTop, insetRight, insetBottom, insetLeft)
			) {
				setPixel(grid, x, y, grass.base);
			}
		}
	}

	// A one-pixel shadow line just inside the grass/dirt boundary reads as
	// the grass casting a little shade onto the dirt lip — deliberate,
	// static shading, not a texture pass.
	for (let y = 0; y < TILE_GRID; y++) {
		for (let x = 0; x < TILE_GRID; x++) {
			const isGrass = insideRoundedInset(
				x,
				y,
				insetTop,
				insetRight,
				insetBottom,
				insetLeft,
			);
			if (!isGrass) continue;
			const onEdge = ![
				[x + 1, y],
				[x - 1, y],
				[x, y + 1],
				[x, y - 1],
			].every(([nx, ny]) =>
				nx === undefined || ny === undefined
					? true
					: insideRoundedInset(
							nx,
							ny,
							insetTop,
							insetRight,
							insetBottom,
							insetLeft,
						),
			);
			if (onEdge) setPixel(grid, x, y, grass.shadow);
		}
	}

	return grid;
}

/** VARIANT_COUNT base grass variants followed by 16 blob-edge frames (mask 0-15) — see groundTiles.ts's tileFrameFor for how a mask maps to a frame index. */
export function buildBiomeTileFrames(
	grass: GroundTones,
	dirt: GroundTones,
): Grid[] {
	const frames: Grid[] = [];
	for (let v = 0; v < VARIANT_COUNT; v++) {
		frames.push(buildBaseVariant(grass, v));
	}
	for (let mask = 0; mask < 16; mask++) {
		frames.push(buildEdgeTile(mask, grass, dirt));
	}
	return frames;
}
