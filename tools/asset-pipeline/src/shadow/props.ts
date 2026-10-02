import { hashNoise } from "../noise.js";
import type { Grid, GroundTonesLike } from "../pixel-shapes.js";
import { buildProps, type PropPaletteIndices } from "../world-art/props.js";
import {
	buildScenery,
	buildSkyline,
	type SceneryPalette,
} from "../world-art/scenery.js";
import type { NetherPalette } from "./palette.js";
import { deadPlantProps, deadPlantScenery } from "./plants.js";

/**
 * Nether variants of the normal world's clearing props, edge scenery and
 * skyline (2026-09-29). Each one runs the same authored builder as the
 * normal art with nether palette indices, so every variant is exactly the
 * original's size (the engine swaps textures without moving anything), then
 * gets deterministic damage where the shape alone would still read as the
 * green world: burnt-through roofs, tattered sails. The plants are redrawn
 * dead instead (plants.ts): a recoloured canopy still reads as a living
 * tree. Before this, the realm multiply-tinted the green art, which left it
 * olive.
 */

export interface NetherVariant {
	name: string;
	grid: Grid;
	cellSize: number;
}

type N = NetherPalette["n"];

/** Burnt foliage: soot, char and an ash-grey top where the light catches it. */
const ashTones = (n: N): GroundTonesLike => ({
	shadow: n.char,
	base: n.charLight,
	highlight: n.ashMid,
});

export function netherPropPalette(p: NetherPalette): PropPaletteIndices {
	const { n } = p;
	return {
		ink: p.ink,
		wood: n.charLight,
		woodDark: n.char,
		woodLight: n.ashMid,
		hedgeTones: ashTones(n),
		stone: n.blackstone,
		stoneShadow: n.blackstoneDark,
		stoneHighlight: n.blackstoneLight,
		glow: n.emberOrange,
		glowBright: n.emberYellow,
		treeTones: ashTones(n),
		blossomAccent: n.emberOrange,
		bushTones: ashTones(n),
		waterDark: n.emberRed,
		waterShine: n.emberYellow,
		plankCream: n.boneShadow,
		plankShadow: n.ashMid,
		potColor: n.netherBase,
		potShadow: n.netherDeep,
		potLight: n.netherLight,
		dirt: n.netherCrack,
		petal: n.emberOrange,
		petalAlt: n.emberRed,
		petalCenter: n.emberYellow,
		plaster: n.ashMid,
		plasterShadow: n.charLight,
		roofColor: n.char,
		roofShadow: n.netherCrack,
		roofHighlight: n.charLight,
		windowGlow: n.emberOrange,
		windowWarm: n.emberYellow,
		knob: n.emberYellow,
		bedSoil: n.netherCrack,
		flagColor: n.emberRed,
		turretRoof: { light: n.charLight, base: n.char, dark: n.netherCrack },
	};
}

export function netherSceneryPalette(p: NetherPalette): SceneryPalette {
	const { n } = p;
	return {
		pineTones: ashTones(n),
		oakTones: ashTones(n),
		shrubTones: ashTones(n),
		trunk: n.char,
		trunkDark: p.ink,
		stone: n.blackstone,
		stoneShadow: n.blackstoneDark,
		stoneHighlight: n.blackstoneLight,
		moss: n.netherBase,
		berry: n.emberOrange,
		blossom: n.emberOrange,
		petalA: n.emberOrange,
		petalB: n.emberRed,
		petalC: n.emberYellow,
		petalCenter: n.lavaHot,
		stem: n.char,
		reed: n.charLight,
		reedTip: n.emberOrange,
		capRed: n.emberRed,
		capShadow: n.netherDeep,
		capSpot: n.emberYellow,
		stalk: n.boneShadow,
		water: n.emberOrange,
		waterDeep: n.emberRed,
		waterShine: n.emberYellow,
		shore: n.netherCrack,
		lily: n.char,
		wood: n.charLight,
		woodDark: n.char,
		woodLight: n.ashMid,
		plaster: n.blackstone,
		plasterShadow: n.blackstoneDark,
		roof: n.char,
		roofShadow: n.netherCrack,
		sailCloth: n.ashMid,
		windowGlow: n.emberOrange,
		plank: n.boneShadow,
		ink: p.ink,
	};
}

