import * as fs from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ServeHandle, startServe } from "../../src/serve/server.js";

interface RawResponse {
	status: number;
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
					resolveReq({ status: res.statusCode ?? 0, body: text, json });
				});
			},
		);
		req.on("error", rejectReq);
		req.end(body);
	});
}

let repoDir: string;
let outsideDir: string;
let handle: ServeHandle | undefined;

const author = {
	name: "Wren Hollow",
	email: "wren@hollow.example",
	timestamp: 1780000000,
	timezoneOffset: 0,
};

async function commitFiles(files: Record<string, string>, message: string) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(repoDir, path)), { recursive: true });
		await writeFile(join(repoDir, path), content);
		await git.add({ fs, dir: repoDir, filepath: path });
	}
	return git.commit({ fs, dir: repoDir, message, author });
}

beforeEach(async () => {
	repoDir = await mkdtemp(join(tmpdir(), "cabn-owner-repo-"));
	outsideDir = await mkdtemp(join(tmpdir(), "cabn-owner-outside-"));
	await git.init({ fs, dir: repoDir, defaultBranch: "main" });
	await commitFiles(
		{ "README.md": "# Garden\n", "src/app.js": "export const a = 1;\n" },
		"Plant",
	);
	await git.branch({ fs, dir: repoDir, ref: "side" });
});

afterEach(async () => {
	await handle?.close();
	handle = undefined;
	await rm(repoDir, { recursive: true, force: true });
	await rm(outsideDir, { recursive: true, force: true });
});

async function serveOwner(extra: { owner?: boolean } = {}) {
	handle = await startServe(repoDir, {
		port: 0,
		offline: true,
		owner: extra.owner ?? true,
	});
	return handle;
}

function ownerHeaders(h: ServeHandle, overrides: Record<string, string> = {}) {
	return {
		host: `127.0.0.1:${h.port}`,
		origin: `http://127.0.0.1:${h.port}`,
		"x-cabn-owner-token": h.ownerToken ?? "",
		"content-type": "application/json",
		...overrides,
	};
}

async function post(
	h: ServeHandle,
	path: string,
	body: unknown,
	overrides = {},
) {
	return raw(
		h.port,
		"POST",
		path,
		ownerHeaders(h, overrides),
		JSON.stringify(body),
	);
}

describe("owner mode is opt-in", () => {
	it("without --owner there is no token in the page and no owner route", async () => {
		const h = await serveOwner({ owner: false });
		const page = await raw(h.port, "GET", "/", { host: `127.0.0.1:${h.port}` });
		expect(page.body).not.toContain("__CABN_OWNER_TOKEN__");
		expect(h.ownerToken).toBeUndefined();
		const res = await raw(h.port, "GET", "/owner/git/status", ownerHeaders(h));
		expect(res.status).toBe(404);
	});

	it("with --owner the page carries a separate token and the host app wires the owner client", async () => {
		const h = await serveOwner();
		const page = await raw(h.port, "GET", "/", { host: `127.0.0.1:${h.port}` });
		expect(page.body).toContain(
			`window.__CABN_OWNER_TOKEN__ = "${h.ownerToken}"`,
		);
		expect(h.ownerToken).not.toBe(h.token);
		const app = await raw(h.port, "GET", "/app.js", {
			host: `127.0.0.1:${h.port}`,
		});
		expect(app.body).toContain("x-cabn-owner-token");
	});

	it("refuses a non-loopback host", async () => {
		await expect(
			startServe(repoDir, {
				port: 0,
				offline: true,
				owner: true,
				host: "0.0.0.0",
			}),
		).rejects.toThrow(/refuses a non-loopback host/);
	});
});

