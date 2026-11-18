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

// 2026-11-17: parent/child edge gaps on big worlds had grown to thousands of
// px (every depth sat on one shared ring sized by the tree's total leaf
// width and its biggest clearing). Nodes now sit as close to their parent as
// their own wedge of the circle allows.
describe("computeLayout: large trees stay clear and compact", () => {
	// Seeded and local so the trees never depend on Math.random or on the
	// module under test.
	function lcg(seed: number): () => number {
		let state = seed;
		return () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state / 4294967296;
		};
	}

	function randomTree(count: number, seed: number): LayoutTreeNode {
		const rand = lcg(seed);
		const root: LayoutTreeNode = { id: "root", weight: 5, children: [] };
		const all = [root];
		while (all.length < count) {
			const parent = all[Math.floor(rand() * rand() * all.length)];
			if (!parent || parent.children.length >= 8) continue;
			const node: LayoutTreeNode = {
				id: `${parent.id}--n${all.length}`,
				weight: 1 + Math.floor(rand() * rand() * rand() * 40),
				children: [],
			};
			parent.children.push(node);
			all.push(node);
		}
		return root;
	}

	function wideTree(count: number): LayoutTreeNode {
		return {
			id: "root",
			weight: 2,
			children: Array.from({ length: count }, (_, i) => ({
				id: `c${i}`,
				weight: 1 + ((i * 7) % 20),
				children: [1, 2, 3].map((k) => ({
					id: `c${i}-${k}`,
					weight: k * 4,
					children: [],
				})),
			})),
		};
	}

	function deepTree(depth: number): LayoutTreeNode {
		let node: LayoutTreeNode = { id: "leaf", weight: 3, children: [] };
		for (let i = depth; i > 0; i--)
			node = {
				id: `n${i}`,
				weight: 2,
				children: [node, { id: `n${i}-side`, weight: 5, children: [] }],
			};
		return { id: "root", weight: 1, children: [node] };
	}

	interface Measured {
		positions: Map<string, LayoutPosition>;
		radius: Map<string, number>;
		edges: [string, string][];
	}

	function measure(tree: LayoutTreeNode): Measured {
		const radius = new Map<string, number>();
		const edges: [string, string][] = [];
		const walk = (node: LayoutTreeNode, parent?: string) => {
			radius.set(node.id, clearingRadius(node, parent !== undefined));
			if (parent) edges.push([parent, node.id]);
			for (const child of node.children) walk(child, node.id);
		};
		walk(tree);
		return { positions: computeLayout(tree), radius, edges };
	}

	function position(m: Measured, id: string): LayoutPosition {
		const p = m.positions.get(id);
		if (!p) throw new Error(`missing ${id}`);
		return p;
	}

	function gaps(m: Measured): number[] {
		return m.edges
			.map(([from, to]) => {
				const a = position(m, from);
				const b = position(m, to);
				return (
					Math.hypot(a.x - b.x, a.y - b.y) -
					(m.radius.get(from) ?? 0) -
					(m.radius.get(to) ?? 0)
				);
			})
			.sort((a, b) => a - b);
	}

	const trees: [string, () => LayoutTreeNode][] = [
		["100 random clusters", () => randomTree(100, 7)],
		["60 wide branches", () => wideTree(60)],
		["a 14-deep chain with side leaves", () => deepTree(14)],
	];

	test.each(trees)("no two clearings overlap: %s", (_name, build) => {
		const m = measure(build());
		const ids = [...m.positions.keys()];
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = position(m, ids[i] ?? "");
				const b = position(m, ids[j] ?? "");
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
					(m.radius.get(ids[i] ?? "") ?? 0) + (m.radius.get(ids[j] ?? "") ?? 0),
				);
			}
		}
	});

	test.each(trees.slice(0, 2))(
		"no path runs through a third clearing: %s",
		(_name, build) => {
			const m = measure(build());
			for (const [from, to] of m.edges) {
				for (const [id, p] of m.positions) {
					if (id === from || id === to) continue;
					expect(
						pointToSegment(p, position(m, from), position(m, to)),
					).toBeGreaterThan(m.radius.get(id) ?? 0);
				}
			}
		},
	);

	test("is deterministic on a large tree", () => {
		const a = computeLayout(randomTree(100, 7));
		const b = computeLayout(randomTree(100, 7));
		expect([...a.entries()]).toEqual([...b.entries()]);
	});

	test("keeps the typical parent-to-child gap bounded on a 100-cluster tree", () => {
		// The shared-ring layout measured a 1,670px median on this tree, the
		// current one ~1,100px; the rest is the few 40-file clusters, which
		// force a wide circle however the tree is arranged.
		const sorted = gaps(measure(randomTree(100, 7)));
		expect(sorted[0]).toBeGreaterThan(-1);
		expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(1300);
	});

	test("a big cluster in one branch does not push an unrelated branch outward", () => {
		const tree: LayoutTreeNode = {
			id: "root",
			weight: 1,
			children: [
				{ id: "big", weight: 40, children: [] },
				{
					id: "small",
					weight: 1,
					children: [{ id: "small--kid", weight: 1, children: [] }],
				},
			],
		};
		const m = measure(tree);
		const reach = (id: string) =>
			Math.hypot(position(m, id).x, position(m, id).y);
		const rootToSmall =
			reach("small") -
			(m.radius.get("root") ?? 0) -
			(m.radius.get("small") ?? 0);
		const smallToKid =
			reach("small--kid") -
			reach("small") -
			(m.radius.get("small") ?? 0) -
			(m.radius.get("small--kid") ?? 0);
		// Both were over 1,000px when "small" shared the big cluster's ring.
		expect(rootToSmall).toBeLessThan(300);
		expect(smallToKid).toBeLessThan(300);
	});
});
