import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertToolchainBuilt,
	hashTree,
	lockfileDependencyVersions,
	shouldBuild,
	toolchainFingerprint,
	worldFingerprint,
} from "../scripts/build-world.mjs";

describe("shouldBuild", () => {
	it("builds when the output doesn't exist yet", () => {
		expect(shouldBuild(false, false, "a", "a")).toBe(true);
	});

	it("skips when the output exists and was built from the same inputs", () => {
		expect(shouldBuild(true, false, "a", "a")).toBe(false);
	});

	it("rebuilds when the fingerprint changed", () => {
		expect(shouldBuild(true, false, "a", "b")).toBe(true);
	});

	it("rebuilds a world with no stored fingerprint", () => {
		expect(shouldBuild(true, false, undefined, "a")).toBe(true);
	});

	it("rebuilds when forced even if everything matches", () => {
		expect(shouldBuild(true, true, "a", "a")).toBe(true);
	});
});

describe("world fingerprint", () => {
	let root;
	let source;
	let findings;
	let pkg;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cabn-fingerprint-"));
		source = join(root, "project");
		pkg = join(root, "converter");
		await mkdir(join(source, "src"), { recursive: true });
		await writeFile(join(source, "cabn.json"), '{"cabnConfigVersion":1}');
		await writeFile(join(source, "src", "a.ts"), "export const a = 1;\n");
		findings = join(root, "findings.json");
		await writeFile(findings, "[]");
		await mkdir(join(pkg, "dist", "assets"), { recursive: true });
		await writeFile(
			join(pkg, "package.json"),
			'{"name":"@cabn/converter","version":"0.1.0"}',
		);
		await writeFile(join(pkg, "dist", "index.js"), "export {};\n");
		await writeFile(join(pkg, "dist", "assets", "sprite.png"), "png");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const world = () => ({
		name: "sample",
		sourceDir: source,
		findingsPaths: [findings],
		gitFixture: true,
	});
	const toolchain = () =>
		toolchainFingerprint([{ name: "@cabn/converter", dir: pkg }]);

	it("is stable when nothing changed, even if files were only touched", async () => {
		const before = await worldFingerprint(world(), await toolchain());
		const later = new Date(Date.now() + 60_000);
		await utimes(join(source, "src", "a.ts"), later, later);
		await utimes(join(pkg, "dist", "index.js"), later, later);
		expect(await worldFingerprint(world(), await toolchain())).toBe(before);
	});

	it("changes with a source file, cabn.json, a new file, or a findings file", async () => {
		const base = await worldFingerprint(world(), await toolchain());
		const seen = new Set([base]);
		const edits = [
			() => writeFile(join(source, "src", "a.ts"), "export const a = 2;\n"),
			() =>
				writeFile(join(source, "cabn.json"), '{"cabnConfigVersion":1,"x":1}'),
			() => writeFile(join(source, "src", "b.ts"), "export {};\n"),
			() => writeFile(findings, '[{"filePath":"x","messages":[]}]'),
		];
		for (const edit of edits) {
			await edit();
			const next = await worldFingerprint(world(), await toolchain());
			expect(seen.has(next)).toBe(false);
			seen.add(next);
		}
	});

	it("changes with the converter's version or built output, not its bundled sprites", async () => {
		const base = await worldFingerprint(world(), await toolchain());
		await writeFile(join(pkg, "dist", "assets", "sprite.png"), "png2");
		expect(await worldFingerprint(world(), await toolchain())).toBe(base);

		await writeFile(join(pkg, "dist", "index.js"), "export const v = 2;\n");
		const rebuilt = await worldFingerprint(world(), await toolchain());
		expect(rebuilt).not.toBe(base);

		await writeFile(
			join(pkg, "package.json"),
			'{"name":"@cabn/converter","version":"0.2.0"}',
		);
		expect(await worldFingerprint(world(), await toolchain())).not.toBe(
			rebuilt,
		);
	});

	it("covers the world-schema version and the git fixture generator", async () => {
		const parts = await toolchain();
		expect(parts.schemaVersion).toBeTypeOf("number");
		expect(parts.gitFixture).toMatch(/^[0-9a-f]{64}$/);
		const base = await worldFingerprint(world(), parts);
		expect(
			await worldFingerprint(world(), { ...parts, schemaVersion: 99 }),
		).not.toBe(base);
		expect(
			await worldFingerprint(world(), { ...parts, gitFixture: "other" }),
		).not.toBe(base);
	});

	it("differs between worlds with the same files", async () => {
		const parts = await toolchain();
		expect(await worldFingerprint(world(), parts)).not.toBe(
			await worldFingerprint({ ...world(), name: "notes" }, parts),
		);
	});

	it("hashTree notices a file moving even with identical bytes", async () => {
		const a = await hashTree(source);
		await rm(join(source, "src", "a.ts"));
		await writeFile(join(source, "a.ts"), "export const a = 1;\n");
		expect(await hashTree(source)).not.toBe(a);
	});

	// Regression coverage for the fingerprint missing a converter change on two
	// real merges (gitPack.ts, then the annotate/zip code): a dist/ change
	// nested below the package root, and a lockfile-only dependency bump
	// (neither touches dist bytes nor the package's own version field).
	describe("inputs that previously slipped past the fingerprint", () => {
		it("changes when a nested dist file changes, not just top-level ones", async () => {
			await mkdir(join(pkg, "dist", "history"), { recursive: true });
			await writeFile(
				join(pkg, "dist", "history", "gitPack.js"),
				"export const v = 1;\n",
			);
			const base = await worldFingerprint(world(), await toolchain());

			await writeFile(
				join(pkg, "dist", "history", "gitPack.js"),
				"export const v = 2;\n",
			);
			expect(await worldFingerprint(world(), await toolchain())).not.toBe(base);
		});

		it("changes when a lockfile-pinned runtime dependency (isomorphic-git, fflate) bumps, with no src/dist change at all", async () => {
			const toolchainPkgs = [
				{
					name: "@cabn/converter",
					dir: pkg,
					importerPath: "packages/converter",
				},
			];
			const lockfile = (version) =>
				"importers:\n\n" +
				"  packages/converter:\n" +
				"    dependencies:\n" +
				"      isomorphic-git:\n" +
				`        specifier: ${version}\n` +
				`        version: ${version}\n`;

			const base = await worldFingerprint(
				world(),
				await toolchainFingerprint(toolchainPkgs, lockfile("1.42.2")),
			);
			const bumped = await worldFingerprint(
				world(),
				await toolchainFingerprint(toolchainPkgs, lockfile("1.43.0")),
			);
			expect(bumped).not.toBe(base);
		});

		it("stays the same when nothing — including the lockfile — changed", async () => {
			const toolchainPkgs = [
				{
					name: "@cabn/converter",
					dir: pkg,
					importerPath: "packages/converter",
				},
			];
			const lockfile =
				"importers:\n\n" +
				"  packages/converter:\n" +
				"    dependencies:\n" +
				"      isomorphic-git:\n" +
				"        specifier: 1.42.2\n" +
				"        version: 1.42.2\n";

			const a = await worldFingerprint(
				world(),
				await toolchainFingerprint(toolchainPkgs, lockfile),
			);
			const b = await worldFingerprint(
				world(),
				await toolchainFingerprint(toolchainPkgs, lockfile),
			);
			expect(b).toBe(a);
		});
	});
});

