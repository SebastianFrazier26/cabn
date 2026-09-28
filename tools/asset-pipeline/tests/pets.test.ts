import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { paletteJsonPath } from "../src/paths.js";
import { renderPets } from "../src/pets.js";
import { renderPixelMap } from "../src/pixelmap.js";
import {
	PET_FRAME_COUNT,
	PET_GRID,
	PET_SPECIES,
	petFrame,
	petTemplateRows,
} from "../src/pixelmaps/pets.js";

const palette: RGB[] = JSON.parse(
	readFileSync(paletteJsonPath, "utf8"),
).colors.map((c: { rgb: RGB }) => c.rgb);

const NEIGHBOURS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
] as const;

describe("pet pixelmaps", () => {
	test.each(PET_SPECIES)(
		"%s: 16x16 template keeps the outline margin empty",
		(species) => {
			const rows = petTemplateRows(species);
			expect(rows).toHaveLength(PET_GRID);
			for (const [y, row] of rows.entries()) {
				expect(row, `row ${y}`).toHaveLength(PET_GRID);
				expect(row[0], `row ${y} col 0`).toBe(".");
				expect(row[PET_GRID - 1], `row ${y} col 15`).toBe(".");
			}
			expect(rows[0]).toBe(".".repeat(PET_GRID));
			expect(rows[PET_GRID - 1]).toBe(".".repeat(PET_GRID));
		},
	);

	test.each(PET_SPECIES)(
		"%s: frames render, are ringed in ink, and walk frames differ",
		(species) => {
			const frames = Array.from({ length: PET_FRAME_COUNT }, (_, i) =>
				petFrame(species, i),
			);
			for (const map of frames) {
				expect(() => renderPixelMap(map, palette)).not.toThrow();
				for (const row of map.rows) expect(row).not.toMatch(/[0-9]/);
				const at = (x: number, y: number) => map.rows[y]?.[x] ?? ".";
				for (let y = 0; y < PET_GRID; y++) {
					for (let x = 0; x < PET_GRID; x++) {
						const c = at(x, y);
						if (c === "." || c === "O") continue;
						for (const [dx, dy] of NEIGHBOURS) {
							expect(at(x + dx, y + dy), `${map.name} (${x},${y})`).not.toBe(
								".",
							);
						}
					}
				}
			}
			const [idle, , walkA, walkB] = frames;
			expect(walkA?.rows).not.toEqual(idle?.rows);
			expect(walkB?.rows).not.toEqual(walkA?.rows);
		},
	);

	test("regeneration is byte-for-byte deterministic", () => {
		const a = renderPets(palette);
		const b = renderPets(palette);
		expect(a.map((p) => p.species)).toEqual([...PET_SPECIES]);
		for (const [i, pet] of a.entries()) {
			expect(pet.softStrip.width).toBe(PET_GRID * 16 * PET_FRAME_COUNT);
			expect(pet.softStrip.height).toBe(PET_GRID * 16);
			const other = b[i]?.softStrip.data ?? Buffer.alloc(0);
			expect(Buffer.compare(pet.softStrip.data, other)).toBe(0);
		}
	});
});
