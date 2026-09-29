#!/usr/bin/env node
// Runs at dev/build time (see package.json predev/prebuild), not committed —
// public/worlds and public/assets are gitignored and regenerated from
// {sample-project,notes-vault}/ and assets/generated/ on demand.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild, runShelf } from "@cabn/cli";
import { createSampleHistory, demoGithubFetch } from "./gen-git-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, "..");
const worldsOutDir = join(demoRoot, "public", "worlds");
const assetsSourceDir = join(demoRoot, "..", "..", "assets", "generated");
const assetsOutDir = join(demoRoot, "public", "assets");

// Two contrasting worlds, not one: a TS/Python "codebase" and a markdown-only
// notes vault, so the shelf visibly shows worlds with different biomes/file
// kinds under the same wizard-tower hub, not two copies of the same shape.
// The sample world also ingests an ESLint-format results file, so the demo
// shows external findings (shades, for rules with no built-in class) next to
// the built-in annotators' monsters. It lives outside sample-project
// so it isn't itself a portal.
//
// The sample world also carries git history (branches as on-demand universes, tags,
// releases, file history) from a generated fixture repository — see
// gen-git-fixture.mjs — with canned GitHub releases instead of a network
// request. The notes vault has none: without `history: false` it would
// otherwise stay history-less anyway (it isn't a repository root), but
// saying so keeps the build from ever looking.
const WORLDS = [
	{
		sourceDir: join(demoRoot, "sample-project"),
		name: "sample",
		findingsPaths: [join(demoRoot, "sample-findings.eslint.json")],
		gitFixture: true,
	},
	{ sourceDir: join(demoRoot, "notes-vault"), name: "notes" },
];

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

	const bundleDirs = [];
	for (const world of WORLDS) {
		const outDir = join(worldsOutDir, world.name);
		const manifestPath = join(outDir, "world.json");
		bundleDirs.push(outDir);

		if (shouldBuild(await pathExists(manifestPath), force)) {
			if (force) await rm(outDir, { recursive: true, force: true });
			const fixture = world.gitFixture
				? await createSampleHistory(world.sourceDir)
				: undefined;
			let summary;
			try {
				summary = await runBuild(world.sourceDir, {
					outDir,
					findingsPaths: world.findingsPaths,
					...(fixture
						? { gitDir: fixture.gitdir, githubFetch: demoGithubFetch }
						: { history: false }),
				});
			} finally {
				await fixture?.cleanup();
			}
			const history = summary.history
				? `, git: ${summary.history.branches} branches, ${Math.round(summary.history.packBytes / 1024)} KB pack`
				: "";
			console.log(
				`cabn demo: built "${world.name}" world -> ${summary.clusters} clusters, ${summary.portals} portals, ${summary.monsters} monsters${history} (${summary.elapsedMs}ms)`,
			);
			for (const warning of summary.warnings)
				console.warn(`cabn demo: ${warning}`);
		} else {
			console.log(
				`cabn demo: "${world.name}" world already built, skipping (pass --force to rebuild)`,
			);
		}
	}

	// Rebuilt every run (cheap, deterministic) — a shelf listing has to stay in
	// sync with whichever worlds actually exist, not just whichever were
	// rebuilt this time.
	const shelfSummary = await runShelf(bundleDirs, {
		outDir: worldsOutDir,
		name: "cabn demo shelf",
	});
	console.log(
		`cabn demo: wrote shelf -> ${shelfSummary.outDir} (${shelfSummary.worlds} worlds)`,
	);

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
