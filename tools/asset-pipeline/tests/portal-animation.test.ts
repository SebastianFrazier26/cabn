import { describe, expect, test } from "vitest";
import {
	computeMotePositions,
	portalArchFrame,
} from "../src/pixelmaps/portal-arch.js";

describe("computeMotePositions", () => {
	test("is deterministic: same frame index and count produce the same positions", () => {
		const a = computeMotePositions(2, 6, 5);
		const b = computeMotePositions(2, 6, 5);
		expect(a).toEqual(b);
	});

	test("advancing the frame index moves the motes", () => {
		const frame0 = computeMotePositions(0, 6, 5);
		const frame1 = computeMotePositions(1, 6, 5);
		expect(frame0).not.toEqual(frame1);
	});

	test("wrapping all the way around returns to the same positions", () => {
		const frame0 = computeMotePositions(0, 6, 5);
		const fullCircle = computeMotePositions(6, 6, 5);
		expect(fullCircle).toEqual(frame0);
	});
});

describe("portalArchFrame", () => {
	test("is deterministic and never overwrites stone with a mote", () => {
		const a = portalArchFrame(3, 6);
		const b = portalArchFrame(3, 6);
		expect(a.rows).toEqual(b.rows);

		// Every mote lands on what was a '.' in the static base grid — the
		// rendered char must be the mote's own color, never stone/moss/rune.
		const motes = computeMotePositions(3, 6);
		for (const { x, y, char } of motes) {
			expect(a.rows[y]?.[x]).toBe(char);
		}
	});

	test("different frames produce different pixel grids", () => {
		const a = portalArchFrame(0, 6);
		const b = portalArchFrame(3, 6);
		expect(a.rows).not.toEqual(b.rows);
	});
});
