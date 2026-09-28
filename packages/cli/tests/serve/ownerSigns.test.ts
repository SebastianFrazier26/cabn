import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_TOKEN_HEADER } from "../../src/serve/ownerAuth.js";
import { isAllowedSignPath } from "../../src/serve/ownerSigns.js";
import { type ServeHandle, startServe } from "../../src/serve/server.js";

const FIXTURE_DIR = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"serve-project",
);

interface RawResponse {
	status: number;
	body: string;
}

function raw(
	port: number,
	method: string,
	path: string,
	headers: Record<string, string>,
	body = "",
): Promise<RawResponse> {
	return new Promise((resolveReq, rejectReq) => {
		const req = httpRequest(
			{
				host: "127.0.0.1",
				port,
				path,
				method,
				headers: { ...headers, "content-length": Buffer.byteLength(body) },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () =>
					resolveReq({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", rejectReq);
		req.end(body);
	});
}

let dir: string;
let outside: string;
let handle: ServeHandle | undefined;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-owner-signs-"));
	outside = await mkdtemp(join(tmpdir(), "cabn-owner-outside-"));
	await cp(FIXTURE_DIR, dir, { recursive: true });
	await mkdir(join(dir, "docs"));
	await writeFile(join(dir, "docs", "notes.md"), "# notes\n");
});

afterEach(async () => {
	await handle?.close();
	handle = undefined;
	await rm(dir, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

function owner(h: ServeHandle) {
	const headers = (extra: Record<string, string> = {}) => ({
		host: `127.0.0.1:${h.port}`,
		origin: `http://127.0.0.1:${h.port}`,
		"content-type": "application/json",
		[OWNER_TOKEN_HEADER]: h.ownerToken ?? "",
		...extra,
	});
	return {
		save: (body: unknown, extra?: Record<string, string>) =>
			raw(
				h.port,
				"POST",
				"/owner/signs/save",
				headers(extra),
				JSON.stringify(body),
			),
		remove: (body: unknown, extra?: Record<string, string>) =>
			raw(
				h.port,
				"POST",
				"/owner/signs/delete",
				headers(extra),
				JSON.stringify(body),
			),
		signsJson: async () =>
			JSON.parse(
				(
					await raw(h.port, "GET", "/world/signs.json", {
						host: `127.0.0.1:${h.port}`,
					})
				).body,
			),
	};
}

describe("owner sign routes", () => {
	beforeEach(async () => {
		handle = await startServe(dir, { port: 0, offline: true });
	});

	it("creates a sign on disk and updates the served signs.json live", async () => {
		const h = handle as ServeHandle;
		const api = owner(h);
		const content = "@near /hello.py\n# Hello\n\nRun *me*.\n";
		const res = await api.save({ path: "hello.seyn", content, create: true });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body).sign).toEqual({
			path: "hello.seyn",
			source: content,
			anchor: { kind: "portal", id: "hello.py" },
		});
		expect(await readFile(join(dir, "hello.seyn"), "utf8")).toBe(content);
		expect(
			(await api.signsJson()).signs.map((s: { path: string }) => s.path),
		).toEqual(["hello.seyn"]);
	});

	it("create refuses to clobber; overwrite requires an existing file", async () => {
		const api = owner(handle as ServeHandle);
		await writeFile(join(dir, "docs", "taken.seyn"), "mine");
		expect(
			(await api.save({ path: "docs/taken.seyn", content: "x", create: true }))
				.status,
		).toBe(409);
		expect(await readFile(join(dir, "docs", "taken.seyn"), "utf8")).toBe(
			"mine",
		);
		expect(
			(await api.save({ path: "docs/new.seyn", content: "x", create: false }))
				.status,
		).toBe(404);
		const ok = await api.save({
			path: "docs/taken.seyn",
			content: "edited",
			create: false,
		});
		expect(ok.status).toBe(200);
		expect(await readFile(join(dir, "docs", "taken.seyn"), "utf8")).toBe(
			"edited",
		);
		expect(JSON.parse(ok.body).sign.anchor).toMatchObject({ kind: "cluster" });
	});

	it("deletes a sign and drops it from signs.json", async () => {
		const api = owner(handle as ServeHandle);
		await api.save({ path: "bye.seyn", content: "bye", create: true });
		const res = await api.remove({ path: "bye.seyn" });
		expect(res.status).toBe(200);
		await expect(stat(join(dir, "bye.seyn"))).rejects.toThrow();
		expect((await api.signsJson()).signs).toEqual([]);
		expect((await api.remove({ path: "bye.seyn" })).status).toBe(404);
	});

	it("refuses a missing or wrong token, a bad origin, and a rebound host", async () => {
		const h = handle as ServeHandle;
		const api = owner(h);
		const body = { path: "x.seyn", content: "x", create: true };
		expect((await api.save(body, { [OWNER_TOKEN_HEADER]: "" })).status).toBe(
			403,
		);
		expect(
			(await api.save(body, { [OWNER_TOKEN_HEADER]: h.token })).status,
		).toBe(403);
		expect(
			(await api.save(body, { origin: "https://evil.example" })).status,
		).toBe(403);
		expect(
			(await api.save(body, { host: `evil.example:${h.port}` })).status,
		).toBe(403);
		expect(
			(await api.save(body, { "content-type": "text/plain" })).status,
		).toBe(415);
		await expect(stat(join(dir, "x.seyn"))).rejects.toThrow();
	});

	it.each([
		"../escape.seyn",
		"/tmp/abs.seyn",
		"docs/../../escape.seyn",
		"hello.py",
		"notes.md",
		"x.seyn.sh",
		".git/hook.seyn",
		".hidden/x.seyn",
		"node_modules/x.seyn",
		"dist/x.seyn",
		"docs\\x.seyn",
	])("refuses the path %j", async (path) => {
		const res = await owner(handle as ServeHandle).save({
			path,
			content: "x",
			create: true,
		});
		expect(res.status).toBe(400);
	});

	it("refuses to write through a symlinked folder or over a symlink", async () => {
		const api = owner(handle as ServeHandle);
		await symlink(outside, join(dir, "link"));
		const viaFolder = await api.save({
			path: "link/evil.seyn",
			content: "x",
			create: true,
		});
		expect(viaFolder.status).toBe(403);
		await expect(stat(join(outside, "evil.seyn"))).rejects.toThrow();

		await writeFile(join(outside, "target.seyn"), "untouched");
		await symlink(join(outside, "target.seyn"), join(dir, "docs", "ln.seyn"));
		expect(
			(await api.save({ path: "docs/ln.seyn", content: "x", create: false }))
				.status,
		).toBe(403);
		expect(
			(await api.save({ path: "docs/ln.seyn", content: "x", create: true }))
				.status,
		).toBe(403);
		expect((await api.remove({ path: "docs/ln.seyn" })).status).toBe(403);
		expect(await readFile(join(outside, "target.seyn"), "utf8")).toBe(
			"untouched",
		);
	});

	it("caps size and rejects malformed bodies", async () => {
		const api = owner(handle as ServeHandle);
		expect(
			(
				await api.save({
					path: "big.seyn",
					content: "x".repeat(17 * 1024),
					create: true,
				})
			).status,
		).toBe(413);
		expect(
			(await api.save({ path: "a.seyn", content: 1, create: true })).status,
		).toBe(400);
		expect(
			(await api.save({ path: "a.seyn", content: "x", create: true, extra: 1 }))
				.status,
		).toBe(400);
		expect(
			(
				await api.save({
					path: "a.seyn",
					content: "x".repeat(200_000),
					create: true,
				})
			).status,
		).toBe(413);
	});

	it("only POST", async () => {
		const h = handle as ServeHandle;
		const res = await raw(h.port, "GET", "/owner/signs/save", {
			host: `127.0.0.1:${h.port}`,
			origin: `http://127.0.0.1:${h.port}`,
		});
		expect(res.status).toBe(405);
	});

	it("the owner token is in the page but never in the printed url or app.js", async () => {
		const h = handle as ServeHandle;
		const page = await raw(h.port, "GET", "/", { host: `127.0.0.1:${h.port}` });
		expect(page.body).toContain(h.ownerToken);
		expect(h.url).not.toContain(h.ownerToken);
		const app = await raw(h.port, "GET", "/app.js", {
			host: `127.0.0.1:${h.port}`,
		});
		expect(app.body).not.toContain(h.ownerToken);
		expect(app.body).toContain("/owner/signs/save");
	}, 20_000);
});

describe("owner mode off", () => {
	it("has no owner routes, no token and no client in the page", async () => {
		handle = await startServe(dir, { port: 0, offline: true, owner: false });
		expect(handle.ownerToken).toBeUndefined();
		const res = await raw(
			handle.port,
			"POST",
			"/owner/signs/save",
			{
				host: `127.0.0.1:${handle.port}`,
				origin: `http://127.0.0.1:${handle.port}`,
				"content-type": "application/json",
				[OWNER_TOKEN_HEADER]: "anything",
			},
			JSON.stringify({ path: "x.seyn", content: "x", create: true }),
		);
		expect(res.status).toBe(404);
		const app = await raw(handle.port, "GET", "/app.js", {
			host: `127.0.0.1:${handle.port}`,
		});
		expect(app.body).not.toContain("/owner/signs/save");
		const page = await raw(handle.port, "GET", "/", {
			host: `127.0.0.1:${handle.port}`,
		});
		expect(page.body).not.toContain("__CABN_OWNER_TOKEN__");
	}, 20_000);
});

describe("isAllowedSignPath", () => {
	it.each([
		["a.seyn", true],
		["docs/My Notes.seyn", true],
		["build/x.seyn", false],
		["__pycache__/x.seyn", false],
		[".github/x.seyn", false],
		["x.SEYN", false],
	])("%j -> %s", (p, ok) => {
		expect(isAllowedSignPath(p)).toBe(ok);
	});
});
