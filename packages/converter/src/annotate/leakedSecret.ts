import { locAt } from "./loc.js";
import { isTestFile, lineAnchor, uniquifyRules } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const MAX_SECRETS_PER_FILE = 5;
// The generic "secret-ish name = high-entropy string" pattern is the one
// regex here with a lazy prefix; bounding the line length keeps a minified
// bundle line from making it quadratic.
const MAX_GENERIC_LINE_CHARS = 2000;

interface ProviderPattern {
	kind: string;
	label: string;
	pattern: RegExp;
	/** How much of the match is safe to show: the provider's fixed, public prefix. */
	shownPrefix: number;
}

// Order matters: an earlier match claims its span, so sk-ant- is never
// re-reported as a generic sk- key.
const PROVIDER_PATTERNS: readonly ProviderPattern[] = [
	{
		kind: "anthropic-key",
		label: "Anthropic API key",
		pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
		shownPrefix: 7,
	},
	{
		kind: "openai-key",
		label: "OpenAI API key",
		pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
		shownPrefix: 3,
	},
	{
		kind: "aws-access-key",
		label: "AWS access key id",
		pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
		shownPrefix: 4,
	},
	{
		kind: "github-token",
		label: "GitHub token",
		pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
		shownPrefix: 4,
	},
	{
		kind: "github-token",
		label: "GitHub fine-grained token",
		pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
		shownPrefix: 11,
	},
	{
		kind: "slack-token",
		label: "Slack token",
		pattern: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
		shownPrefix: 5,
	},
	{
		kind: "stripe-key",
		label: "Stripe live key",
		pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}/g,
		shownPrefix: 8,
	},
	{
		kind: "google-api-key",
		label: "Google API key",
		pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
		shownPrefix: 4,
	},
];

const PRIVATE_KEY_PATTERN = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----/g;
// A real key block is followed by base64 (or PEM headers); code that merely
// mentions the header (a detector, a doc) usually isn't.
const PRIVATE_KEY_BODY = /^(?:\\n|\\r|\s)*(?:Proc-Type:|[A-Za-z0-9+/=]{40,})/;

