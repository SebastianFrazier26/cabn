import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ServeHandle, startServe } from "../../src/serve/server.js";

const FIXTURE_DIR = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"serve-project",
);

function hasPython3(): boolean {
	try {
		execFileSync("python3", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const pythonAvailable = hasPython3();

let handle: ServeHandle | undefined;

afterEach(async () => {
	await handle?.close();
	handle = undefined;
});

async function readNdjsonBody(
	res: Response,
): Promise<Array<Record<string, unknown>>> {
	const text = await res.text();
	return text
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));
}

interface RawResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/** `fetch()` treats `Host` as a forbidden request header and silently ignores an attempt to override it (WHATWG fetch spec) — a spoofed-Host test needs raw `node:http`, which has no such restriction. */
function rawPost(
	port: number,
	path: string,
	headers: Record<string, string>,
	body: string,
): Promise<RawResponse> {
	return new Promise((resolveReq, rejectReq) => {
		const req = httpRequest(
			{
				host: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: { ...headers, "content-length": Buffer.byteLength(body) },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () =>
					resolveReq({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", rejectReq);
		req.end(body);
	});
}

/** Same rationale as rawPost — a spoofed Host/Origin on a GET needs raw `node:http` too. */
function rawGet(
	port: number,
	path: string,
	headers: Record<string, string>,
): Promise<RawResponse> {
	return new Promise((resolveReq, rejectReq) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port, path, method: "GET", headers },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () =>
					resolveReq({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", rejectReq);
		req.end();
	});
}

describe("startServe — no --allow-exec", () => {
	beforeEach(async () => {
		handle = await startServe(FIXTURE_DIR, { port: 0 });
	});

	it("binds to 127.0.0.1 and serves the world bundle", async () => {
		const res = await fetch(
			`http://127.0.0.1:${handle?.port}/world/world.json`,
		);
		expect(res.status).toBe(200);
		const manifest = await res.json();
		expect(manifest.cabnVersion).toBe(1);
	});

	it("sends a frame-src CSP on the host page ('none' for a world without embeds), and forbids framing it", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-security-policy")).toBe(
			"frame-src 'none'; frame-ancestors 'none'",
		);
		const embeds = await fetch(
			`http://127.0.0.1:${handle?.port}/world/embeds.json`,
		);
		expect((await embeds.json()).entries).toEqual({});
	});

	it("serves media.json and pdf.js's worker from its own origin", async () => {
		const media = await fetch(
			`http://127.0.0.1:${handle?.port}/world/media.json`,
		);
		expect(media.status).toBe(200);
		expect((await media.json()).mediaVersion).toBe(1);

		const monsters = await fetch(
			`http://127.0.0.1:${handle?.port}/world/monsters.json`,
		);
		expect(monsters.status).toBe(200);
		expect((await monsters.json()).monstersVersion).toBe(1);

		const worker = await fetch(
			`http://127.0.0.1:${handle?.port}/pdfjs/pdf.worker.min.mjs`,
		);
		expect(worker.status).toBe(200);
		expect(worker.headers.get("content-type")).toContain("javascript");
		expect((await worker.text()).length).toBeGreaterThan(100_000);
	});

	it("serves only image, audio and font assets", async () => {
		const base = `http://127.0.0.1:${handle?.port}/assets`;
		const sprite = await fetch(`${base}/originals/cabin_256.webp`);
		expect(sprite.status).toBe(200);
		expect(sprite.headers.get("content-type")).toBe("image/webp");
		for (const path of [
			"ui/mockup.html",
			"UI/MOCKUP.HTML",
			"palette.json",
			"ui/STYLE.md",
			"originals",
		]) {
			const res = await fetch(`${base}/${path}`);
			expect(res.status, path).toBe(404);
		}
	});

	it("serves the host page with the token embedded", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/`);
		const html = await res.text();
		expect(html).toContain(handle?.token);
	});

	it("the exec endpoint does not exist at all — a genuine 404, not a gated 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: { "x-cabn-token": handle?.token ?? "" },
			body: JSON.stringify({ path: "hello.py" }),
		});
		expect(res.status).toBe(404);
	});
});

describe("startServe — refuses a non-loopback host with --allow-exec", () => {
	it("throws before ever binding", async () => {
		await expect(
			startServe(FIXTURE_DIR, { port: 0, allowExec: true, host: "0.0.0.0" }),
		).rejects.toThrow(/loopback/i);
	});
});

describe("startServe — --allow-exec", () => {
	beforeEach(async () => {
		handle = await startServe(FIXTURE_DIR, {
			port: 0,
			allowExec: true,
			timeoutMs: 5000,
		});
	});

	it("rejects an exec request with no token as 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			body: JSON.stringify({ path: "hello.py" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects an exec request with the wrong token as 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: { "x-cabn-token": "not-the-real-token" },
			body: JSON.stringify({ path: "hello.py" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects a spoofed Host header as 403, even with a valid token", async () => {
		const res = await rawPost(
			handle?.port ?? 0,
			"/exec",
			{
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
				host: "attacker.example.com",
			},
			JSON.stringify({ path: "hello.py" }),
		);
		expect(res.status).toBe(403);
	});

	it("rejects a mismatched Origin header as 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				origin: "http://evil.example.com",
			},
			body: JSON.stringify({ path: "hello.py" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects a path traversal attempt as 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: "../serve-project-outside/secret.txt" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects an absolute path as 403", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: "/etc/passwd" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects an unsupported (but existing) extension as 400", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: "unsupported.rb" }),
		});
		expect(res.status).toBe(400);
	});

	it("with a valid token, streams NDJSON output and line events for a real python run", async () => {
		if (!pythonAvailable) return;
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: "hello.py" }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("ndjson");
		const events = await readNdjsonBody(res);
		expect(events.some((e) => e.type === "line")).toBe(true);
		expect(
			events.some(
				(e) => e.type === "stdout" && String(e.text).includes("hello world"),
			),
		).toBe(true);
		expect(events.at(-1)).toEqual({ type: "exit", code: 0 });
	});

	it("runs a plain JS file without real line tracing (no line events, real stdout)", async () => {
		const res = await fetch(`http://127.0.0.1:${handle?.port}/exec`, {
			method: "POST",
			headers: {
				"x-cabn-token": handle?.token ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: "hello.js" }),
		});
		expect(res.status).toBe(200);
		const events = await readNdjsonBody(res);
		expect(events.some((e) => e.type === "line")).toBe(false);
		expect(
			events.some(
				(e) => e.type === "stdout" && String(e.text).includes("hello world"),
			),
		).toBe(true);
	});
});

