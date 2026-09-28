#!/usr/bin/env node
// Runs after `tsc` as part of `pnpm -F @cabn/cli build` (see package.json).
// A published `@cabn/cli` has no monorepo `assets/generated/` beside it
// (see src/serve/server.ts's REPO_ASSETS_DIR doc) — this bundles the exact,
// fixed set of sprites `cabn serve` actually references into dist/assets so
// `npx @cabn/cli serve` renders real art instead of PreloadScene's tinted
// fallbacks outside this checkout. Listed explicitly, not the whole 20MB
// assets/generated/ tree, since most of it (recovered/, soften-calibration/,
// the crisp non-"_soft" and "@8x" originals) is never fetched at runtime —
// see packages/engine/src/assetPaths.ts and systems/tools.ts for the
// definitive list of paths a running game ever requests.
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoAssetsDir = join(here, "..", "..", "..", "assets", "generated");
const outDir = join(here, "..", "dist", "assets");

export const ORIGINALS = [
	"cabin_256.webp",
	"cabinet_256.webp",
	"key_256.webp",
	"letter_opener_256.webp",
	"file_256.webp",
];

export const PLACEHOLDERS = [
	"character_idle_soft.png",
	"character_idle_back_soft.png",
	"portal_arch_soft.png",
	"portal_arch_strip_soft.png",
	"ghost_soft.png",
	"wizard_tower_soft.png",
	"bonfire_frame0_soft.png",
	"bonfire_frame1_soft.png",
	"bonfire_frame2_soft.png",
	"bonfire_frame3_soft.png",
	"rot_sprite_idle0_soft.png",
	"rot_sprite_idle1_soft.png",
	"warded_mimic_idle0_soft.png",
	"warded_mimic_idle1_soft.png",
	"gremlin_idle0_soft.png",
	"gremlin_idle1_soft.png",
	"ouroboros_idle0_soft.png",
	"ouroboros_idle1_soft.png",
	"will_o_wisp_idle0_soft.png",
	"will_o_wisp_idle1_soft.png",
	"imp_idle0_soft.png",
	"imp_idle1_soft.png",
	"magpie_idle0_soft.png",
	"magpie_idle1_soft.png",
	"skeleton_idle0_soft.png",
	"skeleton_idle1_soft.png",
	"bramble_idle0_soft.png",
	"bramble_idle1_soft.png",
	"shade_idle0_soft.png",
	"shade_idle1_soft.png",
];

async function copyInto(subdir, files) {
	const srcDir = join(repoAssetsDir, subdir);
	const destDir = join(outDir, subdir);
	await mkdir(destDir, { recursive: true });
	for (const file of files) {
		try {
			await cp(join(srcDir, file), join(destDir, file));
		} catch (err) {
			// wizard_tower/bonfire/character_idle_back are on a parallel art
			// branch per assetPaths.ts's OPTIONAL_ASSET_KEYS doc — if this build
			// runs before that art has merged, skip rather than fail the build;
			// PreloadScene already has a tinted-fallback path for exactly this.
			console.warn(`cabn cli: skipping missing sprite ${file} (${err.code})`);
		}
	}
}

async function main() {
	await copyInto("originals", ORIGINALS);
	await copyInto("placeholders", PLACEHOLDERS);
	console.log(
		`cabn cli: bundled ${ORIGINALS.length + PLACEHOLDERS.length} sprites -> ${outDir}`,
	);
}

// Guarded so a test can import ORIGINALS/PLACEHOLDERS without copying files
// as a side effect (same pattern as apps/demo/scripts/build-world.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
