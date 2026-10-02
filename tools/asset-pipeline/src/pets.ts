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
	PET_FRAME_COUNT,
	PET_SPECIES,
	type PetSpecies,
	petFrame,
} from "./pixelmaps/pets.js";
import {
	DEFAULT_SOFTEN_OPTIONS,
	type SoftenOptions,
	soften,
} from "./soften.js";

// One seed per pet for every frame (see guide-npc.ts: a per-frame seed makes
// the whole body shimmer between frames). Bloom stays off the pale bellies.
function petSoften(index: number): SoftenOptions {
	return {
		...DEFAULT_SOFTEN_OPTIONS,
		seed: 20261001 + index,
		bloomThreshold: 235,
	};
}
const UPSCALE_FACTOR = 8;

export interface PetImages {
	species: PetSpecies;
	crispFrames: RawImage[];
	softStrip: RawImage;
	portraitSoft: RawImage;
}

/** Pure (no file IO) so the test can assert determinism on the exact bytes the script writes. */
export function renderPets(palette: readonly RGB[]): PetImages[] {
	return PET_SPECIES.map((species, index) => {
		const crispFrames: RawImage[] = [];
		const softFrames: RawImage[] = [];
		for (let i = 0; i < PET_FRAME_COUNT; i++) {
			const crisp = renderPixelMap(petFrame(species, i), palette);
			crispFrames.push(crisp);
			softFrames.push(soften(crisp, petSoften(index)));
		}
		const portrait = softFrames[0];
		if (!portrait) throw new Error(`pet ${species}: no frames rendered`);
		return {
			species,
			crispFrames,
			softStrip: concatHorizontal(softFrames),
			portraitSoft: portrait,
		};
	});
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const out = (name: string) => path.join(placeholdersDir, name);
	for (const pet of renderPets(palette)) {
		for (const [i, crisp] of pet.crispFrames.entries()) {
			await writeRawRgbaPng(
				await upscaleNearest(crisp, UPSCALE_FACTOR),
				out(`pet_${pet.species}_f${i}@8x.png`),
			);
		}
		await writeRawRgbaPng(
			pet.softStrip,
			out(`pet_${pet.species}_strip_soft.png`),
		);
		await writeRawRgbaPng(
			pet.portraitSoft,
			out(`pet_${pet.species}_portrait_soft.png`),
		);
		console.log(
			`pet ${pet.species}: ${pet.crispFrames.length} frames (${pet.softStrip.width}x${pet.softStrip.height} strip) -> ${placeholdersDir}`,
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
