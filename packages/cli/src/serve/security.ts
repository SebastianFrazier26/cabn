import { timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * Constant-time token compare — a plain `===` leaks timing information
 * proportional to the number of matching leading bytes, which is exactly the
 * kind of side channel a local exec token (the only thing standing between a
 * page load and running the visitor's code) can't afford. Length is checked
 * first (an unavoidable, low-value leak — token length is fixed and public
 * anyway) so `timingSafeEqual` never has to see mismatched buffer lengths,
 * which it throws on rather than treating as "unequal".
 */
export function constantTimeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * True only for an exact `127.0.0.1:<port>` or `localhost:<port>` Host
 * header — defeats DNS rebinding (an attacker's page pointing a public
 * domain's DNS at 127.0.0.1 would still send that domain as the Host header,
 * not "localhost"/"127.0.0.1"). Case-insensitive on the hostname per the Host
 * header's own grammar; the port must match exactly, no default-port
 * shorthand accepted since this server is never on 80/443.
 */
export function isLoopbackHost(
	hostHeader: string | undefined,
	port: number,
): boolean {
	if (!hostHeader) return false;
	const match = /^([^:]+):(\d+)$/.exec(hostHeader.trim());
	if (!match) return false;
	const [, hostname, portStr] = match;
	if (Number(portStr) !== port) return false;
	const lower = (hostname ?? "").toLowerCase();
	return lower === "127.0.0.1" || lower === "localhost";
}

/** `Origin` is optional (curl and most non-browser clients never send it) — only checked when present, per the milestone's own wording ("Origin (if present) matches"). */
export function isAllowedOrigin(
	originHeader: string | undefined,
	port: number,
): boolean {
	if (originHeader === undefined) return true;
	const match = /^http:\/\/([^:/]+):(\d+)\/?$/.exec(originHeader.trim());
	if (!match) return false;
	const [, hostname, portStr] = match;
	if (Number(portStr) !== port) return false;
	const lower = (hostname ?? "").toLowerCase();
	return lower === "127.0.0.1" || lower === "localhost";
}

export class PathConfinementError extends Error {}

/**
 * Resolves `relPath` against `rootDir` and guarantees the *real* (symlinks
 * resolved) result is still inside the *real* root — the two-step check a
 * naive `path.resolve` + `startsWith` misses: a same-directory symlink
 * pointing outside `rootDir` would pass a plain string-prefix check on the
 * unresolved path but must still be rejected. Absolute input paths are
 * rejected outright before ever reaching `path.resolve` — `path.resolve(root,
 * "/etc/passwd")` discards `root` entirely per Node's own path.resolve
 * semantics (a later absolute segment wins), which would otherwise turn this
 * into the exact traversal bug it exists to prevent.
 */
export async function resolveConfinedPath(
	rootDir: string,
	relPath: string,
): Promise<string> {
	if (relPath === "" || isAbsolute(relPath) || relPath.includes("\0")) {
		throw new PathConfinementError(`refusing to resolve "${relPath}"`);
	}
	const realRoot = await realpath(rootDir);
	const candidate = resolve(realRoot, relPath);
	if (candidate !== realRoot && !candidate.startsWith(realRoot + sep)) {
		throw new PathConfinementError(`"${relPath}" escapes the served directory`);
	}
	let realCandidate: string;
	try {
		realCandidate = await realpath(candidate);
	} catch (err) {
		throw new PathConfinementError(
			`"${relPath}" does not resolve to a real file`,
			{
				cause: err,
			},
		);
	}
	if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
		throw new PathConfinementError(
			`"${relPath}" escapes the served directory via a symlink`,
		);
	}
	return realCandidate;
}