const CONNECTION_STRING_PATTERN =
	/\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver):\/\/([^\s:/@'"`]+):([^\s@'"`]+)@[^\s'"`]+/gi;

const GENERIC_ASSIGNMENT_PATTERN =
	/([A-Za-z_][\w.-]*?(?:secret|passwd|password|pwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?key|credentials?))["']?\s*(?::=|=>|[:=])\s*(["'`])([^"'`\s]{8,200})\2/gi;

// Names that merely *describe* a secret (its field name, header, env var
// name, url...) rather than hold one.
const NON_SECRET_NAME_SUFFIX =
	/(name|type|field|header|url|uri|path|file|label|id|len|length|prefix|pattern|regex|env|var|placeholder|hint|count|expiry|expires|ttl|kind)$/i;

const PLACEHOLDER_WORDS =
	/your|example|sample|dummy|placeholder|change[_-]?me|redacted|replace|insert|xxx/i;
// Template/interpolation syntax (`${X}`, `$X`, `{{x}}`, `%(x)s`, `<x>`), not
// bare `$`/`%`, which real passwords contain.
const PLACEHOLDER_SHAPES =
	/x{4,}|\*{3,}|0{6,}|\.{3}|…|\$\{|^\$[A-Za-z_]|\{\{|%\(|<[^>]*>/i;
const PLACEHOLDER_PASSWORDS = new Set([
	"password",
	"pass",
	"passwd",
	"pwd",
	"secret",
	"pw",
	"user",
	"root",
	"admin",
]);

function shannonEntropy(value: string): number {
	const counts = new Map<string, number>();
	for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	let bits = 0;
	for (const n of counts.values()) {
		const p = n / value.length;
		bits -= p * Math.log2(p);
	}
	return bits;
}

function charClasses(value: string): number {
	return (
		Number(/[a-z]/.test(value)) +
		Number(/[A-Z]/.test(value)) +
		Number(/[0-9]/.test(value)) +
		Number(/[^A-Za-z0-9]/.test(value))
	);
}

export function isPlaceholderSecret(value: string): boolean {
	if (PLACEHOLDER_WORDS.test(value) || PLACEHOLDER_SHAPES.test(value))
		return true;
	if (new Set(value).size <= 3) return true;
	return false;
}

function looksGenerated(value: string): boolean {
	if (value.includes("://") || /^[./~]/.test(value)) return false;
	const entropy = shannonEntropy(value);
	const classes = charClasses(value);
	return (
		(classes >= 3 && entropy >= 2.8) ||
		(classes >= 2 && value.length >= 20 && entropy >= 3.5)
	);
}

/** `.env.example`, `config.sample.yml`, `settings.template.json`, ... — dummy values by convention. */
function isExampleFile(path: string): boolean {
	const base = (path.split("/").pop() ?? path).toLowerCase();
	return /(^|[._-])(example|sample|template|dist|tmpl)([._-]|$)/.test(base);
}

interface Hit {
	start: number;
	end: number;
	kind: string;
	/** Already redacted — never the secret itself. */
	description: string;
}

function overlaps(hits: readonly Hit[], start: number, end: number): boolean {
	return hits.some((h) => start < h.end && end > h.start);
}

function scanProviders(content: string, hits: Hit[]): void {
	// A placeholder rejected by an earlier pattern still claims its span, or
	// "sk-ant-your-key-here..." would come back as an OpenAI key.
	const claimed: Hit[] = [...hits];
	for (const p of PROVIDER_PATTERNS) {
		for (const m of content.matchAll(p.pattern)) {
			const value = m[0];
			const start = m.index;
			const end = start + value.length;
			if (overlaps(claimed, start, end)) continue;
			claimed.push({ start, end, kind: p.kind, description: "" });
			const body = value.slice(p.shownPrefix);
			if (isPlaceholderSecret(body) || shannonEntropy(body) < 3) continue;
			hits.push({
				start,
				end,
				kind: p.kind,
				description: `${p.label} (${value.slice(0, p.shownPrefix)}…, ${value.length} chars)`,
			});
		}
	}
}

function scanPrivateKeys(content: string, hits: Hit[]): void {
	for (const m of content.matchAll(PRIVATE_KEY_PATTERN)) {
		const start = m.index;
		const end = start + m[0].length;
		if (!PRIVATE_KEY_BODY.test(content.slice(end, end + 200))) continue;
		const algo = (m[1] ?? "").trim();
		hits.push({
			start,
			end,
			kind: "private-key",
			description: `${algo ? `${algo} ` : ""}private key block`,
		});
	}
}

function scanConnectionStrings(content: string, hits: Hit[]): void {
	for (const m of content.matchAll(CONNECTION_STRING_PATTERN)) {
		const password = m[3] ?? "";
		const start = m.index;
		const end = start + m[0].length;
		if (overlaps(hits, start, end)) continue;
		if (
			PLACEHOLDER_PASSWORDS.has(password.toLowerCase()) ||
			isPlaceholderSecret(password)
		)
			continue;
		hits.push({
			start,
			end,
			kind: "connection-string",
			description: `${(m[1] ?? "").toLowerCase()}:// connection string with an embedded password (${password.length} chars)`,
		});
	}
}

function scanGenericAssignments(content: string, hits: Hit[]): void {
	let offset = 0;
	for (const line of content.split("\n")) {
		if (line.length <= MAX_GENERIC_LINE_CHARS) {
			for (const m of line.matchAll(GENERIC_ASSIGNMENT_PATTERN)) {
				const name = m[1] ?? "";
				const value = m[3] ?? "";
				const start = offset + m.index;
				const end = start + m[0].length;
				if (NON_SECRET_NAME_SUFFIX.test(name)) continue;
				if (overlaps(hits, start, end)) continue;
				if (isPlaceholderSecret(value) || !looksGenerated(value)) continue;
				hits.push({
					start,
					end,
					kind: "assignment",
					description: `secret-looking value assigned to "${name}" (${value.length} chars)`,
				});
			}
		}
		offset += line.length + 1;
	}
}

/**
 * Whether `content` holds anything the magpie would flag. `strict` also runs
 * the generic "secret-ish name = high-entropy value" pattern in test and
 * example files — git history uses it, because a withheld diff costs a
 * reader a little context while a leaked one can't be recalled.
 */
export function containsLeakedSecret(
	content: string,
	path: string,
	opts: { strict?: boolean } = {},
): boolean {
	const hits: Hit[] = [];
	scanPrivateKeys(content, hits);
	scanProviders(content, hits);
	scanConnectionStrings(content, hits);
	if (hits.length > 0) return true;
	if (opts.strict || (!isTestFile(path) && !isExampleFile(path))) {
		scanGenericAssignments(content, hits);
	}
	return hits.length > 0;
}

export interface LeakedSecretSpan {
	start: number;
	end: number;
	kind: string;
}

/**
 * Every secret span in `content`, using the identical detection the
 * `leakedSecret` annotator below runs (not `containsLeakedSecret`'s
 * `strict` mode, which also scans test/example files) — a caller that has
 * to redact rather than just detect needs this to line up exactly with
 * which files spawn a magpie in the first place. Unlike the annotator, this
 * isn't capped at `MAX_SECRETS_PER_FILE`: a 6th secret still has to be
 * redacted even though it wouldn't get its own monster.
 */
export function findLeakedSecretSpans(
	content: string,
	path: string,
): LeakedSecretSpan[] {
	const hits: Hit[] = [];
	scanPrivateKeys(content, hits);
	scanProviders(content, hits);
	scanConnectionStrings(content, hits);
	if (!isTestFile(path) && !isExampleFile(path)) {
		scanGenericAssignments(content, hits);
	}
	hits.sort((a, b) => a.start - b.start);
	return hits.map(({ start, end, kind }) => ({ start, end, kind }));
}

/**
 * LeakedSecret/magpie: hard-coded credentials. Two tiers of evidence:
 *  - well-known provider prefixes (AWS, GitHub, Anthropic, OpenAI, Slack,
 *    Stripe, Google), PEM private-key blocks, and database/queue connection
 *    strings with an inline password — checked in every readable file;
 *  - a generic "secret-ish name = high-entropy string literal" assignment —
 *    skipped in test files and example/template files, where fake
 *    credentials are the norm.
 * Every candidate value then has to survive a placeholder filter (your-,
 * example, changeme, xxxx, ***, template syntax, very few distinct
 * characters, low entropy), which is what keeps `.env.example`-style dummy
 * values and docs from spawning magpies.
 *
 * The secret never reaches the bundle through this annotator: the message
 * shows only the provider's public prefix and the length, and the rule
 * anchors on a hash of the line. (The file's own text still ships in its
 * chunk like every other readable file; secret-pattern files such as `.env`
 * and `*.pem` are never read in the first place — see walk.ts.)
 */
export const leakedSecret: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];

	const hits: Hit[] = [];
	scanPrivateKeys(content, hits);
	scanProviders(content, hits);
	scanConnectionStrings(content, hits);
	if (!isTestFile(file.path) && !isExampleFile(file.path)) {
		scanGenericAssignments(content, hits);
	}

	hits.sort((a, b) => a.start - b.start);
	const results: ErrorAnnotation[] = hits
		.slice(0, MAX_SECRETS_PER_FILE)
		.map((hit) => ({
			code: "LeakedSecret",
			rule: `secret:${hit.kind}:${lineAnchor(content, hit.start)}`,
			message: `Hard-coded ${hit.description}. Move it to an environment variable or secret store, and rotate it.`,
			loc: locAt(content, hit.start),
			species: "magpie",
			tier: 3,
		}));
	return uniquifyRules(results);
};
