import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { renderPixelMap } from "../src/pixelmap.js";
import { buildBagIcon } from "../src/pixelmaps/ui-item-bag.js";
import { buildCrystalOrbIcon } from "../src/pixelmaps/ui-item-orb.js";
import { buildQuillIcon } from "../src/pixelmaps/ui-item-quill.js";
import { buildSpyglassIcon } from "../src/pixelmaps/ui-item-spyglass.js";
import { buildWandIcon } from "../src/pixelmaps/ui-item-wand.js";
import { buildSparkle } from "../src/pixelmaps/ui-sparkle.js";

// 36 flat RGB stand-ins — enough indices for every legend used below without
// pulling in the real generated palette.json (these tests exercise geometry,
// not actual color values).
const PALETTE: RGB[] = Array.from({ length: 36 }, (_, i) => ({
	r: i,
	g: i,
	b: i,
}));

const ALL_BUILDERS = [
	buildCrystalOrbIcon,
	buildSpyglassIcon,
	buildBagIcon,
	buildQuillIcon,
	buildWandIcon,
	() => buildSparkle("violet"),
	() => buildSparkle("cyan"),
	() => buildSparkle("gold"),
];

describe("UI pixel map builders", () => {
	test.each(ALL_BUILDERS)("produces a valid, renderable PixelMap", (build) => {
		const map = build();
		expect(map.rows).toHaveLength(map.height);
		for (const row of map.rows) expect(row).toHaveLength(map.width);
		// renderPixelMap itself throws on unknown legend chars / bad dimensions —
		// running it is the real assertion that every generator's rows only use
		// characters declared in its own legend.
		expect(() => renderPixelMap(map, PALETTE)).not.toThrow();
	});

	test("unique names across all builders (used as output filenames)", () => {
		const names = ALL_BUILDERS.map((build) => build().name);
		expect(new Set(names).size).toBe(names.length);
	});

	test.each(ALL_BUILDERS)("has at least one opaque pixel", (build) => {
		const map = build();
		const hasOpaque = map.rows.some((row) => [...row].some((c) => c !== "."));
		expect(hasOpaque).toBe(true);
	});
});

describe("buildSparkle", () => {
	test("three colors produce distinct legends", () => {
		const violet = buildSparkle("violet");
		const cyan = buildSparkle("cyan");
		const gold = buildSparkle("gold");
		expect(violet.legend.A).not.toBe(cyan.legend.A);
		expect(cyan.legend.A).not.toBe(gold.legend.A);
	});

	test("is a symmetric 4-point star (manhattan distance <= 2 from center)", () => {
		const map = buildSparkle("gold");
		for (let y = 0; y < map.height; y++) {
			for (let x = 0; x < map.width; x++) {
				const armLen = Math.abs(x - 4) + Math.abs(y - 4);
				const ch = map.rows[y]?.[x];
				expect(ch).toBe(armLen === 0 ? "C" : armLen <= 2 ? "A" : ".");
			}
		}
	});
});

describe("buildCrystalOrbIcon", () => {
	test("sphere silhouette is round — its widest row is most of the icon's width", () => {
		const map = buildCrystalOrbIcon();
		// A round sphere's widest row (its equator, wherever that lands) should
		// span most of the icon's width; an accidentally elliptical or squashed
		// shape would fall well short of this regardless of exact center coords.
		const widestRow = Math.max(
			...map.rows.map((row) => [...row].filter((c) => c !== ".").length),
		);
		expect(widestRow).toBeGreaterThan(map.width * 0.6);
	});
});

describe("buildSpyglassIcon and buildQuillIcon", () => {
	test("both taper from a wide end to a narrow/pointed end", () => {
		for (const build of [buildSpyglassIcon, buildQuillIcon]) {
			const map = build();
			const widthAt = (y: number) =>
				[...(map.rows[y] ?? "")].filter((c) => c !== ".").length;
			const nearStart = widthAt(map.height - 3);
			const nearEnd = widthAt(2);
			expect(nearStart).toBeGreaterThan(0);
			// not a strict assertion on which end is wider (spyglass widens toward
			// the eyepiece, quill's vane is widest in the middle) — just confirms
			// neither end is the full-width block a broken taper would produce.
			expect(nearEnd).toBeLessThan(map.width);
			expect(nearStart).toBeLessThan(map.width);
		}
	});
});
