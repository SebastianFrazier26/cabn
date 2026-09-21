import type { RGB } from "./color.js";
import type { RawImage } from "./image-io.js";

export interface PixelMap {
	name: string;
	width: number;
	height: number;
	/** Maps a row character to an index into the shared palette. '.' is reserved for transparent. */
	legend: Record<string, number>;
	rows: string[];
}

export function renderPixelMap(
	map: PixelMap,
	palette: readonly RGB[],
): RawImage {
	if (map.rows.length !== map.height) {
		throw new Error(
			`${map.name}: expected ${map.height} rows, got ${map.rows.length}`,
		);
	}

	const data = Buffer.alloc(map.width * map.height * 4);
	map.rows.forEach((row, y) => {
		if (row.length !== map.width) {
			throw new Error(
				`${map.name}: row ${y} has length ${row.length}, expected ${map.width}`,
			);
		}
		for (let x = 0; x < map.width; x++) {
			const char = row[x];
			const px = (y * map.width + x) * 4;
			if (char === ".") continue; // buffer already zeroed = transparent black

			const paletteIndex = map.legend[char ?? ""];
			if (paletteIndex === undefined) {
				throw new Error(
					`${map.name}: char '${char}' at row ${y} col ${x} not in legend`,
				);
			}
			const color = palette[paletteIndex];
			if (!color) {
				throw new Error(
					`${map.name}: legend index ${paletteIndex} out of palette range`,
				);
			}
			data[px] = color.r;
			data[px + 1] = color.g;
			data[px + 2] = color.b;
			data[px + 3] = 255;
		}
	});

	return { data, width: map.width, height: map.height };
}
