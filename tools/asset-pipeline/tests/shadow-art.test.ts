import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { defeatFrames, hitFrame } from "../src/monster-fx.js";
import {
	generatedDir,
	paletteJsonPath,
	placeholdersDir,
} from "../src/paths.js";
import type { PixelMap } from "../src/pixelmap.js";
import { portalArchFrame } from "../src/pixelmaps/portal-arch.js";
import {
	brazierFrame,
	netherArchFrame,
	netherDecals,
	netherrackTileFrames,
	obsidianTileFrames,
	sudoIconGrid,
} from "../src/shadow/grids.js";
import { hudIconSources, isGreen, netherIcons } from "../src/shadow/icons.js";
import { netherMonsters, normalMonsterFrames } from "../src/shadow/monsters.js";
import { buildNetherPalette } from "../src/shadow/palette.js";
import { deadPlantProps, deadPlantScenery } from "../src/shadow/plants.js";
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
const shadowAssetsDir = join(generatedDir, "shadow");

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

	test("damage and the dead-plant redraws are deterministic", () => {
		expect(netherProps(pal)).toEqual(netherProps(pal));
		expect(netherScenery(pal)).toEqual(netherScenery(pal));
	});
});

describe("nether monsters", () => {
	const monsters = netherMonsters(pal);
	const usedGreen = (map: PixelMap) => {
		const used = new Set(map.rows.join(""));
		return Object.entries(map.legend)
			.filter(([ch, i]) => used.has(ch) && isGreen(pal.colors[i]))
			.map(([ch]) => `${map.name}:${ch}`);
	};

	test("all eleven species, each frame exactly its original's size and layout", () => {
		expect(monsters.map((m) => m.slug).sort()).toEqual(
			[
				"bramble",
				"ghost",
				"gremlin",
				"imp",
				"magpie",
				"ouroboros",
				"rot_sprite",
				"shade",
				"skeleton",
				"warded_mimic",
				"will_o_wisp",
			].sort(),
		);
		for (const m of monsters) {
			const normal = normalMonsterFrames(m.slug);
			expect(m.idle, m.slug).toHaveLength(normal.length);
			expect(m.idle).toHaveLength(m.slug === "ghost" ? 1 : 2);
			for (const [i, f] of m.idle.entries()) {
				expect(f.rows, `${m.slug} idle${i}`).toEqual(normal[i]?.rows);
				expect([f.width, f.height]).toEqual([
					normal[i]?.width,
					normal[i]?.height,
				]);
			}
			const idle0 = normal[0] as PixelMap;
			const normalFx = [
				hitFrame(idle0, pal.colors, "n"),
				...defeatFrames(idle0, pal.colors, "n"),
			];
			expect(m.defeat).toHaveLength(3);
			for (const [i, f] of [m.hit, ...m.defeat].entries()) {
				expect([f.width, f.height], `${m.slug} fx${i}`).toEqual([
					idle0.width,
					idle0.height,
				]);
				expect([f.width, f.height]).toEqual([
					normalFx[i]?.width,
					normalFx[i]?.height,
				]);
			}
		}
	});

	test("no frame uses green, and output is deterministic", () => {
		expect(
			monsters.flatMap((m) =>
				[...m.idle, m.hit, ...m.defeat].flatMap(usedGreen),
			),
		).toEqual([]);
		expect(netherMonsters(pal)).toEqual(monsters);
	});
});

describe("crimson HUD icons", () => {
	const icons = netherIcons(pal);
	const hasGreen = (map: PixelMap) => {
		const used = new Set(map.rows.join(""));
		return Object.entries(map.legend).some(
			([ch, i]) => used.has(ch) && isGreen(pal.colors[i]),
		);
	};

	test("every icon drawn with green gets a variant, the same size and cells, with no green left", () => {
		const green = hudIconSources()
			.map((s) => s.map)
			.filter(hasGreen);
		expect(icons.map((i) => i.map.name)).toEqual(
			green.map((m) => `${m.name}_nether`),
		);
		expect(icons.map((i) => i.map.name)).toContain("ui_tool_replace_nether");
		for (const [k, icon] of icons.entries()) {
			expect(icon.map.rows).toEqual(green[k]?.rows);
			expect(hasGreen(icon.map), icon.map.name).toBe(false);
		}
		expect(netherIcons(pal)).toEqual(icons);
	});
});

describe("dead plants", () => {
	test("the plant props and scenery are the hand-drawn redraws, not recolours", () => {
		const props = new Map(netherProps(pal).map((v) => [v.name, v.grid]));
		for (const [name, grid] of Object.entries(deadPlantProps(pal.n, pal.ink)))
			expect(props.get(name), name).toEqual(grid);
		const scenery = new Map(netherScenery(pal).map((v) => [v.name, v.grid]));
		for (const [name, grid] of Object.entries(deadPlantScenery(pal.n, pal.ink)))
			expect(scenery.get(name), name).toEqual(grid);
		expect(Object.keys(deadPlantProps(pal.n, pal.ink)).sort()).toEqual([
			"bush",
			"hedge",
			"tree-large",
			"tree-small",
		]);
		expect(Object.keys(deadPlantScenery(pal.n, pal.ink)).sort()).toEqual([
			"berry-shrub",
			"blossom-oak",
			"flower-patch",
			"oak",
			"shrub",
		]);
	});
});

describe("generated crimson icons, pixel by pixel", () => {
	const greenPixels = async (file: string) => {
		const { data } = await sharp(file)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		let count = 0;
		for (let i = 0; i < data.length; i += 4) {
			if ((data[i + 3] ?? 0) < 64) continue;
			const r = data[i] ?? 0;
			const g = data[i + 1] ?? 0;
			const b = data[i + 2] ?? 0;
			const lo = Math.min(r, b);
			if (g - lo < 30 || g < r || g < b) continue;
			const hue = 60 * ((b - r) / (g - lo)) + 120;
			if (hue >= 75 && hue <= 165) count++;
		}
		return count;
	};

	test("every HUD icon whose normal art shows green has a variant, and no variant shows any", async () => {
		const names = hudIconSources().map((s) => s.map.name);
		const greenNormals: string[] = [];
		for (const name of names)
			if ((await greenPixels(join(placeholdersDir, `${name}_soft.png`))) > 0)
				greenNormals.push(name);
		expect(greenNormals).toContain("ui_tool_replace");
		expect(netherIcons(pal).map((i) => i.map.name)).toEqual(
			greenNormals.map((n) => `${n}_nether`),
		);
		for (const name of greenNormals) {
			const file = join(shadowAssetsDir, `${name}_nether_soft.png`);
			expect(await greenPixels(file), name).toBe(0);
		}
	});
});
