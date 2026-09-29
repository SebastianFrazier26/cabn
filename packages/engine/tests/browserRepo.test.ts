import * as fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { convert, DirSource } from "@cabn/converter";
import { parseGitMeta, type WorldManifest } from "@cabn/world-schema";
import * as git from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { openBrowserRepo } from "../src/systems/git/browserRepo.js";
import { createReadonlyGitFs } from "../src/systems/git/readonlyFs.js";
import type { BrowserRepo } from "../src/systems/git/types.js";

const BASE = "http://world.test/w/";
const author = (day: number) => ({
	name: "Wren Hollow",
	email: "wren@hollow.example",
	timestamp: 1780000000 + day * 86400,
	timezoneOffset: 0,
});

let dir: string;
let bundle: Map<string, Uint8Array | string>;
let repo: BrowserRepo;
const fetched: string[] = [];

async function commit(
	files: Record<string, string>,
	message: string,
	day: number,
) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
		await git.add({ fs, dir, filepath: path });
	}
	return git.commit({
		fs,
		dir,
		message,
		author: author(day),
		committer: author(day),
	});
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-browser-repo-"));
	await git.init({ fs, dir, defaultBranch: "main" });
	await commit(
		{ "README.md": "# One\n", ".env": "TOKEN=nope-not-shipped\n" },
		"First",
		0,
	);
	await commit(
		{ "README.md": "# One\n\nTwo.\n", "src/a.js": "export const a = 1;\n" },
		"Second",
		1,
	);
	await git.branch({ fs, dir, ref: "side", checkout: true });
	// A branch's own cabn.json has to ship: converting the branch reads it.
	await commit(
		{
			"side.md": "# Side quest\n",
			"cabn.json": JSON.stringify({ cabnConfigVersion: 1, guide: false }),
		},
		"Side",
		2,
	);
	await git.checkout({ fs, dir, ref: "main" });
	bundle = await convert(new DirSource(dir), {
		name: "garden",
		source: dir,
		now: () => new Date("2026-09-28T00:00:00.000Z"),
		git: { fs, dir },
	});
	vi.stubGlobal("fetch", async (url: string) => {
		fetched.push(url);
		const value = url.startsWith(BASE)
			? bundle.get(url.slice(BASE.length))
			: undefined;
		if (value === undefined) return new Response("not found", { status: 404 });
		return new Response(value as BodyInit, { status: 200 });
	});
	const meta = parseGitMeta(JSON.parse(bundle.get("git/meta.json") as string));
	if (!meta) throw new Error("no meta");
	repo = await openBrowserRepo(BASE, meta);
});

afterAll(async () => {
	vi.unstubAllGlobals();
	await rm(dir, { recursive: true, force: true });
});

describe("the browser git reader over the shipped pack", () => {
	test("logs are the real commits, emails included", async () => {
		const log = await repo.log("main");
		expect(log.map((c) => c.message.trim())).toEqual(["Second", "First"]);
		expect(log[0]?.author.email).toBe("wren@hollow.example");
		expect(log[0]?.oid).toBe(await git.resolveRef({ fs, dir, ref: "main" }));
	});

	test("changes and a file's history come from real tree diffs", async () => {
		const [second] = await repo.log("main");
		const changes = await repo.changes(second as NonNullable<typeof second>);
		expect(changes.changes).toEqual([
			{ path: "README.md", status: "modified" },
			{ path: "src/a.js", status: "added" },
		]);
		const history = await repo.fileHistory("main", "README.md");
		expect(history.map((h) => [h.commit.message.trim(), h.status])).toEqual([
			["Second", "modified"],
			["First", "added"],
		]);
		const past = await repo.readBlob(history[1]?.blob as string);
		expect(past).toEqual({ kind: "text", text: "# One\n" });
	});

	test("a secret-named file reads as not shipped", async () => {
		const [env] = await repo.fileHistory("main", ".env");
		expect(await repo.readBlob(env?.blob as string)).toMatchObject({
			kind: "not-shipped",
			reason: "secret-name",
		});
	});

	test("a branch converts on demand into a world, cached per branch", async () => {
		const opts = {
			name: "garden",
			source: `${dir}#side`,
			generatedAt: "2026-09-28T00:00:00.000Z",
		};
		const world = await repo.convertUniverse("side", opts);
		expect(await repo.convertUniverse("side", opts)).toBe(world);
		const manifest = JSON.parse(
			world.get("world.json") as string,
		) as WorldManifest;
		expect(manifest.portals.map((p) => p.id)).toContain("side.md");
		expect(manifest.meta.source).toBe(`${dir}#side`);
		expect(manifest.meta.generatedAt).toBe("2026-09-28T00:00:00.000Z");
		expect(manifest.guide).toBe(false);
	});

	test("every fetch stayed inside the world's git/ directory and files.json", () => {
		const files = JSON.parse(bundle.get("git/files.json") as string)
			.files as string[];
		for (const url of fetched) {
			const rel = url.slice(BASE.length);
			expect(
				rel === "git/files.json" || files.includes(rel.slice("git/".length)),
				url,
			).toBe(true);
		}
	});
});

describe("the read-only git fs", () => {
	const files = [
		"HEAD",
		"packed-refs",
		`objects/pack/pack-${"a".repeat(40)}.pack`,
	];
	const make = () => {
		const urls: string[] = [];
		const shim = createReadonlyGitFs({
			baseUrl: "https://host/w/git/",
			files,
			fetch: async (u) => {
				urls.push(u);
				return {
					ok: true,
					arrayBuffer: async () =>
						new TextEncoder().encode("ref: refs/heads/main\n").buffer,
				};
			},
		});
		return { shim, urls };
	};

	test("reads listed files once, over fetch, under the world's git/ only", async () => {
		const { shim, urls } = make();
		expect(await shim.promises.readFile("/git/HEAD", "utf8")).toBe(
			"ref: refs/heads/main\n",
		);
		await shim.promises.readFile("/git/HEAD", { encoding: "utf8" });
		expect(urls).toEqual(["https://host/w/git/HEAD"]);
	});

	test.each([
		"/git/config",
		"/git/../world.json",
		"/etc/passwd",
		"/git/objects/ab/cdef",
		"/gitx/HEAD",
	])("never fetches an unlisted path (%s)", async (path) => {
		const { shim, urls } = make();
		await expect(shim.promises.readFile(path)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(urls).toEqual([]);
	});

	test("lists directories from files.json and refuses every write", async () => {
		const { shim } = make();
		expect(await shim.promises.readdir("/git")).toEqual([
			"HEAD",
			"objects",
			"packed-refs",
		]);
		expect(await shim.promises.readdir("/git/objects/pack")).toHaveLength(1);
		expect((await shim.promises.stat("/git/objects")).isDirectory()).toBe(true);
		for (const write of [
			() => shim.promises.writeFile("/git/HEAD", "x"),
			() => shim.promises.mkdir("/git/refs"),
			() => shim.promises.unlink("/git/HEAD"),
		])
			await expect(write()).rejects.toMatchObject({ code: "EROFS" });
	});
});
