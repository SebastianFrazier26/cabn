import type { ErrorCode } from "@cabn/world-schema";
import { z } from "zod";
import { shortHash } from "../hash.js";
import { normalizeLine } from "./syntaxTree.js";

/** Input-size cap on one results file, checked by the schemas below before any finding is looked at. */
export const MAX_FINDINGS_INPUT = 20_000;
export const MAX_EXTERNAL_PER_FILE = 10;
export const MAX_EXTERNAL_TOTAL = 500;
const MAX_MESSAGE_CHARS = 240;

export const EXTERNAL_RULE_PREFIX = "ext:";

export interface ExternalFinding {
	tool: string;
	ruleId: string;
	/** As written in the results file (absolute, file:// URI, or relative) — resolveFindingPath matches it to a world path. */
	path: string;
	/** 0-based, like every other loc in a bundle. */
	line: number;
	col: number;
	message: string;
	/** Parser-level failure (ESLint's `fatal`), i.e. the file doesn't parse. */
	fatal: boolean;
	tags: string[];
}

export class FindingsValidationError extends Error {
	constructor(readonly issues: string) {
		super(`Invalid findings file:\n${issues}`);
		this.name = "FindingsValidationError";
	}
}

const Text = (max: number) => z.string().max(max);
const LineNumber = z.number().int().nonnegative();

// Non-strict objects on purpose: SARIF and ESLint output carry many fields
// cabn doesn't read, and producers add more; only the fields used here are
// typed and bounded.
const SarifResultSchema = z.object({
	ruleId: Text(500).optional(),
	rule: z.object({ id: Text(500).optional() }).optional(),
	message: z
		.object({
			text: Text(10_000).optional(),
			markdown: Text(10_000).optional(),
		})
		.optional(),
	locations: z
		.array(
			z.object({
				physicalLocation: z
					.object({
						artifactLocation: z
							.object({ uri: Text(4096), uriBaseId: Text(200).optional() })
							.optional(),
						region: z
							.object({
								startLine: LineNumber.optional(),
								startColumn: LineNumber.optional(),
							})
							.optional(),
					})
					.optional(),
			}),
		)
		.max(50)
		.optional(),
	properties: z
		.object({ tags: z.array(Text(200)).max(50).optional() })
		.optional(),
});

export const SarifLogSchema = z.object({
	version: Text(20).optional(),
	runs: z
		.array(
			z.object({
				tool: z.object({
					driver: z.object({
						name: Text(200),
						rules: z
							.array(
								z.object({
									id: Text(500),
									properties: z
										.object({ tags: z.array(Text(200)).max(50).optional() })
										.optional(),
								}),
							)
							.max(MAX_FINDINGS_INPUT)
							.optional(),
					}),
				}),
				originalUriBaseIds: z
					.record(Text(200), z.object({ uri: Text(4096).optional() }))
					.optional(),
				results: z.array(SarifResultSchema).max(MAX_FINDINGS_INPUT).optional(),
			}),
		)
		.max(100),
});

export const EslintResultsSchema = z
	.array(
		z.object({
			filePath: Text(4096),
			messages: z
				.array(
					z.object({
						ruleId: Text(500).nullable().optional(),
						severity: z.number().int().min(0).max(2),
						message: Text(10_000),
						line: LineNumber.optional(),
						column: LineNumber.optional(),
						fatal: z.boolean().optional(),
					}),
				)
				.max(MAX_FINDINGS_INPUT),
		}),
	)
	.max(MAX_FINDINGS_INPUT);

function toZeroBased(n: number | undefined): number {
	return n && n > 0 ? n - 1 : 0;
}

function parseOrThrow<T>(schema: z.ZodType<T>, json: unknown): T {
	const result = schema.safeParse(json);
	if (!result.success) {
		throw new FindingsValidationError(z.prettifyError(result.error));
	}
	return result.data;
}