describe("owner request gate", () => {
	it("accepts the host page's request", async () => {
		const h = await serveOwner();
		const res = await raw(h.port, "GET", "/owner/git/status", ownerHeaders(h));
		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({
			branch: "main",
			branches: ["main", "side"],
		});
	});

	it.each([
		["a missing token", { "x-cabn-owner-token": "" }, 403],
		["a wrong token", { "x-cabn-owner-token": "f".repeat(64) }, 403],
		["the page token instead of the owner token", "page-token", 403],
		["a foreign origin", { origin: "http://evil.example" }, 403],
		["a rebinding host", { host: "evil.example:1234" }, 403],
		["a cross-site fetch", { "sec-fetch-site": "cross-site" }, 403],
	] as const)("rejects %s", async (_label, override, status) => {
		const h = await serveOwner();
		const headers =
			override === "page-token"
				? ownerHeaders(h, { "x-cabn-owner-token": h.token })
				: ownerHeaders(h, override as Record<string, string>);
		const res = await raw(h.port, "GET", "/owner/git/status", headers);
		expect(res.status).toBe(status);
	});

	it("a write without an Origin is refused, even claiming same-origin", async () => {
		const h = await serveOwner();
		const headers: Record<string, string> = ownerHeaders(h, {
			"sec-fetch-site": "same-origin",
		});
		delete headers.origin;
		const res = await raw(
			h.port,
			"POST",
			"/owner/git/branch",
			headers,
			JSON.stringify({ name: "x" }),
		);
		expect(res.status).toBe(403);
	});

	it("a same-origin GET (browsers send no Origin) needs Sec-Fetch-Site: same-origin", async () => {
		const h = await serveOwner();
		const headers: Record<string, string> = ownerHeaders(h);
		delete headers.origin;
		expect(
			(await raw(h.port, "GET", "/owner/git/status", headers)).status,
		).toBe(403);
		headers["sec-fetch-site"] = "same-origin";
		expect(
			(await raw(h.port, "GET", "/owner/git/status", headers)).status,
		).toBe(200);
	});

	it("rejects a non-JSON body type (a plain cross-site form can't send JSON)", async () => {
		const h = await serveOwner();
		const res = await post(
			h,
			"/owner/git/branch",
			{ name: "x" },
			{ "content-type": "text/plain" },
		);
		expect(res.status).toBe(415);
	});

	it("rejects the wrong method", async () => {
		const h = await serveOwner();
		const res = await raw(h.port, "GET", "/owner/git/commit", ownerHeaders(h));
		expect(res.status).toBe(405);
	});
});

describe("owner commits", () => {
	it("writes the edit, commits it with the repo's author and reconverts the world", async () => {
		await git.setConfig({
			fs,
			dir: repoDir,
			path: "user.name",
			value: "Wren Hollow",
		});
		await git.setConfig({
			fs,
			dir: repoDir,
			path: "user.email",
			value: "wren@hollow.example",
		});
		const h = await serveOwner();
		const res = await post(h, "/owner/git/commit", {
			message: "Edit from the garden",
			files: [
				{ path: "README.md", content: "# Garden\n\nNow with lanterns.\n" },
			],
		});
		expect(res.status).toBe(200);
		expect(await readFile(join(repoDir, "README.md"), "utf8")).toBe(
			"# Garden\n\nNow with lanterns.\n",
		);
		const log = await git.log({ fs, dir: repoDir, depth: 1 });
		expect(log[0]?.commit.message).toBe("Edit from the garden\n");
		expect(log[0]?.commit.author.name).toBe("Wren Hollow");
		const history = await raw(h.port, "GET", "/world/history.json", {
			host: `127.0.0.1:${h.port}`,
		});
		expect(history.body).toContain("Edit from the garden");
	});

	it("asks for an author when the repository has none, then uses the one given", async () => {
		const h = await serveOwner();
		const body = {
			message: "Edit",
			files: [{ path: "src/app.js", content: "export const a = 2;\n" }],
		};
		const first = await post(h, "/owner/git/commit", body);
		expect(first.status).toBe(409);
		expect(first.json.needsAuthor).toBe(true);
		const second = await post(h, "/owner/git/commit", {
			...body,
			author: { name: "Visitor", email: "v@example.test" },
		});
		expect(second.status).toBe(200);
	});

	it.each([
		["a parent-directory escape", "../outside.txt", 400],
		["an absolute path", "/etc/passwd", 400],
		["the git directory", ".git/config", 400],
		["the git directory, case-folded", ".GIT/config", 400],
		["a backslash path", "src\\app.js", 400],
		["a file that isn't in the world", "not-here.md", 403],
	] as const)("refuses %s", async (_label, path, status) => {
		const h = await serveOwner();
		const res = await post(h, "/owner/git/commit", {
			message: "x",
			author: { name: "A", email: "a@example.test" },
			files: [{ path, content: "pwned" }],
		});
		expect(res.status).toBe(status);
	});

	it("refuses a symlink that escapes the world (it never becomes a world file)", async () => {
		await writeFile(join(outsideDir, "target.md"), "outside\n");
		await symlink(join(outsideDir, "target.md"), join(repoDir, "escape.md"));
		await symlink(outsideDir, join(repoDir, "linkdir"));
		const h = await serveOwner();
		for (const path of ["escape.md", "linkdir/target.md"]) {
			const res = await post(h, "/owner/git/commit", {
				message: "x",
				author: { name: "A", email: "a@example.test" },
				files: [{ path, content: "pwned" }],
			});
			expect(res.status).toBe(403);
		}
		expect(await readFile(join(outsideDir, "target.md"), "utf8")).toBe(
			"outside\n",
		);
	});

	it("refuses to overwrite a file that changed on disk after conversion", async () => {
		const h = await serveOwner();
		await writeFile(join(repoDir, "README.md"), "# Changed in an editor\n");
		const res = await post(h, "/owner/git/commit", {
			message: "x",
			author: { name: "A", email: "a@example.test" },
			files: [{ path: "README.md", content: "# From the game\n" }],
		});
		expect(res.status).toBe(409);
		expect(await readFile(join(repoDir, "README.md"), "utf8")).toBe(
			"# Changed in an editor\n",
		);
	});

	it("refuses when unrelated changes are already staged", async () => {
		await writeFile(join(repoDir, "src/app.js"), "export const a = 3;\n");
		await git.add({ fs, dir: repoDir, filepath: "src/app.js" });
		const h = await serveOwner();
		const res = await post(h, "/owner/git/commit", {
			message: "x",
			author: { name: "A", email: "a@example.test" },
			files: [{ path: "README.md", content: "# Garden!\n" }],
		});
		expect(res.status).toBe(409);
		expect(String(res.json.error)).toMatch(/already staged/);
	});
});

