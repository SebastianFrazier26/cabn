import { describe, expect, test } from "vitest";
import { colorDistance, type WeightedColor } from "../src/color.js";
import { medianCut } from "../src/median-cut.js";

function cluster(
	center: { r: number; g: number; b: number },
	count: number,
	jitter: number,
): WeightedColor[] {
	const out: WeightedColor[] = [];
	for (let i = 0; i < count; i++) {
		const d = (i % jitter) - Math.floor(jitter / 2);
		out.push({ r: center.r + d, g: center.g + d, b: center.b + d, count: 1 });
	}
	return out;
}

describe("medianCut", () => {
	test("recovers one representative color per well-separated cluster", () => {
		// Counts are chosen so the population-median split lands exactly on a
		// cluster boundary at each recursion level: first split (by R, the
		// widest channel) separates `a` (half the total weight) from `b`+`c`;
		// second split (by G, now the widest remaining channel) separates
		// `b` from `c`. A naive/unequal weighting would cut through a cluster
		// instead of between them.
		const a = { r: 10, g: 10, b: 10 };
		const b = { r: 200, g: 10, b: 10 };
		const c = { r: 200, g: 200, b: 10 };
		const pixels = [
			...cluster(a, 300, 2),
			...cluster(b, 150, 2),
			...cluster(c, 150, 2),
		];

		const palette = medianCut(pixels, 3);

		expect(palette).toHaveLength(3);
		for (const center of [a, b, c]) {
			const nearest = Math.min(...palette.map((p) => colorDistance(p, center)));
			expect(nearest).toBeLessThan(5);
		}
	});

	test("never returns more colors than distinct input pixels", () => {
		const pixels: WeightedColor[] = [
			{ r: 1, g: 1, b: 1, count: 5 },
			{ r: 2, g: 2, b: 2, count: 5 },
		];
		expect(medianCut(pixels, 32)).toHaveLength(2);
	});

	test("empty input yields empty palette", () => {
		expect(medianCut([], 32)).toHaveLength(0);
	});
});
