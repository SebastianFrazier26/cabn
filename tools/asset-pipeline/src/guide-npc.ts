import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import {
	concatHorizontal,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { paletteJsonPath, placeholdersDir } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import {
	GUIDE_NPC_FRAME_COUNT,
	GUIDE_NPC_PORTRAIT_CROP,
	guideNpcBubble,
	guideNpcFrame,
} from "./pixelmaps/guide-npc.js";
import {
	DEFAULT_SOFTEN_OPTIONS,
	type SoftenOptions,
	soften,
} from "./soften.js";

// One seed for every frame, so soften()'s per-cell jitter is identical frame
// to frame and only the flame and eye cells change — a per-frame seed would
// make her whole body shimmer. The raised bloom threshold keeps the cream
// apron/pages flat and lets only the lantern glass glow.
const GUIDE_SOFTEN: SoftenOptions = {
	...DEFAULT_SOFTEN_OPTIONS,
	seed: 20260928,
	bloomThreshold: 230,
};
// The bubble is mostly near-white; the default bloom threshold (180) washes
// it into a glowing blob, so bloom is effectively off for it.
const BUBBLE_SOFTEN: SoftenOptions = {
	...DEFAULT_SOFTEN_OPTIONS,
	seed: 20260929,
	bloomThreshold: 250,
	bloomStrength: 0.1,
};
const UPSCALE_FACTOR = 8;

export function cropRaw(
	image: RawImage,
	x: number,
	y: number,
	w: number,
	h: number,
): RawImage {
	const data = Buffer.alloc(w * h * 4);
	for (let row = 0; row < h; row++) {
		const from = ((y + row) * image.width + x) * 4;
		image.data.copy(data, row * w * 4, from, from + w * 4);
	}
	return { data, width: w, height: h };
}

export interface GuideNpcImages {
	crispFrames: RawImage[];
	softFrames: RawImage[];
	softStrip: RawImage;
	bubbleCrisp: RawImage;
	bubbleSoft: RawImage;
	portraitSoft: RawImage;
}

/** Pure (no file IO) so the test can assert determinism on the exact bytes the script writes. */
export function renderGuideNpc(palette: readonly RGB[]): GuideNpcImages {
	const crispFrames: RawImage[] = [];
	const softFrames: RawImage[] = [];
	for (let i = 0; i < GUIDE_NPC_FRAME_COUNT; i++) {
		const crisp = renderPixelMap(guideNpcFrame(i), palette);
		crispFrames.push(crisp);
		softFrames.push(soften(crisp, GUIDE_SOFTEN));
	}
	const bubbleCrisp = renderPixelMap(guideNpcBubble, palette);
	const cell = GUIDE_SOFTEN.cellSize;
	const crop = GUIDE_NPC_PORTRAIT_CROP;
	const frame0 = softFrames[0];
	if (!frame0) throw new Error("guide npc: no frames rendered");
	return {
		crispFrames,
		softFrames,
		softStrip: concatHorizontal(softFrames),
		bubbleCrisp,
		bubbleSoft: soften(bubbleCrisp, BUBBLE_SOFTEN),
		portraitSoft: cropRaw(
			frame0,
			crop.x * cell,
			crop.y * cell,
			crop.w * cell,
			crop.h * cell,
		),
	};
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const images = renderGuideNpc(palette);
	const out = (name: string) => path.join(placeholdersDir, name);

	for (const [i, crisp] of images.crispFrames.entries()) {
		await writeRawRgbaPng(crisp, out(`npc_guide_f${i}.png`));
		await writeRawRgbaPng(
			await upscaleNearest(crisp, UPSCALE_FACTOR),
			out(`npc_guide_f${i}@8x.png`),
		);
	}
	await writeRawRgbaPng(images.softStrip, out("npc_guide_strip_soft.png"));
	await writeRawRgbaPng(images.bubbleCrisp, out("npc_guide_bubble.png"));
	await writeRawRgbaPng(images.bubbleSoft, out("npc_guide_bubble_soft.png"));
	await writeRawRgbaPng(
		images.portraitSoft,
		out("npc_guide_portrait_soft.png"),
	);
	console.log(
		`guide npc: ${images.softFrames.length} frames (${images.softStrip.width}x${images.softStrip.height} strip), bubble, portrait -> ${placeholdersDir}`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
