import { describe, expect, test } from "vitest";
import { computeLayout, type LayoutTreeNode } from "../src/layout.js";

function sampleTree(): LayoutTreeNode {
	return {
		id: "root",
		weight: 2,
		children: [
			{
				id: "root--src",
				weight: 5,
				children: [
					{ id: "root--src--utils", weight: 3, children: [] },
					{ id: "root--src--api", weight: 1, children: [] },
				],
			},
			{ id: "root--docs", weight: 1, children: [] },
		],
	};
}

describe("computeLayout", () => {
	test("root always sits at the origin", () => {
		const positions = computeLayout(sampleTree());
		expect(positions.get("root")).toEqual({ x: 0, y: 0 });
	});

	test("is a pure function: identical input yields identical output", () => {
		const a = computeLayout(sampleTree());
		const b = computeLayout(sampleTree());
		expect([...a.entries()]).toEqual([...b.entries()]);
	});

	test("depth-1 nodes sit on the 450px ring", () => {
		const positions = computeLayout(sampleTree());
		for (const id of ["root--src", "root--docs"]) {
			const pos = positions.get(id);
			if (!pos) throw new Error(`expected a position for ${id}`);
			const radius = Math.hypot(pos.x, pos.y);
			// Jitter is +/-60px in each axis, so distance from the ring can move
			// by up to ~85px (sqrt(60^2+60^2)); assert it stayed in that band.
			expect(Math.abs(radius - 450)).toBeLessThan(85);
		}
	});

	test("depth-2 nodes sit on the 900px ring", () => {
		const positions = computeLayout(sampleTree());
		const pos = positions.get("root--src--utils");
		if (!pos) throw new Error("expected a position for root--src--utils");
		const radius = Math.hypot(pos.x, pos.y);
		expect(Math.abs(radius - 900)).toBeLessThan(85);
	});

	test("matches a recorded snapshot for a fixed tree", () => {
		const positions = Object.fromEntries(computeLayout(sampleTree()));
		expect(positions).toMatchSnapshot();
	});
});
