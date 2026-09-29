import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedShadowSignPath } from "../../src/serve/ownerSigns.js";
import { type ServeHandle, startServe } from "../../src/serve/server.js";

interface RawResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
	json: Record<string, unknown>;
}

function raw(
	port: number,
	method: string,
	path: string,
	headers: Record<string, string>,
	body?: string,
): Promise<RawResponse> {
	return new Promise((resolveReq, rejectReq) => {
		const req = httpRequest(
			{
				host: "127.0.0.1",
				port,
				path,
				method,
				headers: {
					...headers,
					...(body !== undefined
						? { "content-length": Buffer.byteLength(body) }
						: {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					let json: Record<string, unknown> = {};
					try {
						json = JSON.parse(text);
					} catch {
						json = {};
					}
					resolveReq({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: text,
						json,
					});
				});
			},
		);
		req.on("error", rejectReq);
		req.end(body);
	});
}

const j = (...parts: string[]) => parts.join("");
// Assembled at runtime so the source never holds a scanner-matchable key.
const ANTHROPIC = j("sk-", "ant-", "demo-cabnFakeKeyForTheMagpie42");
const author = {
	name: "Wren Hollow",
	email: "wren@hollow.example",
	timestamp: 1780000000,
	timezoneOffset: 0,
};

const FILES: Record<string, string> = {
	"README.md": "# Garden\n",
	"src/app.js": "export const a = 1;\n",
	".github/ci.yml": "on: push # SHADOW_CANARY_CI\n",
	".vscode/settings.json": '{ "canary": "SHADOW_CANARY_VSCODE" }\n',
	"src/.eslintrc.json": '{ "canary": "SHADOW_CANARY_ESLINT" }\n',
	".env": `ANTHROPIC_API_KEY=${ANTHROPIC}\n`,
	".husky/pre-commit": "#!/bin/sh\necho hook\n",
	".cfg/a.txt": "real\n",
	".cfg2/a.txt": "twin\n",
};

let dir: string;
let outside: string;
let handle: ServeHandle | undefined;

async function writeAll(files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
}

async function initRepo(tracked: string[]) {
	await git.init({ fs, dir, defaultBranch: "main" });
	for (const path of tracked) await git.add({ fs, dir, filepath: path });
	await git.commit({ fs, dir, message: "Plant", author });
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-shadow-serve-"));
	outside = await mkdtemp(join(tmpdir(), "cabn-shadow-outside-"));
	await writeAll(FILES);
	await chmod(join(dir, ".husky/pre-commit"), 0o755);
});

