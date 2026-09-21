import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

const CLI_ENTRY = join(import.meta.dirname, "..", "dist", "main.js");
const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let outDir: string;

beforeEach(async () => {
	outDir = join(
		await mkdtemp(join(tmpdir(), "cabn-cli-integration-")),
		"world",
	);
});

afterEach(async () => {
	await rm(outDir, { recursive: true, force: true });
});

// Runs the actual built binary (requires `pnpm build` first, per repo
// convention: `pnpm -r build && pnpm -r test`), not just the in-process run().
test("cabn build <fixture> -o <outDir> via the built binary", async () => {
	await access(CLI_ENTRY); // fails loudly if this ran before a build

	const { stdout } = await execFileAsync(process.execPath, [
		CLI_ENTRY,
		"build",
		FIXTURE,
		"-o",
		outDir,
	]);
	expect(stdout).toContain("Built world at");

	const entries = await readdir(outDir);
	expect(entries.sort()).toEqual([
		"assets.json",
		"chunks",
		"search-index.json",
		"world.json",
	]);
});

test("cabn inspect <bundleDir> via the built binary", async () => {
	await execFileAsync(process.execPath, [
		CLI_ENTRY,
		"build",
		FIXTURE,
		"-o",
		outDir,
	]);
	const { stdout } = await execFileAsync(process.execPath, [
		CLI_ENTRY,
		"inspect",
		outDir,
	]);
	expect(stdout).toContain("tiny-project");
});

test("cabn --version via the built binary", async () => {
	const { stdout } = await execFileAsync(process.execPath, [
		CLI_ENTRY,
		"--version",
	]);
	expect(stdout.trim()).toBe("0.0.0");
});
