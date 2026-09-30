import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { paletteJsonPath } from "../src/paths.js";
import { portalArchFrame } from "../src/pixelmaps/portal-arch.js";
import {
	brazierFrame,
	netherArchFrame,
	netherDecals,
	netherrackTileFrames,
	obsidianTileFrames,
	sudoIconGrid,
} from "../src/shadow/grids.js";
import { buildNetherPalette } from "../src/shadow/palette.js";
import {
	NETHER_SCENERY_KINDS,
	netherPropPalette,
	netherProps,
	netherScenery,
	netherSceneryPalette,
	netherSkyline,
} from "../src/shadow/props.js";
import { buildProps } from "../src/world-art/props.js";
import { buildScenery, buildSkyline } from "../src/world-art/scenery.js";

const base: RGB[] = JSON.parse(
	readFileSync(paletteJsonPath, "utf8"),
).colors.map((c: { rgb: RGB }) => c.rgb);
const pal = buildNetherPalette(base);

describe("shadow art", () => {
	test("nether colours are appended, never shifting palette.json's indices", () => {
		expect(pal.colors.slice(0, base.length)).toEqual(base);
		expect(Math.min(...Object.values(pal.n))).toBe(base.length);
	});

	test("tile sheets keep the biome layout: 4 base variants + 16 edge masks", () => {
		expect(netherrackTileFrames(pal.n)).toHaveLength(20);
		expect(obsidianTileFrames(pal.n)).toHaveLength(20);
	});

	test("six decals, ring flowers first", () => {
		const names = netherDecals(pal).map((d) => d.name);
		expect(names).toHaveLength(6);
		expect(names.slice(0, 2)).toEqual(["ember-bloom", "soul-crystal"]);
	});

	test("the nether arch keeps the portal arch's silhouette and opening cell for cell", () => {
		const alpha = (rows: string[]) => rows.map((r) => r.replace(/[^.]/g, "#"));
		for (let f = 0; f < 6; f++) {
			expect(alpha(netherArchFrame(pal, f).rows)).toEqual(
				alpha(portalArchFrame(f, 6).rows),
			);
		}
	});

	test("brazier frames fill the fountain's 56x58 grid and are deterministic", () => {
		const a = brazierFrame(pal, 2);
		expect(a).toHaveLength(58);
		expect(a[0]).toHaveLength(56);
		expect(brazierFrame(pal, 2)).toEqual(a);
		expect(sudoIconGrid(pal)).toHaveLength(32);
	});
});

describe("nether prop, scenery and skyline variants", () => {
	const size = (g: (number | null)[][]) => [g[0]?.length ?? 0, g.length];
	const greenish = (grids: { name: string; grid: (number | null)[][] }[]) =>
		grids.flatMap(({ name, grid }) => {
			const used = new Set(grid.flat().filter((c): c is number => c !== null));
			return [...used]
				.map((i) => pal.colors[i])
				.filter((c) => c && c.g > c.r + 8 && c.g >= c.b)
				.map((c) => `${name}: ${JSON.stringify(c)}`);
		});

	test("every variant is exactly its original's size, so swapping never moves anything", () => {
		const baseProps = buildProps(netherPropPalette(pal));
		const variants = netherProps(pal);
		expect(variants.map((v) => v.name)).toEqual(baseProps.map((p) => p.name));
		for (const [i, v] of variants.entries())
			expect(size(v.grid), v.name).toEqual(size(baseProps[i]?.grid ?? []));

		const baseScenery = new Map(
			buildScenery(netherSceneryPalette(pal)).map((p) => [p.name, p.grid]),
		);
		const scenery = netherScenery(pal);
		expect(scenery.map((s) => s.name)).toEqual([...NETHER_SCENERY_KINDS]);
		for (const s of scenery)
			expect(size(s.grid), s.name).toEqual(size(baseScenery.get(s.name) ?? []));

		const sky = netherSkyline(pal);
		const baseSky = buildSkyline({
			farStone: 1,
			farStoneShadow: 2,
			farStoneLight: 3,
			farRoof: 4,
			flag: 5,
			hillTones: { shadow: 6, base: 7, highlight: 8 },
			treeTones: { shadow: 9, base: 10, highlight: 11 },
			window: 12,
		});
		expect(sky.map((s) => s.name)).toEqual(baseSky.map((s) => s.name));
		for (const [i, s] of sky.entries())
			expect(size(s.grid), s.name).toEqual(size(baseSky[i]?.grid ?? []));
	});

	test("no variant uses a green colour", () => {
		expect(
			greenish([
				...netherProps(pal),
				...netherScenery(pal),
				...netherSkyline(pal),
			]),
		).toEqual([]);
	});

	test("damage is deterministic", () => {
		expect(netherProps(pal)).toEqual(netherProps(pal));
		expect(netherScenery(pal)).toEqual(netherScenery(pal));
	});
});