/** SARIF 2.1.0 (CodeQL, Semgrep, Ruff, gitleaks, ESLint's SARIF formatter, ...). */
export function fromSarif(json: unknown): ExternalFinding[] {
	const log = parseOrThrow(SarifLogSchema, json);
	const out: ExternalFinding[] = [];
	for (const run of log.runs) {
		const tool = run.tool.driver.name;
		const ruleTags = new Map<string, string[]>();
		for (const rule of run.tool.driver.rules ?? []) {
			ruleTags.set(rule.id, rule.properties?.tags ?? []);
		}
		for (const result of run.results ?? []) {
			const ruleId = result.ruleId ?? result.rule?.id ?? "unknown";
			const physical = result.locations?.[0]?.physicalLocation;
			const uri = physical?.artifactLocation?.uri;
			if (!uri) continue;
			const baseId = physical?.artifactLocation?.uriBaseId;
			const base = baseId ? run.originalUriBaseIds?.[baseId]?.uri : undefined;
			out.push({
				tool,
				ruleId,
				path: base && !/^[a-z]+:/i.test(uri) ? joinUri(base, uri) : uri,
				line: toZeroBased(physical?.region?.startLine),
				col: toZeroBased(physical?.region?.startColumn),
				message: result.message?.text ?? result.message?.markdown ?? "",
				fatal: false,
				tags: [
					...(ruleTags.get(ruleId) ?? []),
					...(result.properties?.tags ?? []),
				],
			});
			if (out.length >= MAX_FINDINGS_INPUT) return out;
		}
	}
	return out;
}

/** `eslint --format json` output. Severity 0 (off) entries are skipped. */
export function fromEslintJson(json: unknown): ExternalFinding[] {
	const results = parseOrThrow(EslintResultsSchema, json);
	const out: ExternalFinding[] = [];
	for (const file of results) {
		for (const m of file.messages) {
			if (m.severity === 0) continue;
			out.push({
				tool: "eslint",
				ruleId: m.ruleId ?? (m.fatal ? "parse-error" : "unknown"),
				path: file.filePath,
				line: toZeroBased(m.line),
				col: toZeroBased(m.column),
				message: m.message,
				fatal: m.fatal === true,
				tags: [],
			});
			if (out.length >= MAX_FINDINGS_INPUT) return out;
		}
	}
	return out;
}

/** Detects the format: a top-level array is ESLint JSON, an object with `runs` is SARIF. */
export function parseFindingsFile(json: unknown): ExternalFinding[] {
	if (Array.isArray(json)) return fromEslintJson(json);
	if (json && typeof json === "object" && "runs" in json)
		return fromSarif(json);
	throw new FindingsValidationError(
		"expected ESLint JSON (a top-level array) or SARIF 2.1.0 (an object with `runs`)",
	);
}

function joinUri(base: string, rel: string): string {
	return `${base.replace(/\/+$/, "")}/${rel.replace(/^\.?\/+/, "")}`;
}

