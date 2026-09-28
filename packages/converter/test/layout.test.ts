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

	// M10b batch-3 review: "the root cluster packs file arches tightly", cluster
	// footprints crowding/overlapping — a many-siblings tree is the case the
	// original angle-only slicing had no answer for (each sibling gets its own
	// angle, but a narrow weighted slice can still land two of them close
	// together in actual Cartesian distance).
	function manySiblingsTree(count: number): LayoutTreeNode {
		return {
			id: "root",
			weight: 1,
			children: Array.from({ length: count }, (_, i) => ({
				id: `root--child-${i}`,
				weight: 1,
				children: [],
			})),
		};
	}

	function minPairwiseDistance(positions: Map<string, LayoutPosition>): number {
		const points = [...positions.values()];
		let min = Number.POSITIVE_INFINITY;
		for (let i = 0; i < points.length; i++) {
			for (let j = i + 1; j < points.length; j++) {
				const a = points[i];
				const b = points[j];
				if (!a || !b) continue;
				min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
			}
		}
		return min;
	}

	test("keeps many equal-weight siblings from crowding closer than the minimum separation", () => {
		// 24 equal (weight-1) siblings on the depth-1 ring (450px) divide the
		// circle into 15deg slices, only ~118px apart at that radius — well
		// under the ~440px two weight-1 clusters now require (2x
		// estimatedClearingRadius(1) + the fixed gap) before this fix existed.
		// A fixed-pass pairwise relaxation converges toward that minimum
		// asymptotically (each pass closes half the *remaining* deficit, and
		// resolving one pair can nudge others back under it slightly), not
		// exactly — landing within a few px is "converged" for this
		// algorithm's purpose (never mind sub-pixel gaps between clearings).
		const positions = computeLayout(manySiblingsTree(24));
		expect(minPairwiseDistance(positions)).toBeGreaterThan(430);
	});

	test("never moves the root away from the origin even under crowding", () => {
		const positions = computeLayout(manySiblingsTree(24));
		expect(positions.get("root")).toEqual({ x: 0, y: 0 });
	});

	test("stays deterministic (identical input -> identical output) once separation is enforced", () => {
		const a = computeLayout(manySiblingsTree(24));
		const b = computeLayout(manySiblingsTree(24));
		expect([...a.entries()]).toEqual([...b.entries()]);
	});

	test("gives a heavily-weighted (many-file) cluster more separation from its neighbor than a light one", () => {
		// Same shape both times (two children directly under root, on top of
		// each other pre-relaxation via a 0-length span) — only the heavy
		// child's weight differs, so any distance difference is purely the
		// weight-scaled clearing radius at work, not the angle-slicing.
		const lightTree: LayoutTreeNode = {
			id: "root",
			weight: 1,
			children: [
				{ id: "a", weight: 1, children: [] },
				{ id: "b", weight: 1, children: [] },
			],
		};
		const heavyTree: LayoutTreeNode = {
			id: "root",
			weight: 1,
			children: [
				{ id: "a", weight: 40, children: [] },
				{ id: "b", weight: 1, children: [] },
			],
		};
		const lightDist = (() => {
			const p = computeLayout(lightTree);
			const a = p.get("a");
			const b = p.get("b");
			if (!a || !b) throw new Error("expected both a and b to be placed");
			return Math.hypot(a.x - b.x, a.y - b.y);
		})();
		const heavyDist = (() => {
			const p = computeLayout(heavyTree);
			const a = p.get("a");
			const b = p.get("b");
			if (!a || !b) throw new Error("expected both a and b to be placed");
			return Math.hypot(a.x - b.x, a.y - b.y);
		})();
		expect(heavyDist).toBeGreaterThan(lightDist);
	});
});
