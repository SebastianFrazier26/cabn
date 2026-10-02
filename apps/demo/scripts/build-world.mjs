#!/usr/bin/env node
// Runs at dev/build time (see package.json predev/prebuild), not committed —
// public/worlds and public/assets are gitignored and regenerated from
// {sample-project,notes-vault}/ and assets/generated/ on demand.
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBuild, runShelf } from "@cabn/cli";
import { createSampleHistory, demoGithubFetch } from "./gen-git-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, "..");
const repoRoot = join(demoRoot, "..", "..");
const worldsOutDir = join(demoRoot, "public", "worlds");
const assetsSourceDir = join(repoRoot, "assets", "generated");
const assetsOutDir = join(demoRoot, "public", "assets");
// Outside public/ so it never ships in the bundle (or trips the postbuild
// scans); losing it (a fresh node_modules) only costs one rebuild.
const fingerprintDir = join(demoRoot, "node_modules", ".cache", "cabn-worlds");

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

// Everything a built world is a function of besides its own inputs: the
// packages that convert it (runBuild lives in the cli) and the git fixture
// generator. dist/assets is the cli's copy of the sprites for `cabn serve`,
// never read by a build. importerPath is the package's key in the lockfile's
// `importers:` block (see lockfileDependencyVersions) — spelled out here
// rather than derived from dir, matching how dir itself is spelled out.
const TOOLCHAIN = [
	{
		name: "@cabn/world-schema",
		dir: join(repoRoot, "packages", "world-schema"),
		importerPath: "packages/world-schema",
	},
	{
		name: "@cabn/converter",
		dir: join(repoRoot, "packages", "converter"),
		importerPath: "packages/converter",
	},
	{
		name: "@cabn/cli",
		dir: join(repoRoot, "packages", "cli"),
		importerPath: "packages/cli",
	},
];
const TOOLCHAIN_SKIP = new Set(["assets"]);
const lockfilePath = join(repoRoot, "pnpm-lock.yaml");

export async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Pure decision, exported for testing: skip the (slow-ish) convert() pass
 * only when the world is built and was built from exactly the current inputs.
 * A world with no stored fingerprint (built before this check, or by hand)
 * counts as stale.
 */
export function shouldBuild(
	outputExists,
	force,
	storedFingerprint,
	fingerprint,
) {
	return force || !outputExists || storedFingerprint !== fingerprint;
}

/**
 * sha256 over every file under `dir` (relative path + bytes, in sorted
 * order so it's the same on every machine), skipping top-level entries named
 * in `skip`. Content rather than mtimes: a `pnpm -r build` rewrites every
 * dist file, and that alone must not force a world rebuild.
 */
export async function hashTree(dir, skip = new Set()) {
	const files = [];
	async function walk(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (current === dir && skip.has(entry.name)) continue;
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile()) files.push(full);
		}
	}
	await walk(dir);
	files.sort();
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(relative(dir, file).split(sep).join("/"));
		hash.update("\0");
		hash.update(await readFile(file));
		hash.update("\0");
	}
	return hash.digest("hex");
}

/**
 * A package's runtime dependency versions as pnpm actually resolved them,
 * read straight out of the lockfile's `importers:` entry for `importerPath`
 * (e.g. "packages/converter") rather than from node_modules — because a
 * package's own dist/ never embeds a node_modules dependency's code, a
 * lockfile-only bump (isomorphic-git, fflate, a transitive security patch)
 * changes a toolchain package's behavior without changing a single byte the
 * dist hash or the package.json version would see. Workspace links
 * (`version: link:../x`) are excluded: those packages are already covered by
 * their own dist hash. No YAML parser: pnpm-lock.yaml's importers block has
 * fixed two-space indentation steps, so a line-oriented scan is simpler than
 * pulling in a dependency to parse the whole document.
 */
export function lockfileDependencyVersions(lockfileText, importerPath) {
	const lines = lockfileText.split("\n");
	const headerIndex = lines.indexOf(`  ${importerPath}:`);
	if (headerIndex === -1) return {};

	const versions = {};
	let inDependencies = false;
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^ {0,2}\S/.test(line)) break; // next importer, or end of the block
		if (/^ {4}\S/.test(line)) {
			inDependencies = line === "    dependencies:";
			continue;
		}
		if (!inDependencies) continue;
		const nameMatch = line.match(/^ {6}'?([^':]+)'?:$/);
		if (!nameMatch) continue;
		const versionMatch = lines[i + 2]?.match(/^ {8}version: (.+)$/);
		if (!versionMatch || versionMatch[1].startsWith("link:")) continue;
		versions[nameMatch[1]] = versionMatch[1];
	}
	return versions;
}

/**
 * Walks `dir` recursively and returns the newest file mtime in it, or
 * undefined if `dir` doesn't exist or has no files. Used only for the
 * build-freshness check below — content hashing already does the real
 * fingerprint work and must stay mtime-independent.
 */
