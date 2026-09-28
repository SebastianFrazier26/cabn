import { describe, expect, test } from "vitest";
import { contrastRatio, hexToRgb } from "../src/contrast.js";

describe("contrastRatio", () => {
	test("black on white is the maximum, 21:1", () => {
		expect(contrastRatio(hexToRgb("#000000"), hexToRgb("#ffffff"))).toBeCloseTo(
			21,
			1,
		);
	});

	test("a color against itself is the minimum, 1:1", () => {
		expect(contrastRatio(hexToRgb("#efe0b3"), hexToRgb("#efe0b3"))).toBeCloseTo(
			1,
			5,
		);
	});

	test("is symmetric regardless of argument order", () => {
		const a = hexToRgb("#322214");
		const b = hexToRgb("#efe0b3");
		expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
	});
});

describe("hexToRgb", () => {
	test("parses with or without a leading #", () => {
		expect(hexToRgb("#e99b33")).toEqual({ r: 0xe9, g: 0x9b, b: 0x33 });
		expect(hexToRgb("e99b33")).toEqual({ r: 0xe9, g: 0x9b, b: 0x33 });
	});
});
