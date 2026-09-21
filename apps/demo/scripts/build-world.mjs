#!/usr/bin/env node
// Runs at dev/build time (see package.json predev/prebuild), not committed —
// public/worlds and public/assets are gitignored and regenerated from
// sample-project/ and assets/generated/ on demand.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "@cabn/cli";

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, "..");
const sampleProjectDir = join(demoRoot, "sample-project");
const worldOutDir = join(demoRoot, "public", "worlds", "sample");
const assetsSourceDir = join(demoRoot, "..", "..", "assets", "generated");
const assetsOutDir = join(demoRoot, "public", "assets");

export async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Pure decision, exported for testing: skip the (slow-ish) convert() pass when the world is already built, unless forced. */
export function shouldBuild(outputExists, force) {
	return force || !outputExists;
}

async function main() {
	const force = process.argv.includes("--force");
	const worldManifestPath = join(worldOutDir, "world.json");

	if (shouldBuild(await pathExists(worldManifestPath), force)) {
		if (force) await rm(worldOutDir, { recursive: true, force: true });
		const summary = await runBuild(sampleProjectDir, { outDir: worldOutDir });
		console.log(
			`cabn demo: built sample world -> ${summary.clusters} clusters, ${summary.portals} portals (${summary.elapsedMs}ms)`,
		);
	} else {
		console.log(
			"cabn demo: sample world already built, skipping (pass --force to rebuild)",
		);
	}

	// Always re-synced (cheap, idempotent) so a regenerated sprite always
	// reaches the demo without needing --force on the world build too.
	await mkdir(assetsOutDir, { recursive: true });
	for (const dir of ["originals", "placeholders"]) {
		await cp(join(assetsSourceDir, dir), join(assetsOutDir, dir), {
			recursive: true,
			force: true,
		});
	}
	console.log(`cabn demo: synced sprites -> ${assetsOutDir}`);
}

// Guarded so vitest can import shouldBuild/pathExists for testing without
// triggering the actual filesystem build as a side effect of the import.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
