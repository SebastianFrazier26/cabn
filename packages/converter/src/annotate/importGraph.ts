import { classify } from "../classify.js";
import { locAt } from "./loc.js";

export interface RelativeRef {
	spec: string;
	line: number;
	col: number;
	isMarkdownLink: boolean;
	/** `[[wikilink]]`-style only — these resolve relative to the *world root*, not the linking file's own directory (Obsidian's own default behavior, and how real vaults like this repo's notes-vault fixture actually write them: a file under daily/ links `[[projects/x]]` meaning the vault-root `projects/x.md`, not `daily/projects/x.md`). */
	isWikilink?: boolean;
	/**
	 * Python "from X import name" only, set when a specific imported name was
	 * parsed out (absent for star imports and imports whose name list didn't
	 * parse cleanly, which fall back to plain module-level resolution via
	 * `spec` alone, matching this file's pre-existing behavior for those
	 * cases). `pyModuleSpec` is `spec` with the trailing `.name` stripped
	 * back off — see resolvePyTarget's doc comment for why both readings are
	 * tried.
	 */
	pyModuleSpec?: string;
	pyImportedName?: string;
}

// Only "from"/dynamic-import/require specifiers starting with "." are relative
// — bare specifiers ("express", "os") are package/stdlib imports, out of
// scope for brokenImport/circularImport entirely.
const JS_IMPORT_PATTERNS: readonly RegExp[] = [
	/\bfrom\s+['"](\.[^'"]+)['"]/g,
	/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
	/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g,
	// Leading whitespace stops at the line end: `^\s*` under /m re-scans every
	// following blank line from each line start, quadratic on a run of them.
	/^[^\S\n\r\u2028\u2029]*import\s+['"](\.[^'"]+)['"]/gm, // side-effect import, no "from"
];

// One dot = the file's own package (its directory); each additional leading
// dot goes up one more directory — standard Python relative-import semantics.
// Group 3 (the import list) also matches a parenthesized, possibly
// multi-line list — [^)] already matches newlines, no /s flag needed.
// Group 2 can't start with a dot: `(\.+)([\w.]*)` could split a dot run any
// way, which is quadratic on `from ....` with no `import`. Greedy `\.+` took
// every dot first anyway, so the captures are unchanged.
const PY_IMPORT_PATTERN =
	/^[ \t]*from\s+(\.+)(\w[\w.]*)?\s+import\s+(\([^)]*\)|[^\n]*)/gm;

/**
 * Next index at or after `from` of any char in `chars`, -1 if none. Callers
 * scan left to right with non-decreasing `from`, so the last answer is reused
 * while `from` hasn't passed it: every `[` in a run like `[[[[...` would
 * otherwise rescan to the same `]`, quadratic in the file.
 */
function forwardFinder(
	content: string,
	chars: string,
): (from: number) => number {
	let lastFrom = Number.POSITIVE_INFINITY;
	let lastHit = -1;
	return (from) => {
		if (from >= lastFrom && (lastHit === -1 || from <= lastHit)) return lastHit;
		let i = from;
		while (i < content.length && !chars.includes(content[i] ?? "")) i++;
		lastFrom = from;
		lastHit = i < content.length ? i : -1;
		return lastHit;
	};
}

interface LinkMatch {
	index: number;
	target: string;
	targetIndex: number;
}

/**
 * `[text](target)` — exactly what `/\[[^\]]*\]\(([^)]+)\)/g` matches, as a
 * scanner: both classes run to the first `]`/`)`, so the regex never
 * backtracks into a different answer, but it does rescan from each `[`.
 */
function markdownLinks(content: string): LinkMatch[] {
	const nextClose = forwardFinder(content, "]");
	const nextParen = forwardFinder(content, ")");
	const out: LinkMatch[] = [];
	let from = 0;
	for (;;) {
		const open = content.indexOf("[", from);
		if (open === -1) break;
		const close = nextClose(open + 1);
		if (close === -1) break;
		if (content[close + 1] !== "(") {
			from = open + 1;
			continue;
		}
		const paren = nextParen(close + 2);
		if (paren === -1) break;
		if (paren === close + 2) {
			from = open + 1;
			continue;
		}
		out.push({
			index: open,
			target: content.slice(close + 2, paren),
			targetIndex: close + 2,
		});
		from = paren + 1;
	}
	return out;
}

/**
 * Obsidian/wiki-style `[[target]]` or `[[target|display text]]`, matching
 * `/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g`. No URL scheme concept exists for
 * these, so (unlike markdownLinks) every match is unconditionally treated as
 * a relative reference.
 */
