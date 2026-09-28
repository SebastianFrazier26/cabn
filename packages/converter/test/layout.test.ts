import { describe, expect, test } from "vitest";
import {
	computeLayout,
	type LayoutPosition,
	type LayoutTreeNode,
	portalRingBaseRadius,
} from "../src/layout.js";

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

	// Jitter is +/-60px in each axis, so distance from a ring can move by up to
	// ~85px (sqrt(60^2+60^2)).
	const JITTER_BAND = 85;

	test("depth-1 nodes share one ring, never inside the 600px minimum", () => {
		const positions = computeLayout(sampleTree());
		const radii = ["root--src", "root--docs"].map((id) => {
			const pos = positions.get(id);
			if (!pos) throw new Error(`expected a position for ${id}`);
			return Math.hypot(pos.x, pos.y);
		});
		for (const r of radii) expect(r).toBeGreaterThan(600 - JITTER_BAND);
		expect(Math.abs((radii[0] ?? 0) - (radii[1] ?? 0))).toBeLessThan(
			JITTER_BAND * 2,
		);
	});

	test("depth-2 nodes sit at least a full ring step further out", () => {
		const positions = computeLayout(sampleTree());
		const pos = positions.get("root--src--utils");
		const parent = positions.get("root--src");
		if (!pos || !parent) throw new Error("expected positions");
		expect(Math.hypot(pos.x, pos.y)).toBeGreaterThan(
			Math.hypot(parent.x, parent.y) + 600 - JITTER_BAND * 2,
		);
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
		// 24 equal (weight-1) siblings on the depth-1 ring (600px) divide the
		// circle into 15deg slices, only ~157px apart at that radius — well
		// under the ~600px two weight-1 clusters now require (2x
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

// 2026-09-28 playtest round 2: the demo world (apps/demo/sample-project) —
// eight depth-1 directories under a four-file root, most with a single file,
// one (src) with a child of its own. The old file-count slicing gave src a
// 120deg wedge and every one-file sibling 24deg, so separation shoved them
// out to anywhere between 600 and 1150px, at gaps from 16 to 66deg — and
// pushed "config" straight behind "data", its path running through data's
// arch ring.
function demoTree(): LayoutTreeNode {
	const leaf = (id: string, weight: number): LayoutTreeNode => ({
		id,
		weight,
		children: [],
	});
	return {
		id: "root",
		weight: 4,
		children: [
			leaf("assets", 1),
			leaf("config", 1),
			leaf("data", 1),
			leaf("docs", 1),
			leaf("lib", 3),
			leaf("scripts", 1),
			{ id: "src", weight: 2, children: [leaf("src--routes", 3)] },
			leaf("tests", 2),
		],
	};
}

function clearingRadius(node: LayoutTreeNode, hasParent: boolean): number {
	return (
		portalRingBaseRadius(
			node.weight,
			node.children.length + (hasParent ? 1 : 0),
		) + 90
	);
}

function pointToSegment(
	p: LayoutPosition,
	a: LayoutPosition,
	b: LayoutPosition,
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = Math.max(
		0,
		Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
	);
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe("computeLayout: even, path-clear spacing (playtest round 2)", () => {
	test("spreads equal-footprint siblings at even angles", () => {
		const positions = computeLayout(demoTree());
		const angles = demoTree()
			.children.map((c) => {
				const p = positions.get(c.id);
				if (!p) throw new Error(`missing ${c.id}`);
				return (Math.atan2(p.y, p.x) + Math.PI * 2) % (Math.PI * 2);
			})
			.sort((a, b) => a - b);
		const gaps = angles.map((a, i) => {
			const next = angles[(i + 1) % angles.length] ?? 0;
			return (next - a + Math.PI * 2) % (Math.PI * 2);
		});
		const even = (Math.PI * 2) / angles.length;
		// +/-60px jitter at an ~800px ring is worth ~+/-4deg per node.
		for (const gap of gaps) expect(Math.abs(gap - even)).toBeLessThan(0.16);
	});

	test("keeps every depth-1 cluster on the same ring instead of shoving some outward", () => {
		const positions = computeLayout(demoTree());
		const radii = demoTree().children.map((c) => {
			const p = positions.get(c.id);
			if (!p) throw new Error(`missing ${c.id}`);
			return Math.hypot(p.x, p.y);
		});
		expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(170);
	});

	test("no path runs through a third cluster's clearing", () => {
		const tree = demoTree();
		const positions = computeLayout(tree);
		const radius = new Map<string, number>();
		const paths: [string, string][] = [];
		const walk = (node: LayoutTreeNode, parent?: string) => {
			radius.set(node.id, clearingRadius(node, parent !== undefined));
			if (parent) paths.push([parent, node.id]);
			for (const child of node.children) walk(child, node.id);
		};
		walk(tree);
		for (const [from, to] of paths) {
			const a = positions.get(from);
			const b = positions.get(to);
			if (!a || !b) throw new Error("missing endpoint");
			for (const [id, p] of positions) {
				if (id === from || id === to) continue;
				expect(pointToSegment(p, a, b)).toBeGreaterThan(radius.get(id) ?? 0);
			}
		}
	});

	test("sizes the root's clearing for a gate per outgoing path", () => {
		// 4 arches + 8 paths spread evenly: 8 arcs of (1 arch slot + 1 gate).
		expect(portalRingBaseRadius(4, 8)).toBeCloseTo((8 * 288) / (Math.PI * 2));
		expect(portalRingBaseRadius(1, 1)).toBe(180);
		expect(portalRingBaseRadius(0, 3)).toBe(180);
		expect(portalRingBaseRadius(12, 0)).toBeCloseTo((12 * 192) / (Math.PI * 2));
	});
});
