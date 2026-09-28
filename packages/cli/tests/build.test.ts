import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runBuild } from "../src/build.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let outDir: string;

beforeEach(async () => {
	outDir = join(await mkdtemp(join(tmpdir(), "cabn-cli-build-")), "world");
});

afterEach(async () => {
	await rm(outDir, { recursive: true, force: true });
});

test("writes a bundle with the expected files and a matching summary", async () => {
	const summary = await runBuild(FIXTURE, { outDir });

	expect(summary.outDir).toBe(outDir);
	expect(summary.portals).toBe(2); // README.md + main.py
	expect(summary.clusters).toBe(1); // both files are at the root
	expect(summary.bytes).toBeGreaterThan(0);

	const manifest = JSON.parse(
		await readFile(join(outDir, "world.json"), "utf8"),
	);
	expect(manifest.cabnVersion).toBe(1);
	expect(await readFile(join(outDir, "assets.json"), "utf8")).toContain(
		"atlases",
	);
	expect(await readFile(join(outDir, "search-index.json"), "utf8")).toContain(
		"minisearch",
	);
});

test("defaults outDir to ./<name>-world when not given", async () => {
	const summary = await runBuild(FIXTURE);
	try {
		expect(summary.outDir.endsWith("tiny-project-world")).toBe(true);
	} finally {
		await rm(summary.outDir, { recursive: true, force: true });
	}
});

test("--offline makes no request and records every url preview as assumed framable", async () => {
	const src = await mkdtemp(join(tmpdir(), "cabn-cli-embed-"));
	const realFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new Error("no network in unit tests");
	}) as typeof fetch;
	try {
		await writeFile(join(src, "site.md"), "# site\n");
		await writeFile(
			join(src, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "site.md": { kind: "url", url: "https://x.example/" } },
				allowedEmbedOrigins: ["https://x.example"],
			}),
		);
		const offline = await runBuild(src, { outDir, offline: true });
		expect(calls).toBe(0);
		expect(offline.embedCheck).toBe("offline");
		const index = JSON.parse(
			await readFile(join(outDir, "embeds.json"), "utf8"),
		);
		expect(index.entries["site.md"]).toEqual({
			url: "https://x.example/",
			framable: true,
			basis: "offline",
		});

		// Without --offline the CLI goes through fetch (stubbed here to fail),
		// which degrades to "unreachable", never to a failed build.
		const online = await runBuild(src, { outDir });
		expect(calls).toBeGreaterThan(0);
		expect(online.embedCheck).toBe("network");
		expect(online.embedBlocked).toEqual([]);
	} finally {
		globalThis.fetch = realFetch;
		await rm(src, { recursive: true, force: true });
	}
});
