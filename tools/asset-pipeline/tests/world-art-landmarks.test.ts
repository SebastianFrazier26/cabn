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
	buildWorldFountainFrame,
	buildWorldFountainGem,
	WORLD_FOUNTAIN_FRAME_COUNT,
	WORLD_FOUNTAIN_HEIGHT,
	WORLD_FOUNTAIN_WIDTH,
	type WorldFountainPalette,
} from "../src/world-art/world-fountain.js";

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

const FOUNTAIN: WorldFountainPalette = {
	ink: INK,
	stoneLight: 1,
	stone: 2,
	stoneShadow: 3,
	mossShadow: 4,
	mossLight: 5,
	rune: 6,
	water: 7,
	waterDeep: 8,
	waterLight: 9,
	sparkle: 10,
	gemLight: 11,
	gemMid: 12,
	gemDark: 13,
	gemBezel: 14,
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

describe("world fountain", () => {
	const frames = () =>
		Array.from({ length: WORLD_FOUNTAIN_FRAME_COUNT }, (_, i) =>
			buildWorldFountainFrame(FOUNTAIN, i),
		);

	test("every frame has the declared dimensions and an inked silhouette", () => {
		for (const g of frames()) {
			expect(g).toHaveLength(WORLD_FOUNTAIN_HEIGHT);
			for (const row of g) expect(row).toHaveLength(WORLD_FOUNTAIN_WIDTH);
			// The orb's jet is deliberately un-inked (see paintJet), so check the
			// silhouette with loose water droplets lifted out.
			const isEmpty = (x: number, y: number) => g[y]?.[x] == null;
			const stoneOnly = g.map((row, y) =>
				row.map((v, x) =>
					(v === FOUNTAIN.water || v === FOUNTAIN.waterLight) &&
					(isEmpty(x - 1, y) ||
						isEmpty(x + 1, y) ||
						isEmpty(x, y - 1) ||
						isEmpty(x, y + 1))
						? null
						: v,
				),
			);
			expect(silhouetteIsInked(stoneOnly)).toBe(true);
		}
	});

	test("speaks the portal arch's stone language: three stone tones, moss, rune inlay", () => {
		const used = colorsUsed(buildWorldFountainFrame(FOUNTAIN, 0));
		for (const idx of [
			FOUNTAIN.stoneLight,
			FOUNTAIN.stone,
			FOUNTAIN.stoneShadow,
			FOUNTAIN.mossLight,
			FOUNTAIN.mossShadow,
			FOUNTAIN.rune,
			FOUNTAIN.water,
			FOUNTAIN.waterLight,
		])
			expect(used.has(idx)).toBe(true);
	});

	test("animates: consecutive frames differ, and only in water cells", () => {
		const all = frames();
		const water = new Set([
			FOUNTAIN.water,
			FOUNTAIN.waterDeep,
			FOUNTAIN.waterLight,
			FOUNTAIN.sparkle,
		]);
		for (let i = 0; i < all.length; i++) {
			const a = all[i] as Grid;
			const b = all[(i + 1) % all.length] as Grid;
			let changed = 0;
			for (let y = 0; y < a.length; y++) {
				for (let x = 0; x < (a[y]?.length ?? 0); x++) {
					const va = a[y]?.[x] ?? null;
					const vb = b[y]?.[x] ?? null;
					if (va === vb) continue;
					changed++;
					// A stream can reach past the stone silhouette, so its cells
					// may toggle between water and empty/outline — never stone.
					for (const v of [va, vb])
						if (v !== null && v !== INK) expect(water.has(v)).toBe(true);
				}
			}
			expect(changed).toBeGreaterThan(0);
		}
	});

	test("the gem overlay sits on the column's rune socket and uses only the neutral gem tones", () => {
		const gem = buildWorldFountainGem(FOUNTAIN);
		const base = buildWorldFountainFrame(FOUNTAIN, 0);
		const used = colorsUsed(gem);
		expect([...used].sort()).toEqual(
			[FOUNTAIN.gemLight, FOUNTAIN.gemMid, FOUNTAIN.gemDark].sort(),
		);
		for (let y = 0; y < gem.length; y++)
			for (let x = 0; x < (gem[y]?.length ?? 0); x++)
				if (gem[y]?.[x] != null) expect(base[y]?.[x]).toBe(FOUNTAIN.rune);
	});

	test("the gem socket is ringed by the bezel tone, hugging the gem", () => {
		const gem = buildWorldFountainGem(FOUNTAIN);
		const base = buildWorldFountainFrame(FOUNTAIN, 0);
		let bezel = 0;
		for (let y = 0; y < base.length; y++)
			for (let x = 0; x < (base[y]?.length ?? 0); x++) {
				if (base[y]?.[x] !== FOUNTAIN.gemBezel) continue;
				bezel++;
				const touchesGem = [
					[x - 1, y],
					[x + 1, y],
					[x, y - 1],
					[x, y + 1],
				].some(([gx, gy]) => gem[gy as number]?.[gx as number] != null);
				expect(touchesGem).toBe(true);
			}
		expect(bezel).toBeGreaterThanOrEqual(8);
	});

	test("is deterministic", () => {
		expect(frames()).toEqual(frames());
		expect(buildWorldFountainGem(FOUNTAIN)).toEqual(
			buildWorldFountainGem(FOUNTAIN),
		);
	});
});
