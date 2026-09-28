import type { PixelMap } from "../pixelmap.js";

export type SparkleColor = "violet" | "cyan" | "gold";

const SPARKLE_PALETTE_INDEX: Record<SparkleColor, number> = {
	violet: 33, // amethyst
	cyan: 30, // pale ghost blue
	gold: 21,
};

/**
 * A tiny 4-point sparkle, reused many times at different positions/opacities
 * as the per-tool particle effect (see mockup.html's `.sparkle` instances) —
 * one small sprite standing in for a particle system rather than dozens of
 * bespoke frames. No outline: at 9x9 a dark rim would swallow the shape, and
 * these are meant to glow against a colored backdrop, not read as objects.
 */
export function buildSparkle(color: SparkleColor): PixelMap {
	const legend: Record<string, number> = {
		C: 29,
		A: SPARKLE_PALETTE_INDEX[color],
	};
	const cx = 4;
	const cy = 4;
	const rows: string[] = [];
	for (let y = 0; y < 9; y++) {
		let row = "";
		for (let x = 0; x < 9; x++) {
			const armLen = Math.abs(x - cx) + Math.abs(y - cy);
			if (armLen === 0) row += "C";
			else if (armLen <= 2) row += "A";
			else row += ".";
		}
		rows.push(row);
	}
	return { name: `ui_sparkle_${color}`, width: 9, height: 9, legend, rows };
}
