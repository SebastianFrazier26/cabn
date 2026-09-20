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

test("build <fixture> -o <outDir> exits 0 and writes a bundle", async () => {
	expect(await run(["build", FIXTURE, "-o", outDir])).toBe(0);
	expect(await run(["inspect", outDir])).toBe(0);
});
