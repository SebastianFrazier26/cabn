/**
 * Indices into assets/generated/palette.json's `colors` array, named for the
 * storybook-UI frame art (ui-frame.ts, ui-button.ts, etc). Centralized so
 * every UI pixel map agrees on which brown is "wood mid" rather than each
 * file re-picking a close-enough index.
 */
export const UI_COLOR = {
	ink: 0, // #322214 — outlines, deepest shadow
	darkWood: 2, // #622b17
	midWood: 5, // #8c461f
	lightWood: 8, // #a35424
	woodHighlight: 13, // #c66e29
	gold: 21, // #e99b33 — leaf/trim accents, gold seal wax
	parchmentShade: 26, // #eacc90 — parchment shadow/fleck
	parchment: 27, // #efe0b3 — parchment fill
	steel: 28, // #8a9198 — hardware (hinges, nails)
	cream: 29, // #edeee4 — paper highlight, wax gloss speck
	sealRed: 34, // #c8281e
	sealPlum: 32, // #58336b
	sealPlumHighlight: 33, // #b27cd6
	victoryGreen: 11, // #6f863a — meadow tone, alt ribbon color
} as const;
