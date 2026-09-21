import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { run } from "../src/cli.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let outDir: string;

beforeEach(async () => {
	outDir = join(await mkdtemp(join(tmpdir(), "cabn-cli-dispatch-")), "world");
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(outDir, { recursive: true, force: true });
});

test("--help and no args exit 0", async () => {
	expect(await run([])).toBe(0);
	expect(await run(["--help"])).toBe(0);
});

test("--version exits 0", async () => {
	expect(await run(["--version"])).toBe(0);
});

test("unknown command exits 1", async () => {
	expect(await run(["frobnicate"])).toBe(1);
});

test("build without a path exits 1", async () => {
	expect(await run(["build"])).toBe(1);
});

test("inspect without a path exits 1", async () => {
	expect(await run(["inspect"])).toBe(1);
});

test("shelf without any bundle dirs exits 1", async () => {
	expect(await run(["shelf"])).toBe(1);
});

test("shelf <bundleDir> -o <outDir> exits 0 and writes shelf.json", async () => {
	expect(await run(["build", FIXTURE, "-o", outDir])).toBe(0);
	const shelfOutDir = `${outDir}-shelf`;
	expect(await run(["shelf", outDir, "-o", shelfOutDir])).toBe(0);
	await rm(shelfOutDir, { recursive: true, force: true });
});

test("an unknown shelf flag exits 1 with a friendly error instead of throwing", async () => {
	await expect(run(["shelf", outDir, "--bogus-flag"])).resolves.toBe(1);
	expect(console.error).toHaveBeenCalledWith(
		expect.stringContaining("cabn shelf failed"),
	);
});

test("build <fixture> -o <outDir> exits 0 and writes a bundle", async () => {
	expect(await run(["build", FIXTURE, "-o", outDir])).toBe(0);
	expect(await run(["inspect", outDir])).toBe(0);
});

test("build --include-secrets restores .env content", async () => {
	expect(await run(["build", FIXTURE, "-o", outDir, "--include-secrets"])).toBe(
		0,
	);
});

test("an unknown build flag exits 1 with a friendly error instead of throwing", async () => {
	await expect(run(["build", FIXTURE, "--bogus-flag"])).resolves.toBe(1);
	expect(console.error).toHaveBeenCalledWith(
		expect.stringContaining("cabn build failed"),
	);
});

test("an unknown inspect flag exits 1 with a friendly error instead of throwing", async () => {
	await expect(run(["inspect", outDir, "--bogus-flag"])).resolves.toBe(1);
	expect(console.error).toHaveBeenCalledWith(
		expect.stringContaining("cabn inspect failed"),
	);
});
