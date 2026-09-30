import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	hashTree,
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
});
