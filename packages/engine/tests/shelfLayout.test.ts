import { describe, expect, test } from "vitest";
import {
	CABIN_RING_RADIUS,
	CABIN_SLOT_PX,
	cabinPosition,
	cabinRingRadius,
} from "../src/systems/shelfLayout.js";

describe("shelf cabin ring", () => {
	test("keeps the classic 480px radius up to 8 cabins", () => {
		for (let n = 1; n <= 8; n++)
			expect(cabinRingRadius(n)).toBe(CABIN_RING_RADIUS);
	});

	test("adjacent cabins are always at least one slot apart", () => {
		for (let n = 2; n <= 24; n++) {
			const a = cabinPosition(0, n);
			const b = cabinPosition(1, n);
			expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
				CABIN_SLOT_PX - 1e-6,
			);
		}
	});

	test("7 and 8 cabins: no two cabins within a slot of each other", () => {
		for (const n of [7, 8]) {
			const all = Array.from({ length: n }, (_, i) => cabinPosition(i, n));
			for (let i = 0; i < n; i++)
				for (let j = i + 1; j < n; j++) {
					const p = all[i] as { x: number; y: number };
					const q = all[j] as { x: number; y: number };
					expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(
						CABIN_SLOT_PX,
					);
				}
		}
	});

	test("the first cabin stays due north", () => {
		const p = cabinPosition(0, 7);
		expect(p.x).toBeCloseTo(0, 6);
		expect(p.y).toBeCloseTo(-CABIN_RING_RADIUS, 6);
	});
});
