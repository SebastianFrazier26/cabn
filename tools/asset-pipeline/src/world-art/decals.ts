import {
	createGrid,
	fillEllipse,
	type Grid,
	setPixel,
} from "../pixel-shapes.js";

// 12x12 native, soften cellSize 2 -> 24x24 — smaller than a 32px ground
// tile so decals read as scattered detail sitting on top of it, not another
// tile. Shared across all three biomes (see gen-world-art.ts's doc comment
// on DECAL_SETS for why one shared sheet, not per-biome art).
export const DECAL_GRID = 12;

export interface Decal {
	name: string;
	grid: Grid;
}

function petalFlower(petal: number, center: number, stem: number): Grid {
	const g = createGrid(DECAL_GRID, DECAL_GRID);
	setPixel(g, 5, 9, stem);
	setPixel(g, 5, 10, stem);
	setPixel(g, 5, 11, stem);
	fillEllipse(g, 5, 4, 1.6, 1.1, petal);
	fillEllipse(g, 3, 5.5, 1.1, 1.6, petal);
	fillEllipse(g, 7, 5.5, 1.1, 1.6, petal);
	fillEllipse(g, 4, 7, 1.6, 1.1, petal);
	fillEllipse(g, 6, 7, 1.6, 1.1, petal);
	fillEllipse(g, 5, 5.7, 1, 1, center);
	return g;
}

function clover(leaf: number, leafShadow: number): Grid {
	const g = createGrid(DECAL_GRID, DECAL_GRID);
	fillEllipse(g, 5, 5, 1.6, 1.9, leaf);
	fillEllipse(g, 3.2, 6.5, 1.6, 1.9, leaf);
	fillEllipse(g, 6.8, 6.5, 1.6, 1.9, leaf);
	setPixel(g, 5, 8, leafShadow);
	setPixel(g, 5, 9, leafShadow);
	return g;
}

function pebbleCluster(stone: number, shadow: number, highlight: number): Grid {
	const g = createGrid(DECAL_GRID, DECAL_GRID);
	fillEllipse(g, 4, 7, 2.4, 1.6, shadow);
	fillEllipse(g, 4, 6.5, 2.1, 1.3, stone);
	setPixel(g, 3, 6, highlight);
	fillEllipse(g, 8, 8.5, 1.6, 1.1, shadow);
	fillEllipse(g, 8, 8.2, 1.3, 0.9, stone);
	return g;
}

function mushroomPair(
	cap: number,
	capShadow: number,
	spot: number,
	stalk: number,
): Grid {
	const g = createGrid(DECAL_GRID, DECAL_GRID);
	// Tall cap.
	fillEllipse(g, 4, 5, 2.4, 1.7, cap);
	fillEllipse(g, 4, 5.6, 2.1, 1.1, capShadow);
	setPixel(g, 3, 4, spot);
	setPixel(g, 5, 4, spot);
	for (let y = 6; y <= 9; y++) {
		setPixel(g, 4, y, stalk);
	}
	// Short cap.
	fillEllipse(g, 8, 8, 1.7, 1.2, cap);
	for (let y = 9; y <= 10; y++) {
		setPixel(g, 8, y, stalk);
	}
	return g;
}

function fallenLeaf(leaf: number, vein: number): Grid {
	const g = createGrid(DECAL_GRID, DECAL_GRID);
	fillEllipse(g, 5.5, 5.5, 3.2, 2.1, leaf);
	for (let i = -2; i <= 2; i++)
		setPixel(g, 5 + i, 5 + Math.round(i * 0.3), vein);
	setPixel(g, 8, 6, vein);
	setPixel(g, 9, 6, vein);
	return g;
}

/**
 * Building the decal set as a function (not module-level constants) so
 * gen-world-art.ts can hand it the actual palette indices it resolved (the
 * palette itself lives in assets/generated/palette.json, loaded at build
 * time — see PALETTE_INDEX in gen-world-art.ts).
 */
export function buildDecals(idx: {
	blossomPink: number;
	cornflowerBlue: number;
	butterYellow: number;
	stemGreen: number;
	leafGreen: number;
	leafGreenShadow: number;
	steelGray: number;
	coolShadow: number;
	cream: number;
	berryRed: number;
	emberRed: number;
	parchment: number;
	leafOrange: number;
	leafOrangeShadow: number;
}): Decal[] {
	return [
		{
			name: "flower-pink",
			grid: petalFlower(idx.blossomPink, idx.butterYellow, idx.stemGreen),
		},
		{
			name: "flower-blue",
			grid: petalFlower(idx.cornflowerBlue, idx.butterYellow, idx.stemGreen),
		},
		{ name: "clover", grid: clover(idx.leafGreen, idx.leafGreenShadow) },
		{
			name: "pebbles",
			grid: pebbleCluster(idx.steelGray, idx.coolShadow, idx.cream),
		},
		{
			name: "mushrooms",
			grid: mushroomPair(idx.berryRed, idx.emberRed, idx.cream, idx.parchment),
		},
		{
			name: "fallen-leaf",
			grid: fallenLeaf(idx.leafOrange, idx.leafOrangeShadow),
		},
	];
}
