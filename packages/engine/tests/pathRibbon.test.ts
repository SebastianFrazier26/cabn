import { describe, expect, it } from "vitest";
import {
	planPathRibbon,
	type RibbonSegment,
} from "../src/render/pathRibbon.js";

const OPTS = { edgeRadius: 17, bedRadius: 12, cobbleVariants: 4 };

// Five spokes out of one hub (like the bonfire) plus one chain segment.
const STAR: RibbonSegment[] = [
	{ id: "a", from: { x: 0, y: 0 }, to: { x: 300, y: 0 } },
	{ id: "b", from: { x: 0, y: 0 }, to: { x: -200, y: 150 } },
	{ id: "c", from: { x: 0, y: 0 }, to: { x: 40, y: -320 } },
	{ id: "d", from: { x: 0, y: 0 }, to: { x: -260, y: -90 } },
	{ id: "e", from: { x: 0, y: 0 }, to: { x: 120, y: 280 } },
	{ id: "f", from: { x: 300, y: 0 }, to: { x: 520, y: 180 } },
];

function distToSegment(p: { x: number; y: number }, s: RibbonSegment): number {
	const dx = s.to.x - s.from.x;
	const dy = s.to.y - s.from.y;
	const t = Math.max(
		0,
		Math.min(
			1,
			((p.x - s.from.x) * dx + (p.y - s.from.y) * dy) / (dx * dx + dy * dy),
		),
	);
	return Math.hypot(p.x - (s.from.x + dx * t), p.y - (s.from.y + dy * t));
}

describe("planPathRibbon", () => {
	it("is deterministic", () => {
		expect(planPathRibbon(STAR, OPTS)).toEqual(planPathRibbon(STAR, OPTS));
	});

	it("puts a plaza only where three or more paths meet", () => {
		const plan = planPathRibbon(STAR, OPTS);
		expect(plan.plazas).toHaveLength(1);
		expect(plan.plazas[0]).toMatchObject({ x: 0, y: 0 });
		// (300, 0) joins only two segments — a bend, not a plaza.
	});

	it("never stacks two cobbles on top of each other where segments overlap", () => {
		const { cobbles } = planPathRibbon(STAR, OPTS);
		for (let i = 0; i < cobbles.length; i++) {
			for (let j = i + 1; j < cobbles.length; j++) {
				const a = cobbles[i];
				const b = cobbles[j];
				if (!a || !b) continue;
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
					5.5 - 1e-9,
				);
			}
		}
	});

	it("keeps every cobble inside the mortar bed of some segment or plaza", () => {
		const plan = planPathRibbon(STAR, OPTS);
		for (const c of plan.cobbles) {
			const inSegment = STAR.some((s) => distToSegment(c, s) <= OPTS.bedRadius);
			const inPlaza = plan.plazas.some(
				(p) => Math.hypot(c.x - p.x, c.y - p.y) <= p.radius,
			);
			expect(inSegment || inPlaza).toBe(true);
			expect(c.variant).toBeGreaterThanOrEqual(0);
			expect(c.variant).toBeLessThan(OPTS.cobbleVariants);
		}
	});

	it("covers each segment continuously with edge discs (no gaps at any point along it)", () => {
		const plan = planPathRibbon(STAR, OPTS);
		for (const seg of STAR) {
			const len = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
			for (let d = 0; d <= len; d += 3) {
				const p = {
					x: seg.from.x + ((seg.to.x - seg.from.x) * d) / len,
					y: seg.from.y + ((seg.to.y - seg.from.y) * d) / len,
				};
				const nearest = Math.min(
					...plan.edgeStamps.map((s) => Math.hypot(s.x - p.x, s.y - p.y)),
				);
				expect(nearest).toBeLessThan(OPTS.edgeRadius * 0.5);
			}
		}
	});

	it("lays cobbles along a lone straight segment at a consistent width", () => {
		const seg: RibbonSegment[] = [
			{ id: "solo", from: { x: 0, y: 0 }, to: { x: 400, y: 0 } },
		];
		const { cobbles, plazas } = planPathRibbon(seg, OPTS);
		expect(plazas).toHaveLength(0);
		const ys = cobbles.map((c) => c.y);
		expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(
			OPTS.bedRadius * 2,
		);
		expect(cobbles.length).toBeGreaterThan(100);
	});

	// Golden values taken from the original string-keyed Map implementation
	// (2026-11-18): the typed-array spatial hash must reproduce its output bit
	// for bit, since cobble positions are the world's path art.
	describe("matches the original dedup output exactly", () => {
		const fnv = (str: string): number => {
			let h = 2166136261;
			for (let i = 0; i < str.length; i++) {
				h ^= str.charCodeAt(i);
				h = Math.imul(h, 16777619);
			}
			return h >>> 0;
		};
		const summarize = (segments: RibbonSegment[]) => {
			const plan = planPathRibbon(segments, OPTS);
			return {
				edge: plan.edgeStamps.length,
				bed: plan.bedStamps.length,
				cobbles: plan.cobbles.length,
				plazas: plan.plazas.length,
				hash: fnv(JSON.stringify(plan)),
			};
		};

		it("on a hub with spokes", () => {
			expect(summarize(STAR)).toEqual({
				edge: 333,
				bed: 482,
				cobbles: 726,
				plazas: 1,
				hash: 3954228690,
			});
		});

		it("on a dense lattice of crossing and duplicated segments", () => {
			const grid: RibbonSegment[] = [];
			for (let i = 0; i < 10; i++) {
				for (let j = 0; j < 10; j++) {
					const x = (i - 5) * 40;
					const y = (j - 5) * 40;
					if (i < 9)
						grid.push({
							id: `h${i},${j}`,
							from: { x, y },
							to: { x: x + 40, y },
						});
					if (j < 9)
						grid.push({
							id: `v${i},${j}`,
							from: { x, y },
							to: { x, y: y + 40 },
						});
				}
			}
			grid.push({
				id: "dup",
				from: { x: -200, y: -200 },
				to: { x: 160, y: -200 },
			});
			expect(summarize(grid)).toEqual({
				edge: 4540,
				bed: 7947,
				cobbles: 2942,
				plazas: 98,
				hash: 864584147,
			});
		});

		it("when plazas outgrow the table's initial size, across negative coordinates", () => {
			const stubs: RibbonSegment[] = [];
			for (let i = 0; i < 100; i++) {
				const x = i * 100 - 3000;
				const y = (i % 7) * 130 - 400;
				for (let k = 0; k < 3; k++) {
					const a = (k * Math.PI * 2) / 3;
					stubs.push({
						id: `s${i}.${k}`,
						from: { x, y },
						to: { x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 10 },
					});
				}
			}
			expect(summarize(stubs)).toEqual({
				edge: 4000,
				bed: 7200,
				cobbles: 3700,
				plazas: 100,
				hash: 2405251319,
			});
		});
	});
});
