import { describe, expect, it } from "vitest";
import { placeScatter, type ScatterOptions } from "../src/systems/scatter.js";

const baseOptions: ScatterOptions = {
	clusterId: "cluster-a",
	centerX: 0,
	centerY: 0,
	radiusX: 150,
	radiusY: 100,
	count: 20,
	minSpacing: 18,
	variantCount: 5,
	exclusions: [],
};

function distance(
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("placeScatter", () => {
	it("is deterministic for the same clusterId and options", () => {
		const a = placeScatter(baseOptions);
		const b = placeScatter(baseOptions);
		expect(b).toEqual(a);
	});

	it("never places two points closer than minSpacing", () => {
		const points = placeScatter(baseOptions);
		expect(points.length).toBeGreaterThan(0);
		for (let i = 0; i < points.length; i++) {
			for (let j = i + 1; j < points.length; j++) {
				const p1 = points[i];
				const p2 = points[j];
				if (!p1 || !p2) continue;
				expect(distance(p1, p2)).toBeGreaterThanOrEqual(baseOptions.minSpacing);
			}
		}
	});

	it("never places a point inside an exclusion circle", () => {
		const exclusions = [
			{ x: 0, y: 0, radius: 60 },
			{ x: 80, y: 40, radius: 30 },
		];
		const points = placeScatter({ ...baseOptions, exclusions });
		for (const p of points) {
			for (const e of exclusions) {
				expect(distance(p, e)).toBeGreaterThanOrEqual(e.radius);
			}
		}
	});

	it("keeps every variant index within [0, variantCount)", () => {
		const points = placeScatter(baseOptions);
		for (const p of points) {
			expect(p.variant).toBeGreaterThanOrEqual(0);
			expect(p.variant).toBeLessThan(baseOptions.variantCount);
		}
	});

	it("scatters differently for a different clusterId", () => {
		const a = placeScatter(baseOptions);
		const b = placeScatter({ ...baseOptions, clusterId: "cluster-b" });
		expect(b).not.toEqual(a);
	});

	it("gives up placing more points once exclusions leave no room, without hanging or throwing", () => {
		const points = placeScatter({
			...baseOptions,
			count: 50,
			exclusions: [{ x: 0, y: 0, radius: 500 }], // covers the whole ellipse
		});
		expect(points).toEqual([]);
	});

	it("minRadiusFrac confines every point to the outer annulus", () => {
		const minRadiusFrac = 0.6;
		const points = placeScatter({ ...baseOptions, count: 40, minRadiusFrac });
		expect(points.length).toBeGreaterThan(0);
		for (const p of points) {
			// Normalized ellipse-radius of the point — >=1 is the ellipse edge,
			// 0 is dead center. Should never fall below minRadiusFrac (minus a
			// hair for floating-point rounding).
			const normalizedR = Math.hypot(
				p.x / baseOptions.radiusX,
				p.y / baseOptions.radiusY,
			);
			expect(normalizedR).toBeGreaterThanOrEqual(minRadiusFrac - 1e-9);
		}
	});

	it("minRadiusFrac 0 behaves exactly like the old whole-disk default", () => {
		const withZero = placeScatter({ ...baseOptions, minRadiusFrac: 0 });
		const withUndefined = placeScatter(baseOptions);
		expect(withZero).toEqual(withUndefined);
	});
});
