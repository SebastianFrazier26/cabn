import { describe, expect, test } from "vitest";
import { defeatFrames, hitFrame } from "../src/monster-fx.js";
import { type PixelMap, renderPixelMap } from "../src/pixelmap.js";
import { ghost } from "../src/pixelmaps/ghost.js";
import { gremlinIdle0, gremlinIdle1 } from "../src/pixelmaps/gremlin.js";
import { impIdle0 } from "../src/pixelmaps/imp.js";
import { ouroborosIdle0, ouroborosIdle1 } from "../src/pixelmaps/ouroboros.js";
import { rotSpriteIdle0, rotSpriteIdle1 } from "../src/pixelmaps/rot-sprite.js";
import {
	wardedMimicIdle0,
	wardedMimicIdle1,
} from "../src/pixelmaps/warded-mimic.js";
import {
	willOWispIdle0,
	willOWispIdle1,
} from "../src/pixelmaps/will-o-wisp.js";

// A real-ish palette: the FX lighten by nearest-colour lookup, so a flat
// gray ramp would collapse every tone onto one index.
const palette = Array.from({ length: 70 }, (_, i) => ({
	r: (i * 37) % 256,
	g: (i * 91) % 256,
	b: (i * 53) % 256,
}));

describe("redrawn legacy species", () => {
	const pairs: [PixelMap, PixelMap][] = [
		[rotSpriteIdle0, rotSpriteIdle1],
		[wardedMimicIdle0, wardedMimicIdle1],
		[gremlinIdle0, gremlinIdle1],
		[ouroborosIdle0, ouroborosIdle1],
		[willOWispIdle0, willOWispIdle1],
	];

	test.each(pairs)("%# renders both frames at one size", (a, b) => {
		expect(() => renderPixelMap(a, palette)).not.toThrow();
		expect(() => renderPixelMap(b, palette)).not.toThrow();
		expect([a.width, a.height]).toEqual([b.width, b.height]);
		expect(a.rows).not.toEqual(b.rows);
	});
});

describe("battle frames", () => {
	const sources = [ghost, impIdle0, ouroborosIdle0, willOWispIdle0];

	test.each(sources)("$name: hit + defeat frames keep idle0's size", (map) => {
		const frames = [
			hitFrame(map, palette, "x_hit"),
			...defeatFrames(map, palette, "x_defeat"),
		];
		for (const f of frames) {
			expect([f.width, f.height]).toEqual([map.width, map.height]);
			expect(() => renderPixelMap(f, palette)).not.toThrow();
		}
		expect(frames.map((f) => f.name)).toEqual([
			"x_hit",
			"x_defeat0",
			"x_defeat1",
			"x_defeat2",
		]);
	});

	test("deterministic: same input, same rows", () => {
		expect(defeatFrames(impIdle0, palette, "a")).toEqual(
			defeatFrames(impIdle0, palette, "a"),
		);
		expect(hitFrame(impIdle0, palette, "a")).toEqual(
			hitFrame(impIdle0, palette, "a"),
		);
	});

	test("hit keeps the silhouette but changes the colours", () => {
		const hit = hitFrame(impIdle0, palette, "h");
		const shape = (m: PixelMap) =>
			m.rows.map((r) => r.replace(/[^.]/g, "#")).join("\n");
		expect(shape(hit)).toEqual(shape(impIdle0));
		expect(Object.values(hit.legend).sort()).not.toEqual(
			Object.values(impIdle0.legend).sort(),
		);
	});
});
