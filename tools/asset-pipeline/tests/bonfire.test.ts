import { describe, expect, test } from "vitest";
import {
	bonfireFrame,
	computeFlameHeight,
	FLAME_ZONE,
} from "../src/pixelmaps/bonfire.js";

describe("computeFlameHeight", () => {
	test("is deterministic: same column and frame produce the same height", () => {
		const a = computeFlameHeight(4, 1, 4);
		const b = computeFlameHeight(4, 1, 4);
		expect(a).toBe(b);
	});

	test("advancing the frame index changes at least one column's height", () => {
		const totalFrames = 4;
		const columns = Array.from({ length: FLAME_ZONE.width }, (_, i) => i);
		const frame0 = columns.map((c) => computeFlameHeight(c, 0, totalFrames));
		const frame1 = columns.map((c) => computeFlameHeight(c, 1, totalFrames));
		expect(frame0).not.toEqual(frame1);
	});

	test("wrapping all the way around returns to the same heights", () => {
		const totalFrames = 4;
		const columns = Array.from({ length: FLAME_ZONE.width }, (_, i) => i);
		const frame0 = columns.map((c) => computeFlameHeight(c, 0, totalFrames));
		const fullCircle = columns.map((c) =>
			computeFlameHeight(c, totalFrames, totalFrames),
		);
		expect(fullCircle).toEqual(frame0);
	});
});

describe("bonfireFrame", () => {
	test("is deterministic and never overwrites a log or stone pixel with flame", () => {
		const a = bonfireFrame(2, 4);
		const b = bonfireFrame(2, 4);
		expect(a.rows).toEqual(b.rows);

		// Every cell the static base map already colored (not '.') must survive
		// unchanged in the rendered frame.
		const base = bonfireFrame(0, 1).rows; // frame content differs, base structure doesn't
		for (let y = 0; y < a.height; y++) {
			for (let x = 0; x < a.width; x++) {
				// Compare against the logs/stones region only (below the flame
				// zone's bottom), which no frame's flame is allowed to touch.
				if (y < FLAME_ZONE.y + FLAME_ZONE.height) continue;
				expect(a.rows[y]?.[x]).toBe(base[y]?.[x]);
			}
		}
	});

	test("different frames produce different pixel grids", () => {
		const a = bonfireFrame(0, 4);
		const b = bonfireFrame(2, 4);
		expect(a.rows).not.toEqual(b.rows);
	});
});
