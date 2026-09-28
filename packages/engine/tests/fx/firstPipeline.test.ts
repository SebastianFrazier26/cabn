import { describe, expect, it } from "vitest";
import { firstPipeline } from "../../src/fx/firstPipeline.js";

describe("firstPipeline", () => {
	it("treats Phaser's empty-array 'nothing attached' result as absent", () => {
		expect(firstPipeline<object>([])).toBeUndefined();
	});
	it("returns a lone instance as-is", () => {
		const p = { name: "glow" };
		expect(firstPipeline(p)).toBe(p);
	});
	it("returns the first of several matches", () => {
		const a = { name: "a" };
		expect(firstPipeline([a, { name: "b" }])).toBe(a);
	});
	it("maps null/undefined to undefined", () => {
		expect(firstPipeline<object>(undefined)).toBeUndefined();
		expect(firstPipeline<object>(null)).toBeUndefined();
	});
});