// Every route, not just /exec — a DNS-rebinding page hitting a spoofed
// hostname must never be able to read the world bundle (source code) or the
// session token embedded in "/"'s HTML, with or without --allow-exec.
describe.each([
	{ label: "without --allow-exec", allowExec: false },
	{ label: "with --allow-exec", allowExec: true },
])(
	"startServe — every route is Host/Origin gated ($label)",
	({ allowExec }) => {
		let chunkPath: string;

		beforeEach(async () => {
			handle = await startServe(FIXTURE_DIR, { port: 0, allowExec });
			const manifest = await (
				await fetch(`http://127.0.0.1:${handle.port}/world/world.json`)
			).json();
			const clusterId = manifest.clusters[0].id;
			chunkPath = `/world/chunks/${clusterId}.json`;
		});

		it.each([
			"/",
			"/app.js",
			"/world/world.json",
			"/assets/originals/cabin_256.webp",
		])("rejects a spoofed Host header on GET %s as 403", async (path) => {
			const res = await rawGet(handle?.port ?? 0, path, {
				host: "evil.example.com",
			});
			expect(res.status).toBe(403);
		});

		it("rejects a spoofed Host header on a chunk path as 403", async () => {
			const res = await rawGet(handle?.port ?? 0, chunkPath, {
				host: "evil.example.com",
			});
			expect(res.status).toBe(403);
		});

		it("rejects a hostile Origin header on a plain GET as 403", async () => {
			const res = await rawGet(handle?.port ?? 0, "/", {
				host: `127.0.0.1:${handle?.port}`,
				origin: "http://evil.example.com",
			});
			expect(res.status).toBe(403);
		});

		it("still serves a legitimate 127.0.0.1 Host as 200", async () => {
			const res = await rawGet(handle?.port ?? 0, "/", {
				host: `127.0.0.1:${handle?.port}`,
			});
			expect(res.status).toBe(200);
		});

		it("still serves a legitimate localhost Host as 200", async () => {
			const res = await rawGet(handle?.port ?? 0, "/", {
				host: `localhost:${handle?.port}`,
			});
			expect(res.status).toBe(200);
		});

		it("'/' is never cached and never leaks via Referer", async () => {
			const res = await rawGet(handle?.port ?? 0, "/", {
				host: `127.0.0.1:${handle?.port}`,
			});
			expect(res.status).toBe(200);
			expect(res.headers["cache-control"]).toBe("no-store");
			expect(res.headers["referrer-policy"]).toBe("no-referrer");
			expect(res.headers["x-content-type-options"]).toBe("nosniff");
		});
	},
);
