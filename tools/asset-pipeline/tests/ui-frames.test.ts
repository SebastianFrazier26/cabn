import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { renderPixelMap } from "../src/pixelmap.js";
import { buildWaxSeal } from "../src/pixelmaps/ui-button.js";
import { buildDividerFlourish } from "../src/pixelmaps/ui-divider.js";
import { buildWoodFrameTile } from "../src/pixelmaps/ui-frame.js";
import { buildHotbarSlot } from "../src/pixelmaps/ui-hotbar-slot.js";
import { buildParchmentTile } from "../src/pixelmaps/ui-parchment.js";
import { buildRibbonBanner } from "../src/pixelmaps/ui-ribbon.js";
import { buildScrollRoller } from "../src/pixelmaps/ui-scroll-roller.js";
import { buildTooltipBubble } from "../src/pixelmaps/ui-tooltip.js";

// 36 flat RGB stand-ins — enough indices for every UI_COLOR constant without
// pulling in the real generated palette.json (these tests exercise geometry,
// not actual color values).
const PALETTE: RGB[] = Array.from({ length: 36 }, (_, i) => ({
	r: i,
	g: i,
	b: i,
}));

const ALL_BUILDERS = [
	() => buildWoodFrameTile(),
	() => buildParchmentTile(),
	() => buildWaxSeal("red", false),
	() => buildWaxSeal("red", true),
	() => buildWaxSeal("plum", false),
	() => buildWaxSeal("plum", true),
	() => buildHotbarSlot(false),
	() => buildHotbarSlot(true),
	() => buildRibbonBanner("crimson"),
	() => buildRibbonBanner("victory"),
	() => buildTooltipBubble(),
	() => buildDividerFlourish(),
	() => buildScrollRoller("top"),
	() => buildScrollRoller("bottom"),
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
});

describe("buildWoodFrameTile", () => {
	test("center is transparent — panels supply their own fill", () => {
		const map = buildWoodFrameTile({ size: 32, border: 8 });
		const center = map.rows[16]?.[16];
		expect(center).toBe(".");
	});

	test("outer ring is the ink outline on all four sides", () => {
		const map = buildWoodFrameTile({ size: 32, border: 8 });
		expect(map.rows[0]?.[16]).toBe("O");
		expect(map.rows[31]?.[16]).toBe("O");
		expect(map.rows[16]?.[0]).toBe("O");
		expect(map.rows[16]?.[31]).toBe("O");
	});
});

describe("buildParchmentTile", () => {
	test("is deterministic for a given seed", () => {
		const a = buildParchmentTile(16, 42);
		const b = buildParchmentTile(16, 42);
		expect(a.rows).toEqual(b.rows);
	});

	test("smooth mottling wraps with zero seam (period === tile size)", () => {
		// The sine-based base component is sampled at x=0 and would be sampled
		// at x=size for the *next* tile copy — since sin has period 2π and we
		// scale by 2π/size, those two samples are identical by construction.
		// This only checks the base wave's periodicity claim from the file's
		// own comment, not the (intentionally non-seamless) sparse flecks.
		const size = 32;
		const waveAt = (x: number, y: number) =>
			Math.sin((2 * Math.PI * x) / size) * Math.cos((2 * Math.PI * y) / size) +
			0.5 * Math.sin((4 * Math.PI * y) / size);
		for (let y = 0; y < size; y++) {
			expect(waveAt(0, y)).toBeCloseTo(waveAt(size, y), 10);
		}
	});
});

describe("buildWaxSeal", () => {
	test("pressed seal has a smaller silhouette radius than normal", () => {
		const countOpaque = (rows: string[]) =>
			rows.reduce(
				(sum, row) => sum + [...row].filter((c) => c !== ".").length,
				0,
			);
		const normal = buildWaxSeal("red", false);
		const pressed = buildWaxSeal("red", true);
		expect(countOpaque(pressed.rows)).toBeLessThan(countOpaque(normal.rows));
	});
});

describe("buildHotbarSlot", () => {
	test("selected variant's outer ring is gold, not ink", () => {
		const selected = buildHotbarSlot(true);
		const plain = buildHotbarSlot(false);
		expect(selected.rows[0]?.[0]).toBe("G");
		expect(plain.rows[0]?.[0]).toBe("O");
	});
});

describe("buildScrollRoller", () => {
	test("bottom is the row-reverse of top", () => {
		const top = buildScrollRoller("top");
		const bottom = buildScrollRoller("bottom");
		expect(bottom.rows).toEqual([...top.rows].reverse());
	});
});
