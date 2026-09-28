import { describe, expect, it } from "vitest";
import { stampPointsAlongSegment } from "../src/render/pathStamps.js";

describe("stampPointsAlongSegment", () => {
	it("places points evenly spaced along a horizontal segment with no jitter", () => {
		const points = stampPointsAlongSegment(
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			25,
		);
		expect(points).toHaveLength(5); // round(100/25) + 1 endpoints
		for (const p of points) expect(p.y).toBeCloseTo(0);
		for (let i = 1; i < points.length; i++) {
			const prev = points[i - 1];
			const cur = points[i];
			if (!prev || !cur) continue;
			expect(Math.hypot(cur.x - prev.x, cur.y - prev.y)).toBeCloseTo(25, 5);
		}
	});

	it("lands exactly on both endpoints", () => {
		const points = stampPointsAlongSegment(
			{ x: 10, y: 10 },
			{ x: 10, y: 130 },
			30,
		);
		const first = points[0];
		const last = points[points.length - 1];
		expect(first).toEqual({ x: 10, y: 10, angle: Math.PI / 2 });
		expect(last?.x).toBeCloseTo(10);
		expect(last?.y).toBeCloseTo(130);
	});

	it("adjusts spacing down rather than leaving a short leftover gap", () => {
		// length 90 / spacing 25 -> round to 4 segments of 22.5, not 3 of 25 + a 15 remainder.
		const points = stampPointsAlongSegment({ x: 0, y: 0 }, { x: 90, y: 0 }, 25);
		expect(points).toHaveLength(5);
		expect(points[1]?.x).toBeCloseTo(22.5);
	});

	it("is deterministic given the same jitterSeed", () => {
		const a = stampPointsAlongSegment({ x: 0, y: 0 }, { x: 200, y: 50 }, 20, {
			jitterAmount: 4,
			jitterSeed: 7,
		});
		const b = stampPointsAlongSegment({ x: 0, y: 0 }, { x: 200, y: 50 }, 20, {
			jitterAmount: 4,
			jitterSeed: 7,
		});
		expect(b).toEqual(a);
	});

	it("keeps jittered points within jitterAmount of the unjittered line", () => {
		const angle = Math.atan2(50, 200);
		const jittered = stampPointsAlongSegment(
			{ x: 0, y: 0 },
			{ x: 200, y: 50 },
			20,
			{ jitterAmount: 5, jitterSeed: 3 },
		);
		const unjittered = stampPointsAlongSegment(
			{ x: 0, y: 0 },
			{ x: 200, y: 50 },
			20,
		);
		for (let i = 0; i < jittered.length; i++) {
			const j = jittered[i];
			const u = unjittered[i];
			if (!j || !u) continue;
			// Perpendicular displacement magnitude — project the offset onto the
			// segment's normal rather than raw distance, since jitter is only ever
			// applied perpendicular to travel direction.
			const nx = -Math.sin(angle);
			const ny = Math.cos(angle);
			const perpDist = Math.abs((j.x - u.x) * nx + (j.y - u.y) * ny);
			expect(perpDist).toBeLessThanOrEqual(5 + 1e-9);
		}
	});

	it("returns a single point for a zero-length segment instead of dividing by zero", () => {
		const points = stampPointsAlongSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, 20);
		expect(points).toEqual([{ x: 5, y: 5, angle: 0 }]);
	});
});
