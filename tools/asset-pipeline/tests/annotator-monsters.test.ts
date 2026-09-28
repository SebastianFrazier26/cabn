import { describe, expect, test } from "vitest";
import { type PixelMap, renderPixelMap } from "../src/pixelmap.js";
import { brambleIdle0, brambleIdle1 } from "../src/pixelmaps/bramble.js";
import { impIdle0, impIdle1 } from "../src/pixelmaps/imp.js";
import { magpieIdle0, magpieIdle1 } from "../src/pixelmaps/magpie.js";
import { mirrored, overlay } from "../src/pixelmaps/mirror.js";
import { shadeIdle0, shadeIdle1 } from "../src/pixelmaps/shade.js";
import { skeletonIdle0, skeletonIdle1 } from "../src/pixelmaps/skeleton.js";

const palette = Array.from({ length: 66 }, (_, i) => ({ r: i, g: i, b: i }));

describe("mirror helpers", () => {
	test("mirrored reflects each half row", () => {
		expect(mirrored(["ab.", "..c"])).toEqual(["ab..ba", "..cc.."]);
	});

	test("overlay stamps non-dot cells and clips at the edge", () => {
		expect(overlay(["....", "...."], 2, 1, ["xy.z"])).toEqual(["....", "..xy"]);
	});
});

describe("annotator species pixel maps", () => {
	const pairs: [PixelMap, PixelMap][] = [
		[impIdle0, impIdle1],
		[magpieIdle0, magpieIdle1],
		[skeletonIdle0, skeletonIdle1],
		[brambleIdle0, brambleIdle1],
		[shadeIdle0, shadeIdle1],
	];

	test.each(pairs)("%# renders both frames at one size", (a, b) => {
		expect(() => renderPixelMap(a, palette)).not.toThrow();
		expect(() => renderPixelMap(b, palette)).not.toThrow();
		expect([a.width, a.height]).toEqual([b.width, b.height]);
		expect(a.rows).not.toEqual(b.rows);
	});
});