/** 2x2-cell clumps, so damage reads as patches rather than per-pixel noise (the rejected "Minecraft dirt" speckle). */
function clumped(x: number, y: number, seed: number): number {
	return hashNoise(Math.floor(x / 2), Math.floor(y / 2), seed);
}

/** Recolours a clumped share of the cells holding any of `from` to `to` (or clears them, for null). */
function damage(
	grid: Grid,
	from: readonly number[],
	to: number | null,
	share: number,
	seed: number,
): Grid {
	const hit = new Set(from);
	return grid.map((row, y) =>
		row.map((cell, x) =>
			cell !== null && hit.has(cell) && clumped(x, y, seed) < share ? to : cell,
		),
	);
}

const PROP_SEED = 20262900;
const SCENERY_SEED = 20262950;

export function netherProps(p: NetherPalette): NetherVariant[] {
	const { n } = p;
	const plants = deadPlantProps(n, p.ink);
	return buildProps(netherPropPalette(p)).map((prop, i) => {
		const seed = PROP_SEED + i * 7;
		let grid = plants[prop.name] ?? prop.grid;
		switch (prop.name) {
			case "cottage":
				// Burnt through: fire glows where the roof has fallen in, and soot streaks the plaster.
				grid = damage(grid, [n.char, n.charLight], n.emberRed, 0.14, seed);
				grid = damage(grid, [n.ashMid], n.charLight, 0.2, seed + 1);
				break;
			case "fence":
			case "bench":
			case "signpost":
			case "flower-bed":
				grid = damage(grid, [n.charLight], n.char, 0.2, seed);
				break;
		}
		return { name: prop.name, grid, cellSize: prop.cellSize };
	});
}

/** Edge scenery with a nether variant here (the plants redrawn, the rest recoloured); pine/boulder/pond have their own redraws in grids.ts. */
export const NETHER_SCENERY_KINDS = [
	"oak",
	"blossom-oak",
	"shrub",
	"berry-shrub",
	"rock-small",
	"flower-patch",
	"reeds",
	"mushroom",
	"fallen-log",
	"stump",
	"ruin",
	"windmill",
	"windmill-sails",
	"waymarker",
] as const;

export function netherScenery(p: NetherPalette): NetherVariant[] {
	const { n } = p;
	const wanted = new Set<string>(NETHER_SCENERY_KINDS);
	const plants = deadPlantScenery(n, p.ink);
	// Seeded by position in the M3 list (before the oaks joined it), so the
	// recoloured pieces keep their damage exactly.
	const m3Order = NETHER_SCENERY_KINDS.filter(
		(k) => k !== "oak" && k !== "blossom-oak",
	) as string[];
	return buildScenery(netherSceneryPalette(p))
		.filter((piece) => wanted.has(piece.name))
		.map((piece) => {
			const seed = SCENERY_SEED + m3Order.indexOf(piece.name) * 7;
			let grid = plants[piece.name] ?? piece.grid;
			switch (piece.name) {
				case "windmill-sails":
					// A dead mill: the cloth hangs in rags off the spars.
					grid = damage(grid, [n.ashMid], null, 0.45, seed);
					break;
				case "windmill":
					grid = damage(
						grid,
						[n.blackstone, n.blackstoneDark],
						n.char,
						0.16,
						seed,
					);
					grid = damage(grid, [n.char], n.emberRed, 0.08, seed + 1);
					break;
				case "fallen-log":
				case "stump":
					grid = damage(grid, [n.charLight], n.emberRed, 0.06, seed);
					break;
			}
			return { name: piece.name, grid, cellSize: piece.cellSize };
		});
}

/** The horizon's day art: blackstone ruins with fire in their windows, crimson hills, a charred treeline. */
export function netherSkyline(p: NetherPalette): NetherVariant[] {
	const { n } = p;
	return buildSkyline({
		farStone: n.blackstone,
		farStoneShadow: n.blackstoneDark,
		farStoneLight: n.blackstoneLight,
		farRoof: n.netherDeep,
		flag: n.emberRed,
		hillTones: {
			shadow: n.netherDeep,
			base: n.netherBase,
			highlight: n.netherLight,
		},
		treeTones: ashTones(n),
		window: n.emberOrange,
	}).map((piece) => ({
		name: piece.name,
		grid: piece.grid.map((row, y) =>
			row.map((cell, x) => piece.windows[y]?.[x] ?? cell),
		),
		cellSize: piece.cellSize,
	}));
}