function normalizePath(raw: string): string {
	let p = raw.replace(/^file:\/\//i, "").replace(/^file:/i, "");
	try {
		p = decodeURIComponent(p);
	} catch {
		// Not percent-encoded after all; use it as written.
	}
	p = p.replace(/\\/g, "/");
	if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
	return p;
}

// A findings file can carry up to MAX_FINDINGS_INPUT entries, and
// addExternalFindings calls this once per entry on the same worldFiles set;
// a findings file whose paths don't line up with the world (wrong root, a
// stale tool run) sent every one of them through the fallback below, scanning
// every world path per finding. `p.endsWith(`/${w}`)` can only hold when w's
// own last segment is p's last segment, so indexing world paths by that last
// segment turns "scan everything" into "scan the (usually tiny) handful of
// files that could possibly match" — one slot, like parseFile's cache, since
// one addExternalFindings call reuses the same worldFiles reference throughout.
let basenameIndexFiles: ReadonlySet<string> | undefined;
let basenameIndex: Map<string, string[]> | undefined;

function basenameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function basenameIndexFor(
	worldFiles: ReadonlySet<string>,
): Map<string, string[]> {
	if (basenameIndexFiles === worldFiles && basenameIndex) return basenameIndex;
	const index = new Map<string, string[]>();
	for (const w of worldFiles) {
		const base = basenameOf(w);
		const list = index.get(base);
		if (list) list.push(w);
		else index.set(base, [w]);
	}
	basenameIndexFiles = worldFiles;
	basenameIndex = index;
	return index;
}

/**
 * Maps a results-file path onto a world path: relative to `root` (the source
 * directory the tool ran in) when given, else as a relative path, else by
 * the longest world path it ends with at a `/` boundary — the last only when
 * exactly one world path matches at that length, so an ambiguous `index.ts`
 * is dropped rather than guessed.
 */
export function resolveFindingPath(
	raw: string,
	worldFiles: ReadonlySet<string>,
	root?: string,
): string | undefined {
	let p = normalizePath(raw);
	if (root) {
		const r = normalizePath(root).replace(/\/+$/, "");
		if (p.startsWith(`${r}/`)) p = p.slice(r.length + 1);
	}
	p = p.replace(/^(\.\/)+/, "");
	if (worldFiles.has(p)) return p;

	let best: string | undefined;
	let ambiguous = false;
	const candidates = basenameIndexFor(worldFiles).get(basenameOf(p)) ?? [];
	for (const w of candidates) {
		if (!p.endsWith(`/${w}`)) continue;
		if (!best || w.length > best.length) {
			best = w;
			ambiguous = false;
		} else if (w.length === best.length) {
			ambiguous = true;
		}
	}
	return ambiguous ? undefined : best;
}

const has = (pattern: RegExp, ...fields: string[]) =>
	fields.some((f) => pattern.test(f));

/**
 * Nearest built-in class for a tool's rule, by rule id, tags, and tool name
 * (ESLint core/typescript-eslint/import, Ruff/pyflakes codes, CodeQL/Semgrep
 * tags, secret scanners); anything unrecognized is an UnknownBug/shade.
 */
export function classifyFinding(f: ExternalFinding): ErrorCode {
	const id = f.ruleId.toLowerCase();
	const tags = f.tags.join(" ").toLowerCase();
	const tool = f.tool.toLowerCase();
	if (f.fatal || has(/syntax|pars(e|ing)[-_ ]?error|^e999$/, id)) {
		return "SyntaxError";
	}
	if (
		has(
			/secret|credential|password|api[-_]?key|access[-_]?token|hard[-_]?coded|private[-_]?key|cwe-798|cwe-259|cwe-321/,
			id,
			tags,
		) ||
		has(/gitleaks|trufflehog|detect-secrets/, tool)
	) {
		return "LeakedSecret";
	}
	if (has(/no-cycle|circular|cyclic/, id)) return "OuroborosError";
	if (has(/no-unresolved|module-not-found|import-error|^f821$/, id)) {
		return "NullTypeError";
	}
	if (
		has(/unused|unreachable|dead[-_]?code|no-useless|^f401$|^f841$|^f811$/, id)
	) {
		return "DeadCode";
	}
	if (has(/warning-comments|fixme|todo|^td\d+$|^fix\d+$/, id))
		return "WispNote";
	if (
		has(
			/complexity|max-depth|max-lines|max-statements|max-params|max-nested|no-console|no-debugger|no-alert|duplicat|cognitive|nesting|sonarjs|^c901$|^t20\d$|^t100$|^plr\d+$/,
			id,
		) ||
		has(/maintainability|code[-_ ]?smell/, tags)
	) {
		return "CodeSmell";
	}
	return "UnknownBug";
}

function clean(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Player-facing text; a secret finding's own message is never copied, since scanners often quote the match. */
export function externalFindingMessage(
	f: ExternalFinding,
	code: ErrorCode,
): string {
	const label = `${clean(f.tool, 40)} ${clean(f.ruleId, 80)}`;
	if (code === "LeakedSecret") {
		return `${label}: a hard-coded secret was reported on this line (value withheld). Move it to an environment variable or secret store, and rotate it.`;
	}
	return clean(
		`${label}: ${f.message || "reported a problem here"}`,
		MAX_MESSAGE_CHARS,
	);
}

function lineHash(line: string): string {
	return shortHash(normalizeLine(line), 8);
}

export function externalFindingRule(
	f: ExternalFinding,
	content: string,
): string {
	const line = content.split("\n")[f.line] ?? "";
	const safe = (s: string) => clean(s, 80).replace(/\s/g, "_");
	return `${EXTERNAL_RULE_PREFIX}${safe(f.tool)}:${safe(f.ruleId)}:${lineHash(line)}`;
}

/**
 * The engine can't re-run ESLint/CodeQL in the browser, so an external
 * finding counts as fixed once the exact line it flagged (whitespace-
 * normalized) no longer appears anywhere in the file: the player changed or
 * removed it. Coarser than a real re-run — any edit to that line wins —
 * which is the right failure for a game: never leave a monster unkillable.
 */
export function checkExternalFindingFixed(
	rule: string,
	content: string,
): boolean {
	return externalFindingLine(rule, content) === undefined;
}

/**
 * The 0-based line an external finding's flagged text is on in `content`
 * now, or undefined once it's gone (exactly when checkExternalFindingFixed
 * says fixed). A `#n` repeat takes the n-th matching line; with fewer left it
 * takes the last one, because the finding still isn't fixed.
 */
export function externalFindingLine(
	rule: string,
	content: string,
): number | undefined {
	const repeat = /#(\d+)$/.exec(rule);
	const anchor = rule.replace(/#\d+$/, "").split(":").pop() ?? "";
	const matches: number[] = [];
	content.split("\n").forEach((line, index) => {
		if (lineHash(line) === anchor) matches.push(index);
	});
	if (matches.length === 0) return undefined;
	const nth = repeat ? Number(repeat[1]) : 1;
	return matches[Math.min(nth, matches.length) - 1];
}
