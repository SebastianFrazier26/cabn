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

/** `fetch()` treats `Host` as a forbidden request header and silently ignores an attempt to override it (WHATWG fetch spec) — a spoofed-Host test needs raw `node:http`, which has no such restriction. */
function rawPost(
	port: number,
	path: string,
	headers: Record<string, string>,
	body: string,
): Promise<{ status: number; body: string }> {
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
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", rejectReq);
		req.end(body);
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
