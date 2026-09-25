// Hardcoded from assets/generated/palette.json (generated 2026-09-21). The engine
// package must not read repo-relative asset files at build/run time — copy this
// file by hand if the source palette is regenerated with a materially different look.
export const PALETTE = {
	/** Ink — dark brown, used for text on light/parchment backgrounds. */
	ink: 0x322214,
	/** Cream — near-white warm tone, used for labels over dark ground. */
	cream: 0xedeee4,
	/** Parchment — warm tan panel fill for the portal preview. */
	parchment: 0xefe0b3,
	/** Trail/path brown, matches the dirt tones in the sourced icons. */
	trail: 0x8c461f,
	/** Gold accent, used for portal arch glow and highlights. */
	gold: 0xe99b33,
	/** Pale ghost blue, used for enchanted-markdown links. */
	paleGhostBlue: 0xbfd6e0,
	/**
	 * ~18% darker than `parchment`, hand-computed (not a palette.json swatch —
	 * there's no darker parchment tone in the extracted/curated set) for
	 * enchanted-markdown code-span boxes.
	 */
	parchmentDark: 0xc4b793,
	biome: {
		meadow: 0x6f863a,
		grove: 0x45592d,
		glade: 0x5d6947,
	},
} as const;

export type BiomeTint = keyof typeof PALETTE.biome;

export function toCssColor(hex: number): string {
	return `#${hex.toString(16).padStart(6, "0")}`;
}
