import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import { upscaleNearest, writeRawRgbaPng } from "./image-io.js";
import { generatedDir, paletteJsonPath } from "./paths.js";
import type { PixelMap } from "./pixelmap.js";
import { renderPixelMap } from "./pixelmap.js";
import { buildWaxSeal } from "./pixelmaps/ui-button.js";
import { buildDividerFlourish } from "./pixelmaps/ui-divider.js";
import {
	buildWoodFrameTile,
	WOOD_FRAME_OPTIONS,
} from "./pixelmaps/ui-frame.js";
import { buildHotbarSlot } from "./pixelmaps/ui-hotbar-slot.js";
import { buildParchmentTile } from "./pixelmaps/ui-parchment.js";
import { buildRibbonBanner } from "./pixelmaps/ui-ribbon.js";
import { buildScrollRoller } from "./pixelmaps/ui-scroll-roller.js";
import { buildTooltipBubble } from "./pixelmaps/ui-tooltip.js";
import { soften } from "./soften.js";

// Separate output dir from placeholders/manifest.json — this M10a mockup
// round doesn't own that shared file (another agent's generate() pass does),
// so UI frame art gets its own directory and its own small manifest.
export const uiDir = path.join(generatedDir, "ui");
const uiManifestPath = path.join(uiDir, "manifest.json");

// Raster multiplier for the "soft" variant — the same idea as
// gen-placeholders' UPSCALE_FACTOR, but smaller: these are UI chrome meant to
// sit at a few dozen CSS px, not full-screen sprites.
const SOFT_CELL_SIZE = 8;
const CRISP_UPSCALE = 4;

interface UiAsset {
	map: PixelMap;
	/** CSS border-image-slice / background-size metadata for the mockup + eventual real integration. */
	kind: "border-9slice" | "tile-repeat" | "sprite";
	slicePx?: number;
}

function buildAssets(): UiAsset[] {
	return [
		{
			map: buildWoodFrameTile(),
			kind: "border-9slice",
			slicePx: WOOD_FRAME_OPTIONS.border,
		},
		{ map: buildParchmentTile(), kind: "tile-repeat" },
		{ map: buildWaxSeal("red", false), kind: "sprite" },
		{ map: buildWaxSeal("red", true), kind: "sprite" },
		{ map: buildWaxSeal("plum", false), kind: "sprite" },
		{ map: buildWaxSeal("plum", true), kind: "sprite" },
		{ map: buildHotbarSlot(false), kind: "sprite" },
		{ map: buildHotbarSlot(true), kind: "sprite" },
		{ map: buildRibbonBanner("crimson"), kind: "sprite" },
		{ map: buildRibbonBanner("victory"), kind: "sprite" },
		{ map: buildTooltipBubble(), kind: "sprite" },
		{ map: buildDividerFlourish(), kind: "sprite" },
		{ map: buildScrollRoller("top"), kind: "sprite" },
		{ map: buildScrollRoller("bottom"), kind: "sprite" },
	];
}

interface ManifestEntry {
	kind: UiAsset["kind"];
	width: number;
	height: number;
	slicePx?: number;
	softCellSize: number;
	crispFile: string;
	crispUpscaledFile: string;
	softFile: string;
}

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
		const softFile = `${map.name}_soft.png`;

		await writeRawRgbaPng(image, path.join(uiDir, crispFile));
		await writeRawRgbaPng(
			await upscaleNearest(image, CRISP_UPSCALE),
			path.join(uiDir, crispUpscaledFile),
		);
		await writeRawRgbaPng(
			soften(image, { cellSize: SOFT_CELL_SIZE }),
			path.join(uiDir, softFile),
		);

		manifest[map.name] = {
			kind: asset.kind,
			width: map.width,
			height: map.height,
			...(asset.slicePx !== undefined ? { slicePx: asset.slicePx } : {}),
			softCellSize: SOFT_CELL_SIZE,
			crispFile,
			crispUpscaledFile,
			softFile,
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
