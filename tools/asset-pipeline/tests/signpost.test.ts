import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { paletteJsonPath } from "../src/paths.js";
import {
	SIGNPOST_HEIGHT,
	SIGNPOST_WIDTH,
	signIconMap,
	signpostMap,
} from "../src/pixelmaps/signpost.js";
import { renderSignpost } from "../src/signpost.js";

const palette: RGB[] = JSON.parse(
	readFileSync(paletteJsonPath, "utf8"),
).colors.map((c: { rgb: RGB }) => c.rgb);

describe("signpost pixelmap", () => {
	test("the player's 24x32 grid, every row the right width", () => {
		for (const map of [signpostMap(), signIconMap()]) {
			expect(map.width).toBe(SIGNPOST_WIDTH);
			expect(map.height).toBe(SIGNPOST_HEIGHT);
			for (const row of map.rows) expect(row.length).toBe(SIGNPOST_WIDTH);
		}
	});

	test("the silhouette is ringed in ink", () => {
		const { rows } = signpostMap();
		const at = (x: number, y: number) => rows[y]?.[x] ?? ".";
		for (let y = 0; y < SIGNPOST_HEIGHT; y++) {
			for (let x = 0; x < SIGNPOST_WIDTH; x++) {
				const c = at(x, y);
				if (c === "." || c === "O") continue;
				for (const [dx, dy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				] as const) {
					expect(at(x + dx, y + dy), `(${x},${y})`).not.toBe(".");
				}
			}
		}
	});

	test("renders with the shared palette, deterministically", () => {
		const a = renderSignpost(palette);
		const b = renderSignpost(palette);
		expect(a.soft.data.equals(b.soft.data)).toBe(true);
		expect(a.iconSoft.data.equals(b.iconSoft.data)).toBe(true);
		expect(a.soft.width).toBe(SIGNPOST_WIDTH * 16);
		expect(a.soft.height).toBe(SIGNPOST_HEIGHT * 16);
	});
});
