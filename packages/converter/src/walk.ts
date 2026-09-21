import type { FileSource } from "./sources/types.js";

export const DEFAULT_IGNORES = [
	"node_modules",
	".git",
	"dist",
	"build",
	"target",
	".venv",
	"venv",
	"__pycache__",
	".next",
	"coverage",
];

// Matched against the filename only (not directory segments) — these files
// still get a portal (name visible) but never have their content read, same
// treatment as oversized/binary files. `includeSecrets: true` opts back in.
export const DEFAULT_SECRET_PATTERNS = [
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"id_rsa*",
	"id_ed25519*",
	"*credentials*",
	".npmrc",
	".netrc",
];

export const DEFAULT_MAX_FILES = 2000;
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

export interface WalkOptions {
	/** Extra ignore entries, merged with DEFAULT_IGNORES. Exact segment names or `*`-glob basenames. */
	ignore?: string[];
	maxFiles?: number;
	maxFileBytes?: number;
	/** Read secret-pattern files' content normally instead of treating them as metadata-only. Default false. */
	includeSecrets?: boolean;
}

export interface WalkedFile {
	path: string;
	bytes: number;
	/** Present only when bytes <= maxFileBytes and the file isn't secret-patterned — otherwise metadata-only. */
	content?: Uint8Array;
}

export interface WalkResult {
	files: WalkedFile[];
	totalBytes: number;
	/** True if any files were dropped entirely (walk-level cap or a source's own internal cap). */
	truncated: boolean;
	/** Count of files dropped entirely (not files merely stripped of content). */
	skippedFiles: number;
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`);
}

function matchesAnySegment(path: string, patterns: readonly string[]): boolean {
	const segments = path.split("/");
	const globs = patterns
		.filter((p) => p.includes("*") || p.includes("?"))
		.map(globToRegExp);
	const exact = new Set(
		patterns.filter((p) => !p.includes("*") && !p.includes("?")),
	);
	return segments.some(
		(segment) => exact.has(segment) || globs.some((re) => re.test(segment)),
	);
}

function isIgnored(path: string, patterns: readonly string[]): boolean {
	return matchesAnySegment(path, patterns);
}

function isSecretFile(path: string, patterns: readonly string[]): boolean {
	const name = path.split("/").pop() ?? path;
	return matchesAnySegment(name, patterns);
}

export async function walk(
	source: FileSource,
	opts: WalkOptions = {},
): Promise<WalkResult> {
	const ignore = [...DEFAULT_IGNORES, ...(opts.ignore ?? [])];
	const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

	const accepted: {
		path: string;
		bytes: number;
		read(): Promise<Uint8Array>;
	}[] = [];
	for await (const entry of source.entries()) {
		if (isIgnored(entry.path, ignore)) continue;
		accepted.push(entry);
	}
	// Sort so output is stable regardless of filesystem/zip enumeration order.
	accepted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	const walkLevelDropped = Math.max(accepted.length - maxFiles, 0);
	const kept = accepted.slice(0, maxFiles);
	const sourceDropped = source.droppedEntryCount?.() ?? 0;

	let totalBytes = 0;
	const files: WalkedFile[] = [];
	for (const entry of kept) {
		totalBytes += entry.bytes;
		const withinCap = entry.bytes <= maxFileBytes;
		const isSecret =
			!opts.includeSecrets && isSecretFile(entry.path, DEFAULT_SECRET_PATTERNS);
		const content = withinCap && !isSecret ? await entry.read() : undefined;
		files.push({ path: entry.path, bytes: entry.bytes, content });
	}

	const skippedFiles = walkLevelDropped + sourceDropped;
	return { files, totalBytes, truncated: skippedFiles > 0, skippedFiles };
}
