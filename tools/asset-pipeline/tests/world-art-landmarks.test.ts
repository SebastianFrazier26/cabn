import { describe, expect, test } from "vitest";
import {
	createGrid,
	fillRect,
	type Grid,
	outlineGrid,
} from "../src/pixel-shapes.js";
import {
	buildShelfCabinGrid,
	SHELF_CABIN_HEIGHT,
	SHELF_CABIN_WIDTH,
	type ShelfCabinPalette,
} from "../src/world-art/shelf-cabin.js";
import {
	buildWorldCabinetGrid,
	WORLD_CABINET_HEIGHT,
	WORLD_CABINET_WIDTH,
	type WorldCabinetPalette,
} from "../src/world-art/world-cabinet.js";

const INK = 0;
const ivy = { shadow: 20, base: 21, highlight: 22 };

const CABIN: ShelfCabinPalette = {
	ink: INK,
	roofSeam: 1,
	roofShadow: 2,
	roofBase: 3,
	roofHighlight: 4,
	woodDark: 5,
	wood: 6,
	woodLight: 7,
	stoneDark: 8,
	stone: 9,
	stoneLight: 10,
	windowGlow: 11,
	windowWarm: 12,
	knob: 13,
	pot: 14,
	potShadow: 15,
	petalA: 16,
	petalB: 17,
	petalC: 18,
	ivy,
};

const CABINET: WorldCabinetPalette = {
	ink: INK,
	wood: 1,
	woodDark: 2,
	woodLight: 3,
	handle: 4,
	handleBright: 5,
	glassBack: 6,
	glint: 7,
	curios: [8, 9, 10],
	ivy,
};

/** Every opaque cell touching transparency (or the grid edge) must be ink — the tower/icon outline convention. */
function silhouetteIsInked(grid: Grid): boolean {
	const h = grid.length;
	const w = grid[0]?.length ?? 0;
	const empty = (x: number, y: number) =>
		x < 0 || y < 0 || x >= w || y >= h || grid[y]?.[x] == null;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const v = grid[y]?.[x];
			if (v == null) continue;
			const onEdge =
				empty(x - 1, y) ||
				empty(x + 1, y) ||
				empty(x, y - 1) ||
				empty(x, y + 1);
			if (onEdge && v !== INK) return false;
		}
	}
	return true;
}

function colorsUsed(grid: Grid): Set<number> {
	const used = new Set<number>();
	for (const row of grid) for (const v of row) if (v != null) used.add(v);
	return used;
}

describe("outlineGrid", () => {
	test("rings a filled shape with ink on its 4-neighbors only", () => {
		const g = createGrid(5, 5);
		fillRect(g, 2, 2, 1, 1, 9);
		outlineGrid(g, INK);
		expect(g[1]?.[2]).toBe(INK);
		expect(g[3]?.[2]).toBe(INK);
		expect(g[2]?.[1]).toBe(INK);
		expect(g[2]?.[3]).toBe(INK);
		expect(g[1]?.[1]).toBeNull();
		expect(g[2]?.[2]).toBe(9);
	});
});

describe.each([
	[
		"shelf cabin",
		() => buildShelfCabinGrid(CABIN),
		SHELF_CABIN_WIDTH,
		SHELF_CABIN_HEIGHT,
	],
	[
		"world cabinet",
		() => buildWorldCabinetGrid(CABINET),
		WORLD_CABINET_WIDTH,
		WORLD_CABINET_HEIGHT,
	],
] as const)("%s", (_name, build, width, height) => {
	test("has the declared dimensions", () => {
		const g = build();
		expect(g).toHaveLength(height);
		for (const row of g) expect(row).toHaveLength(width);
	});

	test("carries a 1-cell ink outline around its whole silhouette", () => {
		expect(silhouetteIsInked(build())).toBe(true);
	});

	test("uses the ivy tones (shared foliage treatment)", () => {
		const used = colorsUsed(build());
		expect(used.has(ivy.highlight)).toBe(true);
		expect(used.has(ivy.shadow)).toBe(true);
	});

	test("is deterministic", () => {
		expect(build()).toEqual(build());
	});
});

test("shelf cabin windows use the glow color (night bloom / light pools key off it)", () => {
	expect(colorsUsed(buildShelfCabinGrid(CABIN)).has(CABIN.windowGlow)).toBe(
		true,
	);
});
