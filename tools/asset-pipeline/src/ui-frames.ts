import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import { upscaleNearest, writeRawRgbaPng } from "./image-io.js";
import { generatedDir, paletteJsonPath, placeholdersDir } from "./paths.js";
import type { PixelMap } from "./pixelmap.js";
import { renderPixelMap } from "./pixelmap.js";
import { buildBagIcon } from "./pixelmaps/ui-item-bag.js";
import { buildKeyIcon } from "./pixelmaps/ui-item-key.js";
import { buildCrystalOrbIcon } from "./pixelmaps/ui-item-orb.js";
import { buildQuillIcon } from "./pixelmaps/ui-item-quill.js";
import { buildSpyglassIcon } from "./pixelmaps/ui-item-spyglass.js";
import { buildWandIcon } from "./pixelmaps/ui-item-wand.js";
import { buildOrbScreen } from "./pixelmaps/ui-screen-orb.js";
import {
	buildSatchelFlap,
	buildSatchelScreen,
} from "./pixelmaps/ui-screen-satchel.js";
import { buildSpyglassScreen } from "./pixelmaps/ui-screen-spyglass.js";
import { buildSparkle } from "./pixelmaps/ui-sparkle.js";
import { soften } from "./soften.js";

// Separate output dir from placeholders/manifest.json — this M10a mockup
// round doesn't own that shared file (another agent's generate() pass does),
// so UI art gets its own directory and its own small manifest.
export const uiDir = path.join(generatedDir, "ui");
const uiManifestPath = path.join(uiDir, "manifest.json");

interface UiAsset {
	map: PixelMap;
	kind: "item-icon" | "particle" | "tool-screen";
	/** Upscale/soften only makes sense for the item icons — sparkles are used tiny and crisp. */
	soften: boolean;
}

function buildAssets(): UiAsset[] {
	return [
		{ map: buildCrystalOrbIcon(), kind: "item-icon", soften: true },
		{ map: buildSpyglassIcon(), kind: "item-icon", soften: true },
		{ map: buildBagIcon(), kind: "item-icon", soften: true },
		{ map: buildQuillIcon(), kind: "item-icon", soften: true },
		{ map: buildWandIcon(), kind: "item-icon", soften: true },
		{ map: buildKeyIcon(), kind: "item-icon", soften: true },
		{ map: buildSparkle("violet"), kind: "particle", soften: false },
		{ map: buildSparkle("cyan"), kind: "particle", soften: false },
		{ map: buildSparkle("gold"), kind: "particle", soften: false },
		{ map: buildOrbScreen(), kind: "tool-screen", soften: true },
		{ map: buildSpyglassScreen(), kind: "tool-screen", soften: true },
		{ map: buildSatchelScreen(), kind: "tool-screen", soften: true },
		{ map: buildSatchelFlap(), kind: "tool-screen", soften: true },
	];
}

interface ManifestEntry {
	kind: UiAsset["kind"];
	width: number;
	height: number;
	crispFile: string;
	crispUpscaledFile: string;
	softFile?: string;
}

const CRISP_UPSCALE = 8; // sparkles especially are tiny (9x9) — need a big multiple to read at all

// Same idea as soften.ts's per-name overrides for ghost/will-o-wisp: the
// spyglass's pale-ghost-blue lens sits just above the default bloom
// threshold (180) and blew out into a starburst indistinguishable from the
// wand's tip glow — raising the threshold above the lens's own luminance
// keeps it a flat, readable disc instead.
const SOFTEN_OVERRIDES: Record<string, Parameters<typeof soften>[1]> = {
	ui_icon_spyglass: { bloomThreshold: 235, bloomStrength: 0.15 },
};

// The tool-screen frames are drawn 100+ cells a side and shown 1:1 as the
// OrbSearch/SpyglassPanel/BagTray backgrounds (3 CSS px per cell), not
// shrunk to hotbar size like the icons — the icons' cellSize 16 and grain
// would make a 2000px-wide image whose speckle reads as noise at this size.
const TOOL_SCREEN_SOFTEN: Parameters<typeof soften>[1] = {
	cellSize: 3,
	jitterStrength: 2,
	grainStrength: 0,
	bloomThreshold: 235,
	bloomStrength: 0.15,
	bloomRadiusPx: 4,
	edgeFeatherPx: 1,
};

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	await mkdir(uiDir, { recursive: true });

	const manifest: Record<string, ManifestEntry> = {};

	for (const asset of buildAssets()) {
		const { map } = asset;
		const image = renderPixelMap(map, palette);
		const crispFile = `${map.name}.png`;
		const crispUpscaledFile = `${map.name}@${CRISP_UPSCALE}x.png`;

		await writeRawRgbaPng(image, path.join(uiDir, crispFile));
		await writeRawRgbaPng(
			await upscaleNearest(image, CRISP_UPSCALE),
			path.join(uiDir, crispUpscaledFile),
		);

		let softFile: string | undefined;
		if (asset.soften) {
			softFile = `${map.name}_soft.png`;
			// No option overrides — same DEFAULT_SOFTEN_OPTIONS pass as
			// wizard_tower/character_idle/ghost, so these icons land in the same
			// "soft-rendered cottagecore" family as the existing originals rather
			// than needing their own bespoke tuning.
			const softImage = soften(
				image,
				asset.kind === "tool-screen"
					? TOOL_SCREEN_SOFTEN
					: SOFTEN_OVERRIDES[map.name],
			);
			await writeRawRgbaPng(softImage, path.join(uiDir, softFile));
			// The engine loads icons from placeholders/ (see engine
			// assetPaths.ts's uiIconPath) — written here too so a regenerated
			// icon can't silently drift from the copy the game actually ships.
			await writeRawRgbaPng(softImage, path.join(placeholdersDir, softFile));
		}

		manifest[map.name] = {
			kind: asset.kind,
			width: map.width,
			height: map.height,
			crispFile,
			crispUpscaledFile,
			...(softFile ? { softFile } : {}),
		};
		console.log(
			`${map.name}: rendered ${map.width}x${map.height} (${asset.kind})`,
		);
	}

	await writeFile(uiManifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

const isMain =
	process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