describe("lockfileDependencyVersions", () => {
	const lockfile = [
		"importers:",
		"",
		"  .:",
		"    devDependencies:",
		"      vitest:",
		"        specifier: ^5.0.1",
		"        version: 5.0.1",
		"",
		"  packages/converter:",
		"    dependencies:",
		"      '@cabn/world-schema':",
		"        specifier: workspace:*",
		"        version: link:../world-schema",
		"      fflate:",
		"        specifier: ^0.8.3",
		"        version: 0.8.3",
		"      isomorphic-git:",
		"        specifier: 1.42.2",
		"        version: 1.42.2",
		"    devDependencies:",
		"      '@types/node':",
		"        specifier: ^22.20.4",
		"        version: 22.20.4",
		"",
		"  packages/engine:",
		"    dependencies:",
		"      '@cabn/converter':",
		"        specifier: workspace:*",
		"        version: link:../converter",
		"",
	].join("\n");

	it("reads an importer's resolved dependency versions", () => {
		expect(lockfileDependencyVersions(lockfile, "packages/converter")).toEqual({
			fflate: "0.8.3",
			"isomorphic-git": "1.42.2",
		});
	});

	it("excludes workspace links and devDependencies", () => {
		const versions = lockfileDependencyVersions(lockfile, "packages/converter");
		expect(versions).not.toHaveProperty("@cabn/world-schema");
		expect(versions).not.toHaveProperty("@types/node");
	});

	it("doesn't bleed into the next importer's entries", () => {
		expect(
			lockfileDependencyVersions(lockfile, "packages/engine"),
		).not.toHaveProperty("fflate");
	});

	it("returns an empty object for an importer not in the lockfile", () => {
		expect(lockfileDependencyVersions(lockfile, "packages/nope")).toEqual({});
	});
});

// `pnpm -F @cabn/demo build` never rebuilds its workspace deps (unlike
// `pnpm -r build`'s topological order), so a merge that touches converter/
// world-schema/cli src without a matching dist rebuild must fail loudly here
// rather than let build-world.mjs hash a stale-but-unchanged dist.
describe("assertToolchainBuilt", () => {
	let root;
	let pkg;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cabn-toolchain-fresh-"));
		pkg = join(root, "converter");
		await mkdir(join(pkg, "src"), { recursive: true });
		await writeFile(join(pkg, "src", "index.ts"), "export {};\n");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const toolchainPkgs = () => [{ name: "@cabn/converter", dir: pkg }];

	it("throws when dist/ doesn't exist yet", async () => {
		await expect(assertToolchainBuilt(toolchainPkgs())).rejects.toThrow(
			/@cabn\/converter.*dist/,
		);
	});

	it("throws when src/ was edited after the last dist build", async () => {
		await mkdir(join(pkg, "dist"), { recursive: true });
		await writeFile(join(pkg, "dist", "index.js"), "export {};\n");
		const later = new Date(Date.now() + 60_000);
		await utimes(join(pkg, "src", "index.ts"), later, later);

		await expect(assertToolchainBuilt(toolchainPkgs())).rejects.toThrow(
			/@cabn\/converter/,
		);
	});

	it("passes once dist/ was rebuilt after the src edit", async () => {
		await mkdir(join(pkg, "dist"), { recursive: true });
		const later = new Date(Date.now() + 60_000);
		await utimes(join(pkg, "src", "index.ts"), later, later);
		await writeFile(join(pkg, "dist", "index.js"), "export {};\n");
		const evenLater = new Date(Date.now() + 120_000);
		await utimes(join(pkg, "dist", "index.js"), evenLater, evenLater);

		await expect(assertToolchainBuilt(toolchainPkgs())).resolves.not.toThrow();
	});

	it("ignores a package with no src/ directory", async () => {
		await rm(join(pkg, "src"), { recursive: true, force: true });
		await expect(assertToolchainBuilt(toolchainPkgs())).resolves.not.toThrow();
	});
});
