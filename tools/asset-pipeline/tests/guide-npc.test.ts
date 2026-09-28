import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { renderGuideNpc } from "../src/guide-npc.js";
import { paletteJsonPath } from "../src/paths.js";
import { renderPixelMap } from "../src/pixelmap.js";
import {
	GUIDE_NPC_FRAME_COUNT,
	GUIDE_NPC_HEIGHT,
	GUIDE_NPC_PORTRAIT_CROP,
	GUIDE_NPC_WIDTH,
	guideNpcBubble,
	guideNpcFrame,
} from "../src/pixelmaps/guide-npc.js";

const palette: RGB[] = JSON.parse(
	readFileSync(paletteJsonPath, "utf8"),
).colors.map((c: { rgb: RGB }) => c.rgb);

function cellAt(frame: number, x: number, y: number): string {
	return guideNpcFrame(frame).rows[y]?.[x] ?? ".";
}

describe("guide npc pixelmap", () => {
	test("every frame is the player's 24x32 grid and renders with the shared palette", () => {
		for (let i = 0; i < GUIDE_NPC_FRAME_COUNT; i++) {
			const map = guideNpcFrame(i);
			expect(map.width).toBe(GUIDE_NPC_WIDTH);
			expect(map.height).toBe(GUIDE_NPC_HEIGHT);
			expect(() => renderPixelMap(map, palette)).not.toThrow();
		}
		expect(() => renderPixelMap(guideNpcBubble, palette)).not.toThrow();
	});

	test("the silhouette is ringed in ink: no coloured cell touches transparency directly", () => {
		const map = guideNpcFrame(0);
		for (let y = 0; y < map.height; y++) {
			for (let x = 0; x < map.width; x++) {
				const c = cellAt(0, x, y);
				if (c === "." || c === "O") continue;
				for (const [dx, dy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				] as const) {
					expect(cellAt(0, x + dx, y + dy), `(${x},${y})`).not.toBe(".");
				}
			}
		}
	});

	test("frames differ only in the lantern flame and the eyes", () => {
		const changed = new Set<string>();
		for (let i = 1; i < GUIDE_NPC_FRAME_COUNT; i++) {
			for (let y = 0; y < GUIDE_NPC_HEIGHT; y++) {
				for (let x = 0; x < GUIDE_NPC_WIDTH; x++) {
					if (cellAt(i, x, y) !== cellAt(0, x, y)) changed.add(`${x},${y}`);
				}
			}
		}
		expect([...changed].sort()).toEqual(
			["10,8", "13,8", "20,20", "21,20"].sort(),
		);
	});

	test("the portrait crop stays inside the frame", () => {
		const c = GUIDE_NPC_PORTRAIT_CROP;
		expect(c.x + c.w).toBeLessThanOrEqual(GUIDE_NPC_WIDTH);
		expect(c.y + c.h).toBeLessThanOrEqual(GUIDE_NPC_HEIGHT);
	});

	test("regeneration is deterministic, byte for byte", () => {
		const a = renderGuideNpc(palette);
		const b = renderGuideNpc(palette);
		expect(a.softStrip.data.equals(b.softStrip.data)).toBe(true);
		expect(a.bubbleSoft.data.equals(b.bubbleSoft.data)).toBe(true);
		expect(a.portraitSoft.data.equals(b.portraitSoft.data)).toBe(true);
		expect(a.softStrip.width).toBe(
			(a.softFrames[0]?.width ?? 0) * GUIDE_NPC_FRAME_COUNT,
		);
	});
});
