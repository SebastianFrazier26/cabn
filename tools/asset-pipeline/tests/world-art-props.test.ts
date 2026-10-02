import { describe, expect, test } from "vitest";
import type { Grid } from "../src/pixel-shapes.js";
import {
	buildCastleKeep,
	buildProps,
	PROP_CELL_SIZE,
	type PropPaletteIndices,
} from "../src/world-art/props.js";

const INK = 0;
const tones = (b: number) => ({ shadow: b, base: b + 1, highlight: b + 2 });
const IDX: PropPaletteIndices = {
	ink: INK,
	wood: 1,
	woodDark: 2,
	woodLight: 3,
	hedgeTones: tones(4),
	stone: 7,
	stoneShadow: 8,
	stoneHighlight: 9,
	glow: 10,
	glowBright: 11,
	treeTones: tones(12),
	blossomAccent: 15,
	bushTones: tones(16),
	waterDark: 19,
	waterShine: 20,
	plankCream: 21,
	plankShadow: 22,
	potColor: 23,
	potShadow: 24,
	potLight: 25,
	dirt: 26,
	petal: 27,
	petalAlt: 28,
	petalCenter: 29,
	plaster: 30,
	plasterShadow: 31,
	roofColor: 32,
	roofShadow: 33,
	roofHighlight: 34,
	windowGlow: 35,
	windowWarm: 36,
	knob: 37,
	bedSoil: 38,
	flagColor: 39,
	turretRoof: { light: 40, base: 41, dark: 42 },
};

// Old coarse grid sizes (base units) — the fine grid is 3x that plus a
// 1-cell outline pad each side, which is what keeps on-screen size unchanged.
const BASE_SIZE: Record<string, [number, number]> = {
	fence: [20, 12],
	hedge: [22, 12],
	"lamp-post": [8, 22],
	"tree-small": [16, 24],
	"tree-large": [22, 34],
	bush: [14, 10],
	well: [16, 20],
	signpost: [10, 18],
	"flower-pot": [10, 14],
	"stone-wall": [20, 10],
	cottage: [20, 24],
	"flower-bed": [16, 8],
	bench: [18, 12],
};
const FOLIAGE = new Set(["hedge", "tree-small", "tree-large", "bush"]);

function silhouetteIsInked(grid: Grid): boolean {
	const h = grid.length;
	const w = grid[0]?.length ?? 0;
	const empty = (x: number, y: number) =>
		x < 0 || y < 0 || x >= w || y >= h || grid[y]?.[x] == null;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const v = grid[y]?.[x];
			if (v == null) continue;
			const edge =
				empty(x - 1, y) ||
				empty(x + 1, y) ||
				empty(x, y - 1) ||
				empty(x, y + 1);
			if (edge && v !== INK) return false;
		}
	}
	return true;
}

describe("scatter props (fine density)", () => {
	const props = buildProps(IDX);

	test("every PROP_NAMES entry is built at the shared fine cell size", () => {
		expect(props.map((p) => p.name).sort()).toEqual(
			Object.keys(BASE_SIZE).sort(),
		);
		for (const p of props) expect(p.cellSize).toBe(PROP_CELL_SIZE);
	});

	test.each(props.map((p) => [p.name, p] as const))(
		"%s keeps its old on-screen footprint (3x the old grid + outline pad)",
		(name, prop) => {
			const [w, h] = BASE_SIZE[name] ?? [0, 0];
			expect(prop.grid).toHaveLength(h * 3 + 2);
			for (const row of prop.grid) expect(row).toHaveLength(w * 3 + 2);
		},
	);

	test.each(
		props.filter((p) => !FOLIAGE.has(p.name)).map((p) => [p.name, p] as const),
	)("%s carries the tower/cabin 1-cell ink outline", (_name, prop) => {
		expect(silhouetteIsInked(prop.grid)).toBe(true);
	});

	test("is deterministic", () => {
		expect(buildProps(IDX)).toEqual(props);
		expect(buildCastleKeep(IDX)).toEqual(buildCastleKeep(IDX));
	});

	test("lit props keep their glow color (night light pools key off it)", () => {
		const uses = (name: string, idx: number) =>
			props.find((p) => p.name === name)?.grid.some((row) => row.includes(idx));
		expect(uses("lamp-post", IDX.glow)).toBe(true);
		expect(uses("cottage", IDX.windowGlow)).toBe(true);
	});

	test("castle keep is outlined", () => {
		expect(silhouetteIsInked(buildCastleKeep(IDX).grid)).toBe(true);
	});
});
