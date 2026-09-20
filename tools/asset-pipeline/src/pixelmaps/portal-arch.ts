import type { PixelMap } from "../pixelmap.js";

// Legend indices reference assets/generated/palette.json's sorted-by-luminance
// colors — reusing the icon-derived palette keeps placeholders visually
// consistent with recovered sprites even before hand-drawn art replaces them.
export const portalArch: PixelMap = {
	name: "portal_arch",
	width: 32,
	height: 32,
	legend: {
		O: 0, // darkest brown — stone shadow / outline
		S: 23, // warm gray — stone body
		s: 22, // khaki — stone highlight
		v: 1, // dark green — ivy shadow
		V: 9, // mid green — ivy highlight
		g: 19, // gold orange — glow, outer ring
		G: 21, // bright gold — glow, mid ring
		w: 27, // palest cream — glow, white-hot center
	},
	rows: [
		"................................",
		"................................",
		".............OSSSSO.............",
		".........v..OSSSSSSO..v.........",
		"........Vv.OSSSssSSSOvV.........",
		"........v.OSSSsSSsSSSO.v........",
		"......V..OSSSsSSSSsSSSO..v......",
		".....v.OSSSsSSSssSSSsSSSO.V.....",
		".....OSSSsSSSsSSSSsSSSsSSSO.....",
		"....OSSSsSSSsSSSSSSsSSSsSSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSggGggGggggggGggGggSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgGGGGGGGGGGGGGGGGgSSO....",
		"....OSSgwwwwwwwwwwwwwwwwgSSO....",
		"....OSSgwwwwwwwwwwwwwwwwgSSO....",
		"....OSSgwwwwwwwwwwwwwwwwgSSO....",
		"....OSSgwwwwwwwwwwwwwwwwgSSO....",
		"....OSSgwwwwwwwwwwwwwwwwgSSO....",
	],
};
