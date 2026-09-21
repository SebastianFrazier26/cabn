import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import { upscaleNearest, writeRawRgbaPng } from "./image-io.js";
import { manifestJsonPath, paletteJsonPath, placeholdersDir } from "./paths.js";
import { type PixelMap, renderPixelMap } from "./pixelmap.js";
import { characterIdle } from "./pixelmaps/character-idle.js";
import { characterIdleBack } from "./pixelmaps/character-idle-back.js";
import { ghost } from "./pixelmaps/ghost.js";
import { portalArch } from "./pixelmaps/portal-arch.js";
import { wizardTower } from "./pixelmaps/wizard-tower.js";

const ALL_PIXEL_MAPS: PixelMap[] = [
	portalArch,
	ghost,
	characterIdle,
	characterIdleBack,
	wizardTower,
];
const UPSCALE_FACTOR = 8;

interface ManifestEntry {
	locked: boolean;
}
type Manifest = Record<string, ManifestEntry>;

async function loadManifest(): Promise<Manifest> {
	try {
		return JSON.parse(await readFile(manifestJsonPath, "utf8"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const manifest = await loadManifest();
	await mkdir(placeholdersDir, { recursive: true });

	for (const map of ALL_PIXEL_MAPS) {
		const entry = manifest[map.name];
		if (entry?.locked) {
			console.log(`${map.name}: skipped (locked)`);
			continue;
		}
		manifest[map.name] = { locked: entry?.locked ?? false };

		const image = renderPixelMap(map, palette);
		await writeRawRgbaPng(image, path.join(placeholdersDir, `${map.name}.png`));
		await writeRawRgbaPng(
			await upscaleNearest(image, UPSCALE_FACTOR),
			path.join(placeholdersDir, `${map.name}@8x.png`),
		);
		console.log(`${map.name}: rendered ${map.width}x${map.height}`);
	}

	await writeFile(
		manifestJsonPath,
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
