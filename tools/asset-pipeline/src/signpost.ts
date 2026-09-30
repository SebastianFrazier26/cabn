import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import { type RawImage, upscaleNearest, writeRawRgbaPng } from "./image-io.js";
import { paletteJsonPath, placeholdersDir } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import { signIconMap, signpostMap } from "./pixelmaps/signpost.js";
import { ownerIconMap } from "./pixelmaps/ui-item-owner.js";
import {
	DEFAULT_SOFTEN_OPTIONS,
	type SoftenOptions,
	soften,
} from "./soften.js";

// Fixed seed so regenerating gives byte-identical files; the raised bloom
// threshold keeps the light wood flat instead of glowing.
const SIGNPOST_SOFTEN: SoftenOptions = {
	...DEFAULT_SOFTEN_OPTIONS,
	seed: 20260928,
	bloomThreshold: 240,
	bloomStrength: 0.1,
};
const UPSCALE_FACTOR = 8;

export interface SignpostImages {
	crisp: RawImage;
	soft: RawImage;
	iconCrisp: RawImage;
	iconSoft: RawImage;
	/** The owner's toolkit item (ui-item-owner.ts), the sign item's sibling. */
	ownerCrisp: RawImage;
	ownerSoft: RawImage;
}

/** Pure (no file IO) so the test can assert determinism on the exact bytes the script writes. */
export function renderSignpost(palette: readonly RGB[]): SignpostImages {
	const crisp = renderPixelMap(signpostMap(), palette);
	const iconCrisp = renderPixelMap(signIconMap(), palette);
	const ownerCrisp = renderPixelMap(ownerIconMap(), palette);
	return {
		crisp,
		soft: soften(crisp, SIGNPOST_SOFTEN),
		iconCrisp,
		iconSoft: soften(iconCrisp, SIGNPOST_SOFTEN),
		ownerCrisp,
		ownerSoft: soften(ownerCrisp, SIGNPOST_SOFTEN),
	};
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const images = renderSignpost(palette);
	const out = (name: string) => path.join(placeholdersDir, name);
	await writeRawRgbaPng(images.crisp, out("prop_seyn_sign.png"));
	await writeRawRgbaPng(
		await upscaleNearest(images.crisp, UPSCALE_FACTOR),
		out("prop_seyn_sign@8x.png"),
	);
	await writeRawRgbaPng(images.soft, out("prop_seyn_sign_soft.png"));
	await writeRawRgbaPng(images.iconCrisp, out("ui_icon_sign.png"));
	await writeRawRgbaPng(
		await upscaleNearest(images.iconCrisp, UPSCALE_FACTOR),
		out("ui_icon_sign@8x.png"),
	);
	await writeRawRgbaPng(images.iconSoft, out("ui_icon_sign_soft.png"));
	await writeRawRgbaPng(images.ownerCrisp, out("ui_icon_owner.png"));
	await writeRawRgbaPng(
		await upscaleNearest(images.ownerCrisp, UPSCALE_FACTOR),
		out("ui_icon_owner@8x.png"),
	);
	await writeRawRgbaPng(images.ownerSoft, out("ui_icon_owner_soft.png"));
	console.log(
		`signpost: ${images.soft.width}x${images.soft.height} sprite + sign and owner item icons -> ${placeholdersDir}`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
