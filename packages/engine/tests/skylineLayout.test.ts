import { describe, expect, it } from "vitest";
import {
	LAYER_SCROLL_FACTOR,
	parallaxCenter,
	parallaxSpan,
	planGrownSkyline,
	planSkyline,
	type SkylinePlanInput,
} from "../src/systems/skylineLayout.js";

const WIDTHS = {
	castle: 384,
	watchtower: 56,
	village: 160,
	hill: 192,
	treeline: 120,
};

function input(overrides: Partial<SkylinePlanInput> = {}): SkylinePlanInput {
	return {
		seed: "world-1",
		scrollMin: -1400,
		scrollMax: 900,
		viewWidth: 2200,
		widths: WIDTHS,
		...overrides,
	};
}

describe("parallaxSpan", () => {
	it("covers the viewport at both ends of the scroll range", () => {
		const sf = 0.45;
		const [lo, hi] = parallaxSpan(-1400, 900, 1280, sf, 0);
		for (const scrollX of [-1400, 900]) {
			// screen x = u - scrollX * sf; the span must reach 0..1280 on screen.
			expect(lo - scrollX * sf).toBeLessThanOrEqual(0);
			expect(hi - scrollX * sf).toBeGreaterThanOrEqual(1280);
		}
	});

	it("handles a reversed range", () => {
		expect(parallaxSpan(900, -1400, 1280, 1, 0)).toEqual(
			parallaxSpan(-1400, 900, 1280, 1, 0),
		);
	});
});

describe("parallaxCenter", () => {
	it("lands on screen center when the camera is mid-range", () => {
		const sf = 0.7;
		const u = parallaxCenter(-1000, 600, 1280, sf);
		expect(u - -200 * sf).toBeCloseTo(640);
	});
});

describe("planSkyline", () => {
	it("is deterministic per seed", () => {
		expect(planSkyline(input())).toEqual(planSkyline(input()));
		expect(planSkyline(input())).not.toEqual(
			planSkyline(input({ seed: "world-2" })),
		);
	});

	it("has exactly one castle, in the far layer, flanked by two villages", () => {
		const plan = planSkyline(input());
		const castles = plan.filter((e) => e.piece === "castle");
		expect(castles).toHaveLength(1);
		expect(castles[0]?.layer).toBe("far");
		const villages = plan.filter((e) => e.piece === "village");
		expect(villages).toHaveLength(2);
		const castleU = castles[0]?.u ?? 0;
		expect(villages.some((v) => v.u < castleU)).toBe(true);
		expect(villages.some((v) => v.u > castleU)).toBe(true);
	});

	it("lays hills and treeline edge to edge with no gaps across the whole span", () => {
		const plan = planSkyline(input());
		for (const [piece, layer] of [
			["hill", "mid"],
			["treeline", "near"],
		] as const) {
			const els = plan
				.filter((e) => e.piece === piece)
				.sort((a, b) => a.u - b.u);
			expect(els.every((e) => e.layer === layer)).toBe(true);
			const [lo, hi] = parallaxSpan(
				-1400,
				900,
				2200,
				LAYER_SCROLL_FACTOR[layer],
				400,
			);
			const first = els[0];
			const last = els[els.length - 1];
			if (!first || !last) throw new Error("no elements");
			expect(first.u - (WIDTHS[piece] * first.scale) / 2).toBeLessThanOrEqual(
				lo,
			);
			expect(last.u + (WIDTHS[piece] * last.scale) / 2).toBeGreaterThanOrEqual(
				hi,
			);
			for (let i = 1; i < els.length; i++) {
				const prev = els[i - 1];
				const cur = els[i];
				if (!prev || !cur) continue;
				const prevRight = prev.u + (WIDTHS[piece] * prev.scale) / 2;
				const curLeft = cur.u - (WIDTHS[piece] * cur.scale) / 2;
				expect(curLeft).toBeLessThanOrEqual(prevRight);
			}
		}
	});

	it("orders layers far-to-near by scroll factor", () => {
		expect(LAYER_SCROLL_FACTOR.far).toBeLessThan(LAYER_SCROLL_FACTOR.mid);
		expect(LAYER_SCROLL_FACTOR.mid).toBeLessThan(LAYER_SCROLL_FACTOR.near);
		expect(LAYER_SCROLL_FACTOR.near).toBe(1);
	});
});

describe("planGrownSkyline", () => {
	it("keeps the base plan and covers only the grown span", () => {
		const base = planSkyline(input());
		const grown = planGrownSkyline(input(), {
			scrollMin: -2600,
			scrollMax: 1900,
		});
		expect(grown.slice(0, base.length)).toEqual(base);
		const extra = grown.slice(base.length);
		expect(extra.length).toBeGreaterThan(0);
		expect(
			extra.every((e) => e.piece === "hill" || e.piece === "treeline"),
		).toBe(true);
		for (const layer of ["mid", "near"] as const) {
			const piece = layer === "mid" ? "hill" : "treeline";
			const [lo, hi] = parallaxSpan(
				-2600,
				1900,
				2200,
				LAYER_SCROLL_FACTOR[layer],
				400,
			);
			const us = grown
				.filter((e) => e.layer === layer)
				.map((e) => e.u)
				.sort((a, b) => a - b);
			expect(us[0] ?? 0).toBeLessThanOrEqual(lo);
			expect(us[us.length - 1] ?? 0).toBeGreaterThanOrEqual(hi);
			for (let i = 1; i < us.length; i++)
				expect((us[i] ?? 0) - (us[i - 1] ?? 0)).toBeLessThan(
					WIDTHS[piece] * 1.9 * 0.72 + 1,
				);
		}
	});

	it("is the base plan when the range didn't grow", () => {
		expect(
			planGrownSkyline(input(), { scrollMin: -1400, scrollMax: 900 }),
		).toEqual(planSkyline(input()));
	});
});
