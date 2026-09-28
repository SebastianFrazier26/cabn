import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	checkOwnerRequest,
	generateOwnerToken,
	isLoopbackHostHeader,
	isLoopbackOrigin,
	OWNER_TOKEN_HEADER,
	OwnerPathError,
	ownerTokenMatches,
	readOwnerJson,
	resolveOwnerTarget,
} from "../../src/serve/ownerAuth.js";

const PORT = 5178;
const TOKEN = "a".repeat(64);

function fakeReq(
	headers: Record<string, string>,
	body = "",
	method = "POST",
): IncomingMessage {
	const stream = Readable.from(
		body ? [Buffer.from(body)] : [],
	) as unknown as IncomingMessage;
	stream.method = method;
	stream.headers = headers;
	return stream;
}

const goodHeaders = () => ({
	host: `127.0.0.1:${PORT}`,
	origin: `http://127.0.0.1:${PORT}`,
	"content-type": "application/json",
	[OWNER_TOKEN_HEADER]: TOKEN,
});

describe("owner token", () => {
	it("is 256 random bits, new each time", () => {
		const a = generateOwnerToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(generateOwnerToken()).not.toBe(a);
	});

	it("matches only exactly", () => {
		expect(ownerTokenMatches(TOKEN, TOKEN)).toBe(true);
		for (const bad of [
			undefined,
			"",
			"a",
			`${TOKEN}a`,
			"b".repeat(64),
			42,
			[TOKEN],
		])
			expect(ownerTokenMatches(bad, TOKEN)).toBe(false);
		expect(ownerTokenMatches("", "")).toBe(false);
	});
});

describe("host / origin", () => {
	it.each([
		["127.0.0.1:5178", true],
		["localhost:5178", true],
		["LOCALHOST:5178", true],
		["127.0.0.1:5179", false],
		["127.0.0.1", false],
		["evil.com:5178", false],
		["127.0.0.1.evil.com:5178", false],
		["[::1]:5178", false],
		["0.0.0.0:5178", false],
	])("host %s -> %s", (host, ok) => {
		expect(isLoopbackHostHeader(host, PORT)).toBe(ok);
	});

	it.each([
		["http://127.0.0.1:5178", true],
		["http://localhost:5178", true],
		["https://127.0.0.1:5178", false],
		["http://127.0.0.1:5178/", false],
		["http://evil.com:5178", false],
		["null", false],
		["", false],
	])("origin %s -> %s", (origin, ok) => {
		expect(isLoopbackOrigin(origin, PORT)).toBe(ok);
	});
	it("a missing origin is refused", () => {
		expect(isLoopbackOrigin(undefined, PORT)).toBe(false);
	});
});

describe("checkOwnerRequest", () => {
	const check = (headers: Record<string, string>, method = "POST") =>
		checkOwnerRequest(fakeReq(headers, "", method), {
			port: PORT,
			token: TOKEN,
		});

	it("accepts a well-formed same-origin request", () => {
		expect(check(goodHeaders())).toEqual({ ok: true });
		expect(
			check({ ...goodHeaders(), "sec-fetch-site": "same-origin" }),
		).toEqual({ ok: true });
		expect(
			check({
				...goodHeaders(),
				"content-type": "application/json; charset=utf-8",
			}),
		).toEqual({ ok: true });
	});

	it("refuses a missing or wrong token", () => {
		const { [OWNER_TOKEN_HEADER]: _, ...noToken } = goodHeaders();
		expect(check(noToken)).toMatchObject({ ok: false, status: 403 });
		expect(
			check({ ...goodHeaders(), [OWNER_TOKEN_HEADER]: "b".repeat(64) }),
		).toMatchObject({ ok: false, status: 403 });
	});

	it("refuses a bad or missing Origin, a rebound Host, and cross-site fetches", () => {
		const { origin: _, ...noOrigin } = goodHeaders();
		expect(check(noOrigin)).toMatchObject({
			ok: false,
			status: 403,
			reason: "invalid origin",
		});
		expect(
			check({ ...goodHeaders(), origin: "https://evil.example" }),
		).toMatchObject({ ok: false, status: 403 });
		expect(
			check({ ...goodHeaders(), host: "evil.example:5178" }),
		).toMatchObject({ ok: false, reason: "invalid host" });
		expect(
			check({ ...goodHeaders(), "sec-fetch-site": "cross-site" }),
		).toMatchObject({ ok: false, status: 403 });
	});

	it("refuses non-JSON bodies and non-POST methods", () => {
		expect(
			check({ ...goodHeaders(), "content-type": "text/plain" }),
		).toMatchObject({ ok: false, status: 415 });
		expect(
			check({
				...goodHeaders(),
				"content-type": "application/x-www-form-urlencoded",
			}),
		).toMatchObject({ ok: false, status: 415 });
		expect(check(goodHeaders(), "GET")).toMatchObject({
			ok: false,
			status: 405,
		});
	});
});

