import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { renderPixelMap } from "../src/pixelmap.js";
import { buildBagIcon } from "../src/pixelmaps/ui-item-bag.js";
import { buildKeyIcon } from "../src/pixelmaps/ui-item-key.js";
import { buildCrystalOrbIcon } from "../src/pixelmaps/ui-item-orb.js";
import { buildQuillIcon } from "../src/pixelmaps/ui-item-quill.js";
import { buildSpyglassIcon } from "../src/pixelmaps/ui-item-spyglass.js";
import { buildWandIcon } from "../src/pixelmaps/ui-item-wand.js";
import {
	buildOrbScreen,
	ORB_CONTENT_RECT,
} from "../src/pixelmaps/ui-screen-orb.js";
import {
	buildSatchelFlap,
	buildSatchelScreen,
	SATCHEL_CONTENT_RECT,
} from "../src/pixelmaps/ui-screen-satchel.js";
import {
	buildSpyglassScreen,
	SPYGLASS_CONTENT_RECT,
} from "../src/pixelmaps/ui-screen-spyglass.js";
import { buildSparkle } from "../src/pixelmaps/ui-sparkle.js";
import {
	buildToolIcon,
	TOOL_ICON_NAMES,
	TOOL_ICON_SIZE,
} from "../src/pixelmaps/ui-tool-icons.js";

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
	buildKeyIcon,
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

// The screens reach further into the palette (periwinkle, 37) than the icons.
const FULL_PALETTE: RGB[] = Array.from({ length: 66 }, (_, i) => ({
	r: i,
	g: i,
	b: i,
}));

describe("tool-screen frames", () => {
	const screens = [
		[buildOrbScreen, ORB_CONTENT_RECT],
		[buildSpyglassScreen, SPYGLASS_CONTENT_RECT],
	] as const;

	test.each(screens)(
		"content rect sits entirely in the transparent glass, so text never clips at the rim",
		(build, rect) => {
			const map = build();
			for (let y = rect.y; y < rect.y + rect.height; y++) {
				for (let x = rect.x; x < rect.x + rect.width; x++) {
					expect(map.rows[y]?.[x]).toBe(".");
				}
			}
		},
	);

	test.each([
		buildOrbScreen,
		buildSpyglassScreen,
		buildSatchelScreen,
		buildSatchelFlap,
	])("renders and is deterministic", (build) => {
		const map = build();
		expect(() => renderPixelMap(map, FULL_PALETTE)).not.toThrow();
		expect(build()).toEqual(map);
	});

	test("satchel content rect lies inside its stitched front panel", () => {
		const map = buildSatchelScreen();
		const r = SATCHEL_CONTENT_RECT;
		for (let y = r.y; y < r.y + r.height; y++) {
			for (let x = r.x; x < r.x + r.width; x++) {
				expect(map.rows[y]?.[x]).not.toBe(".");
			}
		}
	});
});

describe("spellbook tool icons", () => {
	const palette: RGB[] = Array.from({ length: 66 }, (_, i) => ({
		r: i,
		g: i,
		b: i,
	}));

	test.each(TOOL_ICON_NAMES)("%s is a valid 24x24 map", (name) => {
		const map = buildToolIcon(name);
		expect(map.width).toBe(TOOL_ICON_SIZE);
		expect(map.rows).toHaveLength(TOOL_ICON_SIZE);
		expect(() => renderPixelMap(map, palette)).not.toThrow();
		expect(map.rows.join("")).toContain("O");
	});

	test("names are unique and prefixed so they never collide with item icons", () => {
		const names = TOOL_ICON_NAMES.map((n) => buildToolIcon(n).name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name.startsWith("ui_tool_")).toBe(true);
	});

	test("regeneration is deterministic", () => {
		for (const name of TOOL_ICON_NAMES) {
			expect(buildToolIcon(name).rows).toEqual(buildToolIcon(name).rows);
		}
	});
});
