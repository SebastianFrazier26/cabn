import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";
import {
	constantTimeEqual,
	isAllowedOrigin,
	isLoopbackHost,
} from "./security.js";

/**
 * Shared gate for every owner-only route `cabn serve --owner` exposes (git
 * writes today, signs next). Deliberately small and self-contained so each
 * route module calls the same three steps: checkOwnerRequest, then
 * readOwnerJson, then its own work.
 *
 * The token is per serve process, separate from the page/exec token, and is
 * only ever written into the host page when owner mode is on — a hosted
 * build has no token and no owner routes at all.
 */
export const OWNER_TOKEN_HEADER = "x-cabn-owner-token";
export const OWNER_MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface OwnerSession {
	token: string;
}

export function createOwnerSession(): OwnerSession {
	return { token: randomBytes(32).toString("hex") };
}

export type OwnerCheck =
	| { ok: true }
	| { ok: false; status: number; message: string };

function header(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name];
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Stricter than the server-wide loopback gate: Origin is required, not just
 * checked when present (every browser fetch/POST sends it, so a request
 * without one isn't the host page), a Sec-Fetch-Site other than
 * same-origin is refused, the token must match in constant time, and a body
 * must be declared JSON (a cross-site form can't send that content type
 * without a CORS preflight this server never answers).
 */
export function checkOwnerRequest(
	req: IncomingMessage,
	session: OwnerSession,
	port: number,
): OwnerCheck {
	if (!isLoopbackHost(req.headers.host, port))
		return { ok: false, status: 403, message: "invalid host" };
	const origin = header(req, "origin");
	if (origin === undefined || !isAllowedOrigin(origin, port))
		return { ok: false, status: 403, message: "invalid origin" };
	const site = header(req, "sec-fetch-site");
	if (site !== undefined && site !== "same-origin")
		return { ok: false, status: 403, message: "cross-site request" };
	const token = header(req, OWNER_TOKEN_HEADER);
	if (!token || !constantTimeEqual(token, session.token))
		return { ok: false, status: 403, message: "invalid owner token" };
	if (req.method !== "GET") {
		const type = header(req, "content-type") ?? "";
		if (!/^application\/json(\s*;|$)/i.test(type))
			return { ok: false, status: 415, message: "expected application/json" };
	}
	return { ok: true };
}

export type OwnerBody<T> =
	| { ok: true; value: T }
	| { ok: false; status: number; message: string };

export async function readOwnerJson<T>(
	req: IncomingMessage,
	schema: z.ZodType<T>,
	maxBytes = OWNER_MAX_BODY_BYTES,
): Promise<OwnerBody<T>> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		total += (chunk as Buffer).length;
		if (total > maxBytes)
			return { ok: false, status: 413, message: "request body too large" };
		chunks.push(chunk as Buffer);
	}
	let json: unknown;
	try {
		json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return { ok: false, status: 400, message: "invalid JSON" };
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success)
		return {
			ok: false,
			status: 400,
			message: parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
				.join("; "),
		};
	return { ok: true, value: parsed.data };
}

export function sendOwnerJson(
	res: ServerResponse,
	status: number,
	body: unknown,
): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}
