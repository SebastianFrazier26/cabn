import type { RGB } from "../color.js";

/**
 * The nether ramps, appended after palette.json's own colours in memory only:
 * palette.json's indices are hardcoded across every other generator (and the
 * engine's palette.ts), so extending the file itself would be a ripple for
 * art only the owner-mode shadow realm ever loads. Ink stays palette.json's
 * index 0, so outlines match the rest of the world.
 */
const NETHER_COLORS = {
	netherDeep: { r: 58, g: 15, b: 18 },
	netherBase: { r: 112, g: 30, b: 30 },
	netherLight: { r: 150, g: 52, b: 42 },
	netherCrack: { r: 36, g: 8, b: 11 },
	emberRed: { r: 224, g: 56, b: 28 },
	emberOrange: { r: 255, g: 122, b: 28 },
	emberYellow: { r: 255, g: 210, b: 74 },
	lavaHot: { r: 255, g: 242, b: 168 },
	obsidianDeep: { r: 20, g: 12, b: 30 },
	obsidianBase: { r: 36, g: 23, b: 54 },
	obsidianLight: { r: 62, g: 42, b: 92 },
	obsidianGlint: { r: 142, g: 110, b: 206 },
	blackstoneDark: { r: 28, g: 26, b: 34 },
	blackstone: { r: 54, g: 49, b: 62 },
	blackstoneLight: { r: 92, g: 85, b: 100 },
	bone: { r: 234, g: 222, b: 198 },
	boneShadow: { r: 170, g: 154, b: 134 },
	ashLight: { r: 222, g: 214, b: 210 },
	ashMid: { r: 150, g: 140, b: 136 },
	iron: { r: 64, g: 60, b: 72 },
	ironLight: { r: 116, g: 108, b: 124 },
	soulCyan: { r: 104, g: 226, b: 232 },
	soulDeep: { r: 34, g: 120, b: 138 },
	char: { r: 38, g: 26, b: 24 },
	charLight: { r: 78, g: 54, b: 46 },
	white: { r: 255, g: 255, b: 255 },
} as const satisfies Record<string, RGB>;

export type NetherColor = keyof typeof NETHER_COLORS;

export interface NetherPalette {
	colors: RGB[];
	/** Index into `colors` for each nether tone (after palette.json's own). */
	n: Record<NetherColor, number>;
	ink: number;
}

export function buildNetherPalette(base: readonly RGB[]): NetherPalette {
	const colors = [...base];
	const n = {} as Record<NetherColor, number>;
	for (const [name, rgb] of Object.entries(NETHER_COLORS)) {
		n[name as NetherColor] = colors.length;
		colors.push(rgb);
	}
	return { colors, n, ink: 0 };
}

export const NETHER_COLOR_LIST = NETHER_COLORS;
