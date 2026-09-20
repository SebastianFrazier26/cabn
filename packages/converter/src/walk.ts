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

export const DEFAULT_MAX_FILES = 2000;
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

export interface WalkOptions {
	/** Extra ignore entries, merged with DEFAULT_IGNORES. Exact segment names or `*`-glob basenames. */
	ignore?: string[];
	maxFiles?: number;
	maxFileBytes?: number;
}

export interface WalkedFile {
	path: string;
	bytes: number;
	/** Present only when bytes <= maxFileBytes — larger files are metadata-only. */
	content?: Uint8Array;
}

export interface WalkResult {
	files: WalkedFile[];
	totalBytes: number;
	/** True if more files existed than maxFiles allowed and some were dropped. */
	truncated: boolean;
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function isIgnored(path: string, patterns: readonly string[]): boolean {
	const segments = path.split("/");
	const globs = patterns.filter((p) => p.includes("*")).map(globToRegExp);
	const exact = new Set(patterns.filter((p) => !p.includes("*")));
	return segments.some(
		(segment) => exact.has(segment) || globs.some((re) => re.test(segment)),
	);
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

	const truncated = accepted.length > maxFiles;
	const kept = accepted.slice(0, maxFiles);

	let totalBytes = 0;
	const files: WalkedFile[] = [];
	for (const entry of kept) {
		totalBytes += entry.bytes;
		const content =
			entry.bytes <= maxFileBytes ? await entry.read() : undefined;
		files.push({ path: entry.path, bytes: entry.bytes, content });
	}

	return { files, totalBytes, truncated };
}