async function latestMtimeMs(dir) {
	let latest;
	async function walk(current) {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile()) {
				const { mtimeMs } = await stat(full);
				if (latest === undefined || mtimeMs > latest) latest = mtimeMs;
			}
		}
	}
	await walk(dir);
	return latest;
}

/**
 * `pnpm -r build` rebuilds every workspace package in topological order, but
 * a filtered `pnpm -F @cabn/demo build` never rebuilds its deps — it just
 * assumes their dist/ is current. On a merge that changes converter/
 * world-schema/cli src without a matching rebuild, that assumption breaks
 * silently: dist/ stays byte-identical to before, so the content hash below
 * can't tell "unchanged" from "never rebuilt" apart. Mtime is the right
 * signal for that question specifically (dist hashing stays mtime-blind on
 * purpose, see hashTree) — fail fast here rather than let a stale dist pass
 * as up to date.
 */
export async function assertToolchainBuilt(toolchain = TOOLCHAIN) {
	for (const pkg of toolchain) {
		const srcLatest = await latestMtimeMs(join(pkg.dir, "src"));
		if (srcLatest === undefined) continue;
		const distLatest = await latestMtimeMs(join(pkg.dir, "dist"));
		if (distLatest === undefined || distLatest < srcLatest) {
			throw new Error(
				`cabn demo: ${pkg.name}'s dist/ is missing or older than its src/. ` +
					`Run "pnpm -r build" (or "pnpm --filter ${pkg.name} build") before building the demo.`,
			);
		}
	}
}

/** Hashes that don't depend on which world is being built — computed once per run. */
export async function toolchainFingerprint(
	toolchain = TOOLCHAIN,
	lockfileText,
) {
	lockfileText ??= await readFile(lockfilePath, "utf8");
	const parts = {};
	for (const pkg of toolchain) {
		const manifest = JSON.parse(
			await readFile(join(pkg.dir, "package.json"), "utf8"),
		);
		parts[pkg.name] = {
			version: manifest.version,
			dist: await hashTree(join(pkg.dir, "dist"), TOOLCHAIN_SKIP),
			runtimeDeps: pkg.importerPath
				? lockfileDependencyVersions(lockfileText, pkg.importerPath)
				: {},
		};
	}
	const schema = await import(
		pathToFileURL(
			join(repoRoot, "packages", "world-schema", "dist", "index.js"),
		).href
	);
	parts.schemaVersion = schema.CABN_VERSION;
	parts.gitFixture = createHash("sha256")
		.update(await readFile(join(here, "gen-git-fixture.mjs")))
		.digest("hex");
	return parts;
}

/**
 * One world's fingerprint: its source tree (cabn.json included — it's a file
 * in the tree), any findings files, the build options, and the toolchain.
 * The git fixture is generated from the source tree plus gen-git-fixture.mjs,
 * so both already cover it.
 */
export async function worldFingerprint(world, toolchain) {
	const findings = [];
	for (const path of world.findingsPaths ?? []) {
		findings.push({
			path: relative(demoRoot, path).split(sep).join("/"),
			hash: createHash("sha256")
				.update(await readFile(path))
				.digest("hex"),
		});
	}
	const inputs = {
		name: world.name,
		source: await hashTree(world.sourceDir),
		findings,
		gitFixture: world.gitFixture === true,
		toolchain,
	};
	return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

async function readStoredFingerprint(name) {
	try {
		return (await readFile(join(fingerprintDir, `${name}.txt`), "utf8")).trim();
	} catch {
		return undefined;
	}
}

async function main() {
	const force = process.argv.includes("--force");
	await assertToolchainBuilt();
	const toolchain = await toolchainFingerprint();

	const bundleDirs = [];
	for (const world of WORLDS) {
		const outDir = join(worldsOutDir, world.name);
		const manifestPath = join(outDir, "world.json");
		bundleDirs.push(outDir);
		const fingerprint = await worldFingerprint(world, toolchain);
		const stored = await readStoredFingerprint(world.name);
		const outputExists = await pathExists(manifestPath);

		if (shouldBuild(outputExists, force, stored, fingerprint)) {
			if (outputExists && !force)
				console.log(
					`cabn demo: "${world.name}" world is stale (inputs or converter changed), rebuilding`,
				);
			// A stale world's leftover chunk files must not outlive the rebuild.
			await rm(outDir, { recursive: true, force: true });
			await rm(join(fingerprintDir, `${world.name}.txt`), { force: true });
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
			await mkdir(fingerprintDir, { recursive: true });
			await writeFile(join(fingerprintDir, `${world.name}.txt`), fingerprint);
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
				`cabn demo: "${world.name}" world up to date, skipping (pass --force to rebuild)`,
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

// Guarded so vitest can import the fingerprint helpers for testing without
// triggering the actual filesystem build as a side effect of the import.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