function wikilinks(content: string): LinkMatch[] {
	const nextStop = forwardFinder(content, "]|");
	const nextClose = forwardFinder(content, "]");
	const out: LinkMatch[] = [];
	let from = 0;
	for (;;) {
		const open = content.indexOf("[[", from);
		if (open === -1) break;
		const stop = nextStop(open + 2);
		if (stop === -1) break;
		let close = stop;
		if (stop > open + 2 && content[stop] === "|") close = nextClose(stop + 1);
		if (close === -1) break;
		if (stop === open + 2 || content[close + 1] !== "]") {
			from = open + 1;
			continue;
		}
		out.push({
			index: open,
			target: content.slice(open + 2, stop),
			targetIndex: open + 2,
		});
		from = close + 2;
	}
	return out;
}

function extractJsRefs(content: string): RelativeRef[] {
	const seen = new Set<number>();
	const refs: RelativeRef[] = [];
	for (const pattern of JS_IMPORT_PATTERNS) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null = pattern.exec(content);
		while (match !== null) {
			const spec = match[1];
			if (spec !== undefined) {
				const specIndex = content.indexOf(spec, match.index);
				if (specIndex !== -1 && !seen.has(specIndex)) {
					seen.add(specIndex);
					const { line, col } = locAt(content, specIndex);
					refs.push({ spec, line, col, isMarkdownLink: false });
				}
			}
			match = pattern.exec(content);
		}
	}
	return refs;
}

// "as ALIAS" doesn't change which file is imported, so it's dropped; "*" and
// anything that isn't a plain identifier (a comment tacked onto the line, an
// unparsable list) is dropped too — those names fall back to plain
// module-level resolution (see extractPyRefs) rather than being guessed at.
function parseImportedNames(importList: string): string[] {
	const inner = importList.trim().replace(/^\(|\)$/g, "");
	return inner
		.split(",")
		.map(
			(entry) =>
				entry
					.trim()
					.split(/\s+as\s+/)[0]
					?.trim() ?? "",
		)
		.filter((name) => /^\w+$/.test(name));
}

function extractPyRefs(content: string): RelativeRef[] {
	const refs: RelativeRef[] = [];
	PY_IMPORT_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = PY_IMPORT_PATTERN.exec(content);
	while (match !== null) {
		const dots = match[1] ?? "";
		const modulePath = match[2] ?? "";
		const moduleSpec = dots + modulePath;
		const dotsIndex = content.indexOf(dots, match.index);
		const { line, col } = locAt(
			content,
			dotsIndex === -1 ? match.index : dotsIndex,
		);
		const names = parseImportedNames(match[3] ?? "");
		if (names.length === 0) {
			refs.push({ spec: moduleSpec, line, col, isMarkdownLink: false });
		} else {
			for (const name of names) {
				refs.push({
					spec: `${moduleSpec}${modulePath === "" ? "" : "."}${name}`,
					line,
					col,
					isMarkdownLink: false,
					pyModuleSpec: moduleSpec,
					pyImportedName: name,
				});
			}
		}
		match = PY_IMPORT_PATTERN.exec(content);
	}
	return refs;
}

// Anything with a URL scheme, a bare fragment, or a mailto: is not "relative"
// in the sense brokenImport/circularImport care about; a title
// (`[x](./y.md "title")`) and a trailing `#fragment` are stripped from the
// target itself.
function normalizeMdTarget(raw: string): string | null {
	const withoutTitle = raw.trim().split(/\s+/)[0] ?? "";
	const withoutFragment = withoutTitle.split("#")[0] ?? "";
	if (withoutFragment === "") return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) return null; // scheme (http:, mailto:, ...)
	if (withoutFragment.startsWith("/")) return null; // site-root-relative — no base to resolve against
	return withoutFragment;
}

function extractMdRefs(content: string): RelativeRef[] {
	const refs: RelativeRef[] = [];
	for (const link of markdownLinks(content)) {
		const target = normalizeMdTarget(link.target);
		if (target !== null) {
			const { line, col } = locAt(content, link.targetIndex);
			refs.push({ spec: target, line, col, isMarkdownLink: true });
		}
	}

	for (const link of wikilinks(content)) {
		const target = link.target.trim();
		if (target) {
			const lead = link.target.length - link.target.trimStart().length;
			const { line, col } = locAt(content, link.targetIndex + lead);
			refs.push({
				spec: target,
				line,
				col,
				isMarkdownLink: true,
				isWikilink: true,
			});
		}
	}
	return refs;
}

/** Language/kind is derived from `path` alone (classify with no content) so this stays symmetric between convert-time (has real content) and the engine's post-edit re-check (only has the edited string). */
export function extractRelativeRefs(
	path: string,
	content: string,
): RelativeRef[] {
	const info = classify(path);
	if (info.kind === "markdown") return extractMdRefs(content);
	if (info.language === "javascript" || info.language === "typescript") {
		return extractJsRefs(content);
	}
	if (info.language === "python") return extractPyRefs(content);
	return [];
}

function dirOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** Resolves `..`/`.` segments against a POSIX-style world path (no leading slash) — no node:path, this must stay browser-safe. */
function joinNormalize(baseDir: string, spec: string): string {
	const segments = baseDir === "" ? [] : baseDir.split("/");
	for (const part of spec.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") segments.pop();
		else segments.push(part);
	}
	return segments.join("/");
}

const JS_EXT_SWAP: Readonly<Record<string, readonly string[]>> = {
	js: ["ts", "tsx"],
	jsx: ["tsx"],
	mjs: ["mts"],
	cjs: ["cts"],
};
const JS_CANDIDATE_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;
const KNOWN_JS_EXT = new Set([
	"ts",
	"tsx",
	"mts",
	"cts",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
]);

function extOf(path: string): string | undefined {
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return dot > slash ? path.slice(dot + 1).toLowerCase() : undefined;
}

function resolveJsTarget(fromPath: string, spec: string): string[] {
	const resolved = joinNormalize(dirOf(fromPath), spec);
	const candidates = new Set<string>([resolved]);

	const ext = extOf(resolved);
	if (ext && JS_EXT_SWAP[ext]) {
		for (const swap of JS_EXT_SWAP[ext] ?? []) {
			candidates.add(`${resolved.slice(0, -(ext.length + 1))}.${swap}`);
		}
	}
	if (!ext || !KNOWN_JS_EXT.has(ext)) {
		for (const candidateExt of JS_CANDIDATE_EXTS)
			candidates.add(`${resolved}.${candidateExt}`);
		for (const candidateExt of JS_CANDIDATE_EXTS) {
			candidates.add(`${resolved}/index.${candidateExt}`);
		}
	}
	return [...candidates];
}

/**
 * `spec` is dots + dotted-module-path (e.g. "..pkg.mod" from `from ..pkg.mod
 * import x`, or "..pkg.mod.x" when the caller wants to try `x` itself as a
 * submodule — see extractPyRefs/resolveRelativeRefTarget) — resolves purely
 * mechanically, dots-to-directories-up plus dots-to-slashes, with no opinion
 * on whether the last segment is a module name or an imported symbol; the
 * caller tries both readings.
 */
function resolvePyTarget(fromPath: string, spec: string): string[] {
	const dotMatch = /^(\.+)(.*)$/.exec(spec);
	const dots = dotMatch?.[1] ?? ".";
	const modulePath = (dotMatch?.[2] ?? "").replace(/^\./, "");

	let dir = dirOf(fromPath);
	for (let i = 1; i < dots.length; i++) dir = dirOf(dir);

	const target =
		modulePath === ""
			? dir
			: joinNormalize(dir, modulePath.replace(/\./g, "/"));
	return [`${target}.py`, `${target}/__init__.py`];
}

function resolveMdLikeTarget(baseDir: string, spec: string): string[] {
	const resolved = joinNormalize(baseDir, spec);
	if (extOf(resolved)) return [resolved];
	return [
		`${resolved}.md`,
		`${resolved}.mdx`,
		`${resolved}/index.md`,
		`${resolved}/README.md`,
	];
}

/** Candidate resolved paths for `spec` as referenced from `fromPath`, in priority order — the caller checks each against the world's file-path set. */
export function resolveRelativeRefTarget(
	fromPath: string,
	ref: RelativeRef,
): string[] {
	if (ref.isWikilink) return resolveMdLikeTarget("", ref.spec);
	if (ref.isMarkdownLink) return resolveMdLikeTarget(dirOf(fromPath), ref.spec);
	const info = classify(fromPath);
	if (info.language !== "python") return resolveJsTarget(fromPath, ref.spec);
	if (ref.pyModuleSpec === undefined)
		return resolvePyTarget(fromPath, ref.spec);

	// Try `name` as a submodule of the imported-from package first (the
	// common idiom this exists for: `from . import views` where views.py is
	// a sibling file); only fall back to "name is an attribute defined
	// inside the imported-from module/package's own file" if no submodule
	// exists. For a *bare* `from . import x`/`from .. import x` (no module
	// path of its own), that fallback's target is the current package's own
	// __init__.py — and when this file *is* that __init__.py, resolving
	// there isn't really an edge to another file, just a reference to a name
	// presumably already defined earlier in this same file, so it's dropped
	// rather than reported as a same-file import cycle (the false positive
	// this two-reading split exists to fix; see circularImport.test.ts).
	const nameCandidates = resolvePyTarget(fromPath, ref.spec);
	const moduleCandidates = resolvePyTarget(fromPath, ref.pyModuleSpec);
	const isBareImport = /^\.+$/.test(ref.pyModuleSpec);
	const fallbackCandidates = isBareImport
		? moduleCandidates.filter((c) => c !== fromPath)
		: moduleCandidates;
	return [...nameCandidates, ...fallbackCandidates];
}
