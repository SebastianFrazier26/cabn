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
	/** Gold accent, used for portal arch glow and highlights. At 1.74:1 on `parchment` it's nowhere near WCAG AA for text; the quill editor's keyword syntax color is `goldDark` instead. */
	gold: 0xe99b33,
	/** Pale ghost blue, used for enchanted-markdown links. */
	paleGhostBlue: 0xbfd6e0,
	/**
	 * ~18% darker than `parchment`, hand-computed (not a palette.json swatch —
	 * there's no darker parchment tone in the extracted/curated set) for
	 * enchanted-markdown code-span boxes.
	 */
	parchmentDark: 0xc4b793,
	/** Darker warm rust, extracted swatch distinct from `trail` — quill editor's function/property-name syntax color, and (2026-09-28) its gutter/line-number color: `trail` on `parchmentDark` only hit 3.5:1. */
	rust: 0x622b17,
	/** Steel gray, extracted swatch, used for the wizard tower's masonry. No longer used by the quill editor theme (2026-09-28): at 2.43:1 on `parchment` it failed WCAG AA for text; punctuation/brackets use `ink` instead. */
	steelGray: 0x8a9198,
	/** Deep plum, curated in M2 for the character's staff gem — quill editor's type-name syntax color. */
	plum: 0x58336b,
	/** Bright amethyst, curated alongside `plum` — decorative use only. At 2.37:1 on `parchment` it fails WCAG AA for text; the quill editor's number/atom syntax color is `amethystDark` instead. */
	amethyst: 0xb27cd6,
	/**
	 * `amethyst` darkened to the same hue/saturation, ~26% lower lightness (hand-computed,
	 * not a palette.json swatch — see `parchmentDark` above for the same situation) so the
	 * quill editor's number/atom syntax color clears 4.5:1 on `parchment` (4.61:1).
	 */
	amethystDark: 0x8a3cbe,
	/**
	 * `gold` darkened and nudged a few degrees toward yellow (hand-computed), so the quill
	 * editor's keyword syntax color clears 4.5:1 on `parchment` (4.61:1) — plain darkening
	 * along `gold`'s original hue lands within 23 RGB units of `trail`'s comment color,
	 * too close to read as a different role next to it.
	 */
	goldDark: 0x6c640b,
	biome: {
		meadow: 0x6f863a,
		/**
		 * `meadow` darkened to the same hue/saturation, ~21% lower lightness (hand-computed),
		 * so the quill editor's string syntax color clears 4.5:1 on `parchment` (4.61:1).
		 */
		meadowDark: 0x57692e,
		grove: 0x45592d,
		glade: 0x5d6947,
		/**
		 * `glade` darkened to the same hue/saturation, ~2% lower lightness (hand-computed) —
		 * it was already close, at 4.47:1 on `parchment` — so the quill editor's
		 * attribute-name syntax color clears 4.5:1 (4.60:1).
		 */
		gladeDark: 0x5b6746,
	},
} as const;

export type BiomeTint = keyof typeof PALETTE.biome;

export function toCssColor(hex: number): string {
	return `#${hex.toString(16).padStart(6, "0")}`;
}
