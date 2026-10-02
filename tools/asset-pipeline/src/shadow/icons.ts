import type { RGB } from "../color.js";
import type { PixelMap } from "../pixelmap.js";
import { signIconMap } from "../pixelmaps/signpost.js";
import { buildBagIcon } from "../pixelmaps/ui-item-bag.js";
import { buildKeyIcon } from "../pixelmaps/ui-item-key.js";
import { buildCrystalOrbIcon } from "../pixelmaps/ui-item-orb.js";
import { ownerIconMap } from "../pixelmaps/ui-item-owner.js";
import { buildQuillIcon } from "../pixelmaps/ui-item-quill.js";
import { buildSpyglassIcon } from "../pixelmaps/ui-item-spyglass.js";
import { buildWandIcon } from "../pixelmaps/ui-item-wand.js";
import { buildToolIcon, TOOL_ICON_NAMES } from "../pixelmaps/ui-tool-icons.js";
import { SIGNPOST_SOFTEN } from "../signpost.js";
import type { SoftenOptions } from "../soften.js";
import { SOFTEN_OVERRIDES } from "../ui-frames.js";
import type { NetherPalette } from "./palette.js";

/**
 * Crimson variants of the HUD icons that carry green (2026-09-29): the
 * spellbook's Replace arrow and Go-to grass, and the leaf sprig every item
 * icon wears. The realm's HUD keeps green out entirely (tokens.ts), so its
 * greens become embers by lightness — dark leaf to ember red, mid to orange,
 * light to yellow — and every other colour, and every cell, stays put.
 * Icons without green get no variant and show as they are.
 */
export interface NetherIcon {
	map: PixelMap;
	soften: Partial<SoftenOptions> | undefined;
}

export const isGreen = (c: RGB | undefined): boolean =>
	c !== undefined && c.g > c.r + 8 && c.g >= c.b;

/** Every HUD icon a crimson variant may be made from, with the soften settings its normal art uses. */
export function hudIconSources(): NetherIcon[] {
	return [
		...TOOL_ICON_NAMES.map((name) => buildToolIcon(name)),
		buildCrystalOrbIcon(),
		buildSpyglassIcon(),
		buildBagIcon(),
		buildQuillIcon(),
		buildWandIcon(),
		buildKeyIcon(),
	]
		.map((map) => ({ map, soften: SOFTEN_OVERRIDES[map.name] }))
		.concat(
			[signIconMap(), ownerIconMap()].map((map) => ({
				map,
				soften: SIGNPOST_SOFTEN,
			})),
		);
}

function emberFor(c: RGB, p: NetherPalette): number {
	const lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
	const { n } = p;
	if (lum < 100) return n.emberRed;
	if (lum < 150) return n.emberOrange;
	if (lum < 190) return n.emberYellow;
	return n.lavaHot;
}

export function netherIcons(p: NetherPalette): NetherIcon[] {
	return hudIconSources().flatMap(({ map, soften }) => {
		const used = new Set(map.rows.join(""));
		const green = Object.entries(map.legend).some(
			([ch, i]) => used.has(ch) && isGreen(p.colors[i]),
		);
		if (!green) return [];
		const legend: Record<string, number> = {};
		for (const [ch, i] of Object.entries(map.legend)) {
			const c = p.colors[i];
			legend[ch] = c && isGreen(c) ? emberFor(c, p) : i;
		}
		return [{ map: { ...map, name: `${map.name}_nether`, legend }, soften }];
	});
}
