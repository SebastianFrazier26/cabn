/**
 * Shared gate for `cabn serve`'s owner API — the loopback-only routes that
 * write into the served folder (ownerSigns.ts today). Self-contained on
 * purpose (node built-ins + zod only) so other owner routes can reuse it
 * without pulling in each other's policy. Every owner request must pass all
 * of: exact loopback Host (DNS rebinding), a present loopback Origin (the
 * browser always sends one on a POST; a missing one means a non-browser or a
 * stripped request), no cross-site Sec-Fetch-Site, a JSON content type (a
 * plain HTML form can't send one), and the per-session owner token in a
 * header (constant-time compared). Bodies are size-capped and schema-checked;
 * paths are confined to the served root with symlinks resolved.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import type { z } from "zod";

export const OWNER_TOKEN_HEADER = "x-cabn-owner-token";
export const OWNER_BODY_MAX_BYTES = 128 * 1024;

/** 256 bits from the OS CSPRNG, hex — new every `cabn serve` start. */
export function generateOwnerToken(): string {
	return randomBytes(32).toString("hex");
}

export function ownerTokenMatches(
	presented: unknown,
	expected: string,
): boolean {
	if (typeof presented !== "string" || expected.length === 0) return false;
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	// Length first: timingSafeEqual throws on unequal lengths, and the
	// length of a fixed-size token isn't a secret.
	return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopbackName(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return lower === "127.0.0.1" || lower === "localhost";
}

/** Exactly `127.0.0.1:<port>` or `localhost:<port>`. */
export function isLoopbackHostHeader(
	host: string | undefined,
	port: number,
): boolean {
	if (typeof host !== "string") return false;
	const m = /^([^:/\s]+):(\d{1,5})$/.exec(host);
	return Boolean(m && isLoopbackName(m[1] ?? "") && Number(m[2]) === port);
}

/** Exactly `http://127.0.0.1:<port>` or `http://localhost:<port>` — required, not optional as it is for page loads. */
export function isLoopbackOrigin(
	origin: string | undefined,
	port: number,
): boolean {
	if (typeof origin !== "string") return false;
	const m = /^http:\/\/([^:/\s]+):(\d{1,5})$/.exec(origin);
	return Boolean(m && isLoopbackName(m[1] ?? "") && Number(m[2]) === port);
}

export type OwnerCheck =
	| { ok: true }
	| { ok: false; status: number; reason: string };

function header(req: IncomingMessage, name: string): string | undefined {
	const v = req.headers[name];
	return Array.isArray(v) ? v[0] : v;
}

export function checkOwnerRequest(
	req: IncomingMessage,
	opts: { port: number; token: string },
): OwnerCheck {
	if (req.method !== "POST")
		return { ok: false, status: 405, reason: "use POST" };
	if (!isLoopbackHostHeader(header(req, "host"), opts.port))
		return { ok: false, status: 403, reason: "invalid host" };
	if (!isLoopbackOrigin(header(req, "origin"), opts.port))
		return { ok: false, status: 403, reason: "invalid origin" };
	const site = header(req, "sec-fetch-site");
	if (site !== undefined && site !== "same-origin")
		return { ok: false, status: 403, reason: "cross-site request" };
	const type = (header(req, "content-type") ?? "").split(";")[0]?.trim();
	if (type?.toLowerCase() !== "application/json")
		return { ok: false, status: 415, reason: "expected application/json" };
	if (!ownerTokenMatches(header(req, OWNER_TOKEN_HEADER), opts.token))
		return { ok: false, status: 403, reason: "invalid owner token" };
	return { ok: true };
}

export type OwnerBody<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; reason: string };

/** Reads, size-caps, JSON-parses and schema-checks a request body. Never throws. */
export async function readOwnerJson<T>(
	req: IncomingMessage,
	schema: z.ZodType<T>,
	maxBytes = OWNER_BODY_MAX_BYTES,
): Promise<OwnerBody<T>> {
	const declared = Number(header(req, "content-length"));
	if (Number.isFinite(declared) && declared > maxBytes)
		return { ok: false, status: 413, reason: "request body too large" };
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for await (const chunk of req) {
			total += (chunk as Buffer).length;
			if (total > maxBytes)
				return { ok: false, status: 413, reason: "request body too large" };
			chunks.push(chunk as Buffer);
		}
	} catch {
		return { ok: false, status: 400, reason: "could not read request body" };
	}
	let json: unknown;
	try {
		json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return { ok: false, status: 400, reason: "invalid JSON" };
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success)
		return {
			ok: false,
			status: 400,
			reason: `invalid request: ${parsed.error.issues[0]?.message ?? "bad shape"}`,
		};
	return { ok: true, data: parsed.data };
}

export class OwnerPathError extends Error {
	constructor(
		message: string,
		readonly status = 403,
	) {
		super(message);
	}
}

function inside(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(root + sep);
}

export interface OwnerTarget {
	/** Real (symlink-free) absolute path to write/delete. */
	absolute: string;
	/** Whether a regular file is already there. */
	exists: boolean;
}

/**
 * Confines a relative path from a request to `root`, for a file that may not
 * exist yet: rejects absolute paths, backslashes, NUL/control characters,
 * empty/`.`/`..` segments and a wrong extension up front; then resolves the
 * parent folder's *real* path (it must already exist and still be inside the
 * real root, so a symlinked folder pointing outside is refused) and refuses
 * a final component that is a symlink or not a regular file.
 */
export async function resolveOwnerTarget(
	root: string,
	relPath: string,
	opts: { extension: string },
): Promise<OwnerTarget> {
	if (
		typeof relPath !== "string" ||
		relPath.length === 0 ||
		relPath.length > 512 ||
		isAbsolute(relPath) ||
		relPath.startsWith("/") ||
		/^[A-Za-z]:/.test(relPath) ||
		relPath.includes("\\") ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
		/[\u0000-\u001F\u007F]/.test(relPath)
	)
		throw new OwnerPathError("path must be relative to the served folder");
	const segments = relPath.split("/");
	if (segments.some((s) => s === "" || s === "." || s === ".."))
		throw new OwnerPathError("path must not contain empty, . or .. segments");
	if (!relPath.endsWith(opts.extension))
		throw new OwnerPathError(`only ${opts.extension} files can be written`);

	const realRoot = await realpath(root);
	let realParent: string;
	try {
		realParent = await realpath(join(realRoot, dirname(relPath)));
	} catch {
		throw new OwnerPathError("that folder does not exist", 404);
	}
	if (!inside(realRoot, realParent))
		throw new OwnerPathError("path escapes the served folder");
	const absolute = join(realParent, basename(relPath));
	if (!inside(realRoot, absolute))
		throw new OwnerPathError("path escapes the served folder");
	try {
		const stat = await lstat(absolute);
		if (stat.isSymbolicLink())
			throw new OwnerPathError("refusing to follow a symlink");
		if (!stat.isFile()) throw new OwnerPathError("not a regular file");
		return { absolute, exists: true };
	} catch (err) {
		if (err instanceof OwnerPathError) throw err;
		if ((err as NodeJS.ErrnoException).code === "ENOENT")
			return { absolute, exists: false };
		throw err;
	}
}
