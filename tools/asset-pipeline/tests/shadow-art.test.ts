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