describe("readOwnerJson", () => {
	const Schema = z.strictObject({ path: z.string() });
	it("parses and validates", async () => {
		expect(await readOwnerJson(fakeReq({}, '{"path":"a"}'), Schema)).toEqual({
			ok: true,
			data: { path: "a" },
		});
	});
	it("rejects bad JSON, the wrong shape, and oversized bodies", async () => {
		expect(await readOwnerJson(fakeReq({}, "{nope"), Schema)).toMatchObject({
			ok: false,
			status: 400,
		});
		expect(
			await readOwnerJson(fakeReq({}, '{"path":1}'), Schema),
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await readOwnerJson(fakeReq({}, '{"path":"a","x":1}'), Schema),
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await readOwnerJson(
				fakeReq({}, JSON.stringify({ path: "x".repeat(200) })),
				Schema,
				100,
			),
		).toMatchObject({ ok: false, status: 413 });
		expect(
			await readOwnerJson(
				fakeReq({ "content-length": "999999" }, "{}"),
				Schema,
				100,
			),
		).toMatchObject({ ok: false, status: 413 });
	});
});

describe("resolveOwnerTarget", () => {
	let root: string;
	let outside: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cabn-owner-root-"));
		outside = await mkdtemp(join(tmpdir(), "cabn-owner-outside-"));
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "a.seyn"), "hi");
		await writeFile(join(outside, "secret.seyn"), "secret");
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	});
	const ext = { extension: ".seyn" };

	it("resolves new and existing files inside the root", async () => {
		expect(await resolveOwnerTarget(root, "src/a.seyn", ext)).toMatchObject({
			exists: true,
		});
		const fresh = await resolveOwnerTarget(root, "src/b.seyn", ext);
		expect(fresh.exists).toBe(false);
		expect(fresh.absolute.endsWith(join("src", "b.seyn"))).toBe(true);
	});

	it.each([
		"../escape.seyn",
		"src/../../escape.seyn",
		"/etc/passwd.seyn",
		"C:/x.seyn",
		"src\\a.seyn",
		"src//a.seyn",
		"./a.seyn",
		"a\0.seyn",
		"a\n.seyn",
		"",
	])("rejects traversal/absolute/malformed %j", async (p) => {
		await expect(resolveOwnerTarget(root, p, ext)).rejects.toBeInstanceOf(
			OwnerPathError,
		);
	});

	it("rejects other extensions", async () => {
		await expect(resolveOwnerTarget(root, "src/a.ts", ext)).rejects.toThrow(
			/only \.seyn/,
		);
		await expect(
			resolveOwnerTarget(root, "src/a.seyn.ts", ext),
		).rejects.toThrow(/only \.seyn/);
	});

	it("rejects a missing folder", async () => {
		await expect(
			resolveOwnerTarget(root, "nope/a.seyn", ext),
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects a symlinked folder that points outside the root", async () => {
		await symlink(outside, join(root, "link"));
		await expect(
			resolveOwnerTarget(root, "link/secret.seyn", ext),
		).rejects.toThrow(/escapes/);
		await expect(
			resolveOwnerTarget(root, "link/new.seyn", ext),
		).rejects.toThrow(/escapes/);
	});

	it("rejects a symlinked file, even one pointing inside the root", async () => {
		await symlink(join(outside, "secret.seyn"), join(root, "src", "evil.seyn"));
		await symlink(join(root, "src", "a.seyn"), join(root, "src", "inner.seyn"));
		await symlink(
			join(outside, "nothing.seyn"),
			join(root, "src", "dangling.seyn"),
		);
		for (const p of ["src/evil.seyn", "src/inner.seyn", "src/dangling.seyn"])
			await expect(resolveOwnerTarget(root, p, ext), p).rejects.toThrow(
				/symlink/,
			);
	});

	it("rejects a directory named like a sign", async () => {
		await mkdir(join(root, "dir.seyn"));
		await expect(resolveOwnerTarget(root, "dir.seyn", ext)).rejects.toThrow(
			/regular file/,
		);
	});

	it("works when the root itself is reached through a symlink", async () => {
		const alias = `${root}-alias`;
		await symlink(root, alias);
		try {
			expect(await resolveOwnerTarget(alias, "src/a.seyn", ext)).toMatchObject({
				exists: true,
			});
		} finally {
			await rm(alias, { force: true });
		}
	});
});