afterEach(async () => {
	await handle?.close();
	handle = undefined;
	await rm(dir, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

async function serve(owner = true) {
	handle = await startServe(dir, { port: 0, offline: true, owner });
	return handle;
}

function getHeaders(h: ServeHandle, overrides: Record<string, string> = {}) {
	return {
		host: `127.0.0.1:${h.port}`,
		"sec-fetch-site": "same-origin",
		"x-cabn-owner-token": h.ownerToken ?? "",
		...overrides,
	};
}

function postHeaders(h: ServeHandle, overrides: Record<string, string> = {}) {
	return {
		host: `127.0.0.1:${h.port}`,
		origin: `http://127.0.0.1:${h.port}`,
		"x-cabn-owner-token": h.ownerToken ?? "",
		"content-type": "application/json",
		...overrides,
	};
}

const get = (h: ServeHandle, path: string, overrides = {}) =>
	raw(h.port, "GET", path, getHeaders(h, overrides));
const post = (h: ServeHandle, path: string, body: unknown, overrides = {}) =>
	raw(h.port, "POST", path, postHeaders(h, overrides), JSON.stringify(body));

interface LayerManifest {
	clusters: { id: string; portalIds: string[] }[];
	portals: { id: string }[];
	signs: { path: string }[];
	monsters: { species: string; portalId?: string }[];
	extendedMonsters: { species: string; portalId?: string }[];
	textSha256: Record<string, string>;
}
const manifestOf = async (h: ServeHandle) => {
	const res = await get(h, "/owner/shadow/manifest");
	expect(res.status).toBe(200);
	return res.json as unknown as LayerManifest;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HIDDEN_MARKERS = [
	"SHADOW_CANARY",
	".github",
	".vscode",
	".eslintrc",
	".env",
	".husky",
	".cfg",
];

/** Every file the page can load under /world/: world.json, each chunk, and the side files. */
async function worldFiles(h: ServeHandle): Promise<RawResponse[]> {
	const world = await raw(h.port, "GET", "/world/world.json", {
		host: `127.0.0.1:${h.port}`,
	});
	const clusters = (world.json.clusters ?? []) as { chunk: string }[];
	const out = [world];
	for (const key of [
		...clusters.map((c) => c.chunk),
		"search-index.json",
		"signs.json",
		"monsters.json",
		"media.json",
		"embeds.json",
	])
		out.push(
			await raw(h.port, "GET", `/world/${key}`, {
				host: `127.0.0.1:${h.port}`,
			}),
		);
	return out;
}

describe("shadow routes exist only with --owner", () => {
	it.each([
		["GET", "/owner/shadow/manifest"],
		["GET", "/owner/shadow/search-index"],
		["GET", "/owner/shadow/chunk/root%23shadow"],
		["POST", "/owner/shadow/save"],
	])("without --owner %s %s is a plain 404", async (method, path) => {
		const h = await serve(false);
		const res = await raw(h.port, method, path, {
			host: `127.0.0.1:${h.port}`,
			"sec-fetch-site": "same-origin",
			origin: `http://127.0.0.1:${h.port}`,
			"content-type": "application/json",
		});
		expect(res.status).toBe(404);
	});
});

describe("shadow request gate", () => {
	it.each([
		["no token", { "x-cabn-owner-token": "" }],
		["the page token", "page"],
		["a cross-site request", { "sec-fetch-site": "cross-site" }],
		["a bad Host", { host: "evil.example:80" }],
		["a foreign Origin", { origin: "http://evil.example" }],
	] as const)("refuses %s with 403", async (_label, override) => {
		const h = await serve();
		const extra =
			override === "page"
				? { "x-cabn-owner-token": h.token }
				: (override as Record<string, string>);
		for (const path of [
			"/owner/shadow/manifest",
			"/owner/shadow/search-index",
			"/owner/shadow/chunk/root%23shadow",
		]) {
			const res = await get(h, path, extra);
			expect(res.status, path).toBe(403);
		}
		const save = await post(
			h,
			"/owner/shadow/save",
			{ path: ".env", content: "x", baseSha256: "0".repeat(64) },
			extra,
		);
		expect(save.status).toBe(403);
	});

	it("a GET with neither Origin nor Sec-Fetch-Site is refused", async () => {
		const h = await serve();
		const res = await raw(h.port, "GET", "/owner/shadow/manifest", {
			host: `127.0.0.1:${h.port}`,
			"x-cabn-owner-token": h.ownerToken ?? "",
		});
		expect(res.status).toBe(403);
	});
});

describe("shadow reads", () => {
	it("serves the layer manifest without contents, chunks by cluster, and a search index — all no-store", async () => {
		const h = await serve();
		const res = await get(h, "/owner/shadow/manifest");
		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");
		const layer = res.json as unknown as LayerManifest & {
			chunks?: unknown;
			searchIndex?: unknown;
		};
		expect(layer.chunks).toBeUndefined();
		expect(layer.searchIndex).toBeUndefined();
		expect(layer.portals.map((p) => p.id).sort()).toEqual(
			[
				".cfg/a.txt",
				".cfg2/a.txt",
				".env",
				".github/ci.yml",
				".husky/pre-commit",
				".vscode/settings.json",
				"src/.eslintrc.json",
			].sort(),
		);

		const chunk = await get(h, "/owner/shadow/chunk/root%23shadow");
		expect(chunk.status).toBe(200);
		expect(chunk.headers["cache-control"]).toBe("no-store");
		expect(chunk.body).toContain("ANTHROPIC_API_KEY");

		const missing = await get(h, "/owner/shadow/chunk/__proto__");
		expect(missing.status).toBe(404);
		const malformed = await get(h, "/owner/shadow/chunk/%E0%A4%A");
		expect(malformed.status).toBe(400);

		const index = await get(h, "/owner/shadow/search-index");
		expect(index.status).toBe(200);
		expect(index.headers["cache-control"]).toBe("no-store");
		expect(index.body).toContain(".github/ci.yml");
	});

	it("nothing under /world/* is ever hidden, before or after the layer is computed", async () => {
		const h = await serve();
		const check = async () => {
			for (const res of await worldFiles(h)) {
				expect(res.status).toBe(200);
				for (const marker of HIDDEN_MARKERS)
					expect(res.body, marker).not.toContain(marker);
			}
		};
		await check();
		await manifestOf(h);
		await check();
		for (const probe of [
			"/world/shadow/manifest",
			"/world/chunks/root%23shadow.json",
			"/world/.env",
		]) {
			const res = await raw(h.port, "GET", probe, {
				host: `127.0.0.1:${h.port}`,
			});
			expect(res.status, probe).toBe(404);
		}
	});
});

describe("shadow save", () => {
	it("writes an existing hidden text file on disk, keeps its mode, and never commits", async () => {
		await initRepo(["README.md", ".husky/pre-commit"]);
		const h = await serve();
		const before = await git.log({ fs, dir });
		const layer = await manifestOf(h);
		const path = ".husky/pre-commit";
		const res = await post(h, "/owner/shadow/save", {
			path,
			content: "#!/bin/sh\necho edited\n",
			baseSha256: layer.textSha256[path],
		});
		expect(res.status).toBe(200);
		expect(res.json).toEqual({ path, sha256: sha("#!/bin/sh\necho edited\n") });
		expect(await readFile(join(dir, path), "utf8")).toBe(
			"#!/bin/sh\necho edited\n",
		);
		expect((await stat(join(dir, path))).mode & 0o777).toBe(0o755);
		expect(await git.log({ fs, dir })).toEqual(before);
		const status = await git.status({ fs, dir, filepath: path });
		expect(status).toBe("*modified");
		// The cache was dropped: the next manifest carries the new hash.
		expect((await manifestOf(h)).textSha256[path]).toBe(
			sha("#!/bin/sh\necho edited\n"),
		);
	});

	it("409 when the file changed on disk since it was loaded", async () => {
		const h = await serve();
		const layer = await manifestOf(h);
		await writeFile(join(dir, ".env"), "CHANGED=1\n");
		const res = await post(h, "/owner/shadow/save", {
			path: ".env",
			content: "MINE=1\n",
			baseSha256: layer.textSha256[".env"],
		});
		expect(res.status).toBe(409);
		expect(res.json.currentSha256).toBe(sha("CHANGED=1\n"));
		expect(await readFile(join(dir, ".env"), "utf8")).toBe("CHANGED=1\n");
		// The stale cache was dropped, so a reload sees the file as it is now.
		expect((await manifestOf(h)).textSha256[".env"]).toBe(sha("CHANGED=1\n"));
	});

	it("refuses a path reached through a symlink", async () => {
		const h = await serve();
		const layer = await manifestOf(h);
		const base = layer.textSha256[".cfg/a.txt"];
		await rename(join(dir, ".cfg"), join(dir, ".cfg-moved"));
		await symlink(join(dir, ".cfg2"), join(dir, ".cfg"));
		const res = await post(h, "/owner/shadow/save", {
			path: ".cfg/a.txt",
			content: "hijack\n",
			baseSha256: base,
		});
		expect(res.status).toBe(403);
		expect(await readFile(join(dir, ".cfg2/a.txt"), "utf8")).toBe("twin\n");
	});

	it("refuses a symlink pointing outside the served folder", async () => {
		await writeFile(join(outside, "target.txt"), "outside\n");
		await symlink(join(outside, "target.txt"), join(dir, ".linked.txt"));
		const h = await serve();
		const layer = await manifestOf(h);
		expect(layer.portals.map((p) => p.id)).not.toContain(".linked.txt");
		const res = await post(h, "/owner/shadow/save", {
			path: ".linked.txt",
			content: "x",
			baseSha256: sha("outside\n"),
		});
		expect(res.status).toBe(403);
		expect(await readFile(join(outside, "target.txt"), "utf8")).toBe(
			"outside\n",
		);
	});

	it.each([
		[".git/config", 403],
		[".GIT/config", 403],
		[".github/new.yml", 403],
		["README.md", 403],
		["../outside.txt", 403],
	])("refuses %s", async (path, status) => {
		await initRepo(["README.md"]);
		const h = await serve();
		await manifestOf(h);
		const res = await post(h, "/owner/shadow/save", {
			path,
			content: "x",
			baseSha256: "0".repeat(64),
		});
		expect(res.status).toBe(status);
	});

	it("refuses to recreate a file that was deleted since it was loaded", async () => {
		const h = await serve();
		const layer = await manifestOf(h);
		await unlink(join(dir, ".vscode/settings.json"));
		const res = await post(h, "/owner/shadow/save", {
			path: ".vscode/settings.json",
			content: "{}\n",
			baseSha256: layer.textSha256[".vscode/settings.json"],
		});
		expect(res.status).toBe(404);
		await expect(stat(join(dir, ".vscode/settings.json"))).rejects.toThrow();
	});

	it("caps the content and the body", async () => {
		const h = await serve();
		const layer = await manifestOf(h);
		const big = await post(h, "/owner/shadow/save", {
			path: ".env",
			content: "x".repeat(512 * 1024 + 1),
			baseSha256: layer.textSha256[".env"],
		});
		expect(big.status).toBe(413);
		const huge = await post(h, "/owner/shadow/save", {
			path: ".env",
			content: "x".repeat(2 * 1024 * 1024 + 1),
			baseSha256: layer.textSha256[".env"],
		});
		expect(huge.status).toBe(413);
		const shape = await post(h, "/owner/shadow/save", {
			path: ".env",
			content: "x",
			baseSha256: "nope",
		});
		expect(shape.status).toBe(400);
	});
});

describe("shadow cache", () => {
	it("is cleared on reconvert (owner git commit)", async () => {
		await initRepo(["README.md", "src/app.js"]);
		const h = await serve();
		expect((await manifestOf(h)).portals.map((p) => p.id)).not.toContain(
			".later/new.txt",
		);
		await writeAll({ ".later/new.txt": "late\n" });
		// Still the cached layer...
		expect((await manifestOf(h)).portals.map((p) => p.id)).not.toContain(
			".later/new.txt",
		);
		const commit = await post(h, "/owner/git/commit", {
			message: "Edit",
			author: { name: author.name, email: author.email },
			files: [{ path: "README.md", content: "# Garden 2\n" }],
		});
		expect(commit.status).toBe(200);
		// ...until a reconvert drops it.
		expect((await manifestOf(h)).portals.map((p) => p.id)).toContain(
			".later/new.txt",
		);
	});
});

describe("magpie on a hidden secret-named file", () => {
	const magpies = (layer: LayerManifest) =>
		[...layer.monsters, ...layer.extendedMonsters]
			.filter((m) => m.species === "magpie")
			.map((m) => m.portalId);

	it("does not appear when git doesn't track the file", async () => {
		await initRepo(["README.md"]);
		const h = await serve();
		expect(magpies(await manifestOf(h))).not.toContain(".env");
	});

	it("appears when git tracks the file", async () => {
		await initRepo(["README.md", ".env"]);
		const h = await serve();
		expect(magpies(await manifestOf(h))).toContain(".env");
	});

	it("does not appear outside a repository", async () => {
		const h = await serve();
		expect(magpies(await manifestOf(h))).not.toContain(".env");
	});
});

describe("shadow signs", () => {
	it("a sign in a hidden folder updates only the shadow layer, never signs.json", async () => {
		const h = await serve();
		await manifestOf(h);
		const res = await post(h, "/owner/signs/save", {
			path: ".github/notes.seyn",
			content: "# CI notes\n",
			create: true,
			realm: "shadow",
		});
		expect(res.status).toBe(200);
		expect(res.json.sign).toMatchObject({
			path: ".github/notes.seyn",
			anchor: { kind: "cluster", id: ".github" },
		});
		expect(await readFile(join(dir, ".github/notes.seyn"), "utf8")).toBe(
			"# CI notes\n",
		);
		const signs = await raw(h.port, "GET", "/world/signs.json", {
			host: `127.0.0.1:${h.port}`,
		});
		expect(signs.body).not.toContain("notes.seyn");
		expect((await manifestOf(h)).signs.map((s) => s.path)).toEqual([
			".github/notes.seyn",
		]);

		const del = await post(h, "/owner/signs/delete", {
			path: ".github/notes.seyn",
			realm: "shadow",
		});
		expect(del.status).toBe(200);
		expect((await manifestOf(h)).signs).toEqual([]);
	});

	it.each([
		".git/a.seyn",
		".GIT/a.seyn",
		".github/node_modules/a.seyn",
		".venv/a.seyn",
		".github/.hidden.seyn",
		"docs/a.seyn",
	])("realm shadow refuses %s", async (path) => {
		await mkdir(join(dir, dirname(path)), { recursive: true });
		const h = await serve();
		const res = await post(h, "/owner/signs/save", {
			path,
			content: "# x\n",
			create: true,
			realm: "shadow",
		});
		expect(res.status).toBe(400);
		await expect(stat(join(dir, path))).rejects.toThrow();
	});

	it("the normal realm still refuses hidden folders", async () => {
		const h = await serve();
		const res = await post(h, "/owner/signs/save", {
			path: ".github/a.seyn",
			content: "# x\n",
			create: true,
		});
		expect(res.status).toBe(400);
	});

	it("overwriting a sign keeps the file's mode", async () => {
		await writeFile(join(dir, "src/old.seyn"), "# old\n");
		await chmod(join(dir, "src/old.seyn"), 0o640);
		const h = await serve();
		const res = await post(h, "/owner/signs/save", {
			path: "src/old.seyn",
			content: "# new\n",
			create: false,
		});
		expect(res.status).toBe(200);
		expect((await stat(join(dir, "src/old.seyn"))).mode & 0o777).toBe(0o640);
	});

	it("isAllowedShadowSignPath", () => {
		expect(isAllowedShadowSignPath(".github/notes.seyn")).toBe(true);
		expect(isAllowedShadowSignPath("src/.config/notes.seyn")).toBe(true);
		expect(isAllowedShadowSignPath("src/notes.seyn")).toBe(false);
		expect(isAllowedShadowSignPath(".git/notes.seyn")).toBe(false);
		expect(isAllowedShadowSignPath(".Git/notes.seyn")).toBe(false);
		expect(isAllowedShadowSignPath(".NEXT/notes.seyn")).toBe(false);
		expect(isAllowedShadowSignPath(".github/../notes.seyn")).toBe(false);
		expect(isAllowedShadowSignPath(".github/_notes.seyn")).toBe(false);
	});
});