describe("owner branches", () => {
	it("creates a branch and switches to it", async () => {
		const h = await serveOwner();
		const res = await post(h, "/owner/git/branch", {
			name: "feature/lanterns",
			checkout: true,
		});
		expect(res.status).toBe(200);
		expect(await git.currentBranch({ fs, dir: repoDir })).toBe(
			"feature/lanterns",
		);
		const dup = await post(h, "/owner/git/branch", {
			name: "feature/lanterns",
		});
		expect(dup.status).toBe(409);
	});

	it.each([
		"-rf",
		"a..b",
		"../x",
		"HEAD",
		"x.lock",
		"a b",
		"x/",
		".hidden",
		"a//b",
	])("refuses the branch name %j", async (name) => {
		const h = await serveOwner();
		const res = await post(h, "/owner/git/branch", { name });
		expect(res.status).toBe(400);
	});

	it("switches branches for real and reconverts", async () => {
		await git.checkout({ fs, dir: repoDir, ref: "side" });
		await commitFiles({ "side.md": "# Side\n" }, "Side quest");
		await git.checkout({ fs, dir: repoDir, ref: "main" });
		const h = await serveOwner();
		const res = await post(h, "/owner/git/checkout", { branch: "side" });
		expect(res.status).toBe(200);
		expect(await git.currentBranch({ fs, dir: repoDir })).toBe("side");
		expect(fs.existsSync(join(repoDir, "side.md"))).toBe(true);
		const world = await raw(h.port, "GET", "/world/world.json", {
			host: `127.0.0.1:${h.port}`,
		});
		expect(world.body).toContain("side.md");
	});

	it("refuses to switch with uncommitted changes, or to a branch that doesn't exist", async () => {
		const h = await serveOwner();
		expect(
			(await post(h, "/owner/git/checkout", { branch: "nope" })).status,
		).toBe(404);
		await writeFile(join(repoDir, "README.md"), "# dirty\n");
		const res = await post(h, "/owner/git/checkout", { branch: "side" });
		expect(res.status).toBe(409);
		expect(await git.currentBranch({ fs, dir: repoDir })).toBe("main");
	});
});

describe("no remote operations exist", () => {
	it("ownerGit.ts imports no push/fetch/pull/clone and no http client", async () => {
		const source = await readFile(
			join(import.meta.dirname, "..", "..", "src", "serve", "ownerGit.ts"),
			"utf8",
		);
		const importBlock = source.slice(
			source.indexOf('from "isomorphic-git"') - 200,
			source.indexOf('from "isomorphic-git"'),
		);
		for (const op of [
			"push",
			"fetch",
			"pull",
			"clone",
			"addRemote",
			"fastForward",
		]) {
			expect(importBlock).not.toMatch(new RegExp(`\\b${op}\\b`));
		}
		expect(source).not.toContain("isomorphic-git/http");
	});
});
