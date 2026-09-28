/**
 * `.seyn` sign files — see docs/SEYN.md for the format. One parser shared by
 * the converter (anchor resolution, search text), the engine (popup/reader)
 * and the owner editor's live preview, so all three agree on what a sign says.
 * Pure and dependency-free; never throws.
 */

export const SEYN_EXTENSION = ".seyn";
export const SEYN_MAX_BYTES = 16 * 1024;
export const SEYN_MAX_OFFSET = 320;
export const SEYN_MAX_TITLE_CHARS = 120;
const MAX_URL_CHARS = 2048;
const MAX_WARNINGS = 20;

export type SeynLinkTarget =
	| { kind: "url"; url: string }
	| { kind: "file"; path: string }
	/** `path` is "." for the world root. */
	| { kind: "folder"; path: string }
	| { kind: "sign"; path: string }
	| { kind: "invalid"; raw: string; reason: string };

export type SeynInline =
	| { kind: "text"; text: string }
	| { kind: "em"; text: string }
	| { kind: "link"; label: string; target: SeynLinkTarget };

export type SeynBlock =
	| { kind: "paragraph"; inlines: SeynInline[] }
	| { kind: "list"; items: SeynInline[][] };

export interface SeynOffset {
	x: number;
	y: number;
}

export interface SeynDocument {
	title: string | null;
	/** Only ever a file or folder target (or invalid) — `@near` can't point at a url or another sign. */
	near: SeynLinkTarget | null;
	offset: SeynOffset | null;
	blocks: SeynBlock[];
	/** The normalized text after the header — what the owner editor edits. */
	body: string;
	warnings: string[];
}

export interface ParseSeynOptions {
	/** World-relative path of the .seyn file itself; relative link paths resolve against its folder. Defaults to a file at the root. */
	path?: string;
}

const ESCAPABLE = new Set(["\\", "*", "[", "]", "|", "@", "#", "-"]);
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Cuts to at most `maxBytes` of UTF-8 without leaving half a code point behind. */
export function truncateUtf8(text: string, maxBytes: number): string {
	const encoded = new TextEncoder().encode(text);
	if (encoded.length <= maxBytes) return text;
	// fatal: false turns a code point cut in half into U+FFFD, then it's dropped.
	return new TextDecoder("utf-8", { fatal: false })
		.decode(encoded.slice(0, maxBytes))
		.replace(/\uFFFD$/, "");
}

/** BOM, line endings, tabs, other control characters, and the size cap — every later step can assume clean LF-separated text. */
export function normalizeSeynSource(source: string): string {
	let text = typeof source === "string" ? source : "";
	text = truncateUtf8(text, SEYN_MAX_BYTES);
	if (text.startsWith("\uFEFF")) text = text.slice(1);
	return (
		text
			.replace(/\r\n?/g, "\n")
			.replace(/\t/g, " ")
			// C0 (minus LF), DEL, C1, and the bidi overrides/isolates that can make
			// rendered text read differently from its source.
			.replace(
				// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
				/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g,
				"",
			)
	);
}

export function seynDirOf(path: string | undefined): string {
	if (!path) return ".";
	const idx = path.lastIndexOf("/");
	return idx <= 0 ? "." : path.slice(0, idx);
}

/**
 * Resolves a sign path against the sign's folder into a normalized
 * world-relative path ("." for the root, no leading or trailing slash).
 * Returns null for anything that climbs above the root or isn't a clean path.
 */
export function resolveSeynPath(
	raw: string,
	fromDir: string,
): { path: string; folder: boolean } | null {
	if (raw === "" || raw.includes("\\") || raw.includes("\0")) return null;
	const lastSegment = raw.slice(raw.lastIndexOf("/") + 1);
	const folder =
		raw.endsWith("/") || lastSegment === "." || lastSegment === "..";
	const absolute = raw.startsWith("/");
	const trimmed = raw.slice(
		absolute ? 1 : 0,
		raw.endsWith("/") ? -1 : undefined,
	);
	const segments =
		absolute || fromDir === "." || fromDir === "" ? [] : fromDir.split("/");
	if (trimmed !== "") {
		for (const segment of trimmed.split("/")) {
			if (segment === "") return null;
			if (segment === ".") continue;
			if (segment === "..") {
				if (segments.length === 0) return null;
				segments.pop();
				continue;
			}
			segments.push(segment);
		}
	}
	if (segments.length === 0) return folder ? { path: ".", folder: true } : null;
	return { path: segments.join("/"), folder };
}

export function parseSeynTarget(raw: string, fromDir: string): SeynLinkTarget {
	const target = raw.trim();
	if (target === "") return { kind: "invalid", raw, reason: "empty target" };
	if (/\s/.test(target))
		return { kind: "invalid", raw, reason: "target contains whitespace" };
	if (SCHEME_RE.test(target)) {
		if (!/^https:/i.test(target))
			return {
				kind: "invalid",
				raw,
				reason: "only https:// links are allowed",
			};
		if (target.length > MAX_URL_CHARS)
			return { kind: "invalid", raw, reason: "url too long" };
		let url: URL;
		try {
			url = new URL(target);
		} catch {
			return { kind: "invalid", raw, reason: "not a valid url" };
		}
		if (url.protocol !== "https:" || url.hostname === "")
			return { kind: "invalid", raw, reason: "not a valid https url" };
		if (url.username !== "" || url.password !== "")
			return {
				kind: "invalid",
				raw,
				reason: "urls with credentials are not allowed",
			};
		return { kind: "url", url: url.href };
	}
	const resolved = resolveSeynPath(target, fromDir);
	if (!resolved)
		return { kind: "invalid", raw, reason: "path leaves the world" };
	if (resolved.folder) return { kind: "folder", path: resolved.path };
	if (resolved.path.toLowerCase().endsWith(SEYN_EXTENSION))
		return { kind: "sign", path: resolved.path };
	return { kind: "file", path: resolved.path };
}

function defaultLabel(target: SeynLinkTarget, raw: string): string {
	switch (target.kind) {
		case "url":
			return target.url;
		case "folder":
			return target.path === "."
				? "/"
				: `${target.path.slice(target.path.lastIndexOf("/") + 1)}/`;
		case "file":
		case "sign":
			return target.path.slice(target.path.lastIndexOf("/") + 1);
		case "invalid":
			return raw.trim();
	}
}

/** Backslash escapes only — for text that can't contain emphasis or links (titles, link labels). */
function unescapeText(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		const next = text[i + 1];
		if (ch === "\\" && next !== undefined && ESCAPABLE.has(next)) {
			out += next;
			i++;
		} else out += ch;
	}
	return out;
}

function pushText(out: SeynInline[], text: string): void {
	if (text === "") return;
	const last = out[out.length - 1];
	if (last?.kind === "text") last.text += text;
	else out.push({ kind: "text", text });
}

export function parseSeynInline(text: string, fromDir: string): SeynInline[] {
	const out: SeynInline[] = [];
	let i = 0;
	let buffer = "";
	const flush = () => {
		pushText(out, buffer);
		buffer = "";
	};
	while (i < text.length) {
		const ch = text[i] as string;
		const next = text[i + 1];
		if (ch === "\\" && next !== undefined && ESCAPABLE.has(next)) {
			buffer += next;
			i += 2;
			continue;
		}
		if (ch === "[" && next === "[") {
			const close = text.indexOf("]]", i + 2);
			if (close !== -1) {
				const inner = text.slice(i + 2, close);
				const bar = inner.indexOf("|");
				const rawTarget = bar === -1 ? inner : inner.slice(0, bar);
				const rawLabel =
					bar === -1 ? "" : unescapeText(inner.slice(bar + 1)).trim();
				if (rawTarget.trim() !== "") {
					const target = parseSeynTarget(rawTarget, fromDir);
					flush();
					out.push({
						kind: "link",
						label: rawLabel || defaultLabel(target, rawTarget),
						target,
					});
					i = close + 2;
					continue;
				}
			}
		}
		if (ch === "*" && next !== undefined && next !== " " && next !== "*") {
			let close = -1;
			for (let j = i + 2; j < text.length; j++) {
				if (text[j] === "\\") {
					j++;
					continue;
				}
				if (text[j] === "*" && text[j - 1] !== " ") {
					close = j;
					break;
				}
			}
			if (close !== -1) {
				flush();
				out.push({ kind: "em", text: unescapeText(text.slice(i + 1, close)) });
				i = close + 1;
				continue;
			}
		}
		buffer += ch;
		i++;
	}
	flush();
	return out;
}

function parseHeader(
	lines: string[],
	fromDir: string,
	warn: (msg: string) => void,
): {
	near: SeynLinkTarget | null;
	offset: SeynOffset | null;
	bodyStart: number;
} {
	let near: SeynLinkTarget | null = null;
	let offset: SeynOffset | null = null;
	let i = 0;
	for (; i < lines.length; i++) {
		const line = lines[i] as string;
		if (!line.startsWith("@")) break;
		const match = /^@([A-Za-z]+)(?:\s+(.*))?$/.exec(line.trimEnd());
		const key = match?.[1]?.toLowerCase();
		const value = (match?.[2] ?? "").trim();
		if (key === "near") {
			if (near) {
				warn(`line ${i + 1}: duplicate @near ignored`);
				continue;
			}
			const target = parseSeynTarget(value, fromDir);
			if (target.kind === "url" || target.kind === "sign") {
				near = {
					kind: "invalid",
					raw: value,
					reason: "@near must be a file or a folder",
				};
			} else near = target;
			if (near.kind === "invalid") warn(`line ${i + 1}: @near ${near.reason}`);
		} else if (key === "offset") {
			if (offset) {
				warn(`line ${i + 1}: duplicate @offset ignored`);
				continue;
			}
			const parts = value.split(/\s+/);
			const [dx, dy] = parts.map((p) =>
				/^[-+]?\d{1,6}$/.test(p) ? Number(p) : Number.NaN,
			);
			if (parts.length !== 2 || !Number.isFinite(dx) || !Number.isFinite(dy)) {
				warn(`line ${i + 1}: @offset needs two whole numbers`);
				continue;
			}
			const clamp = (v: number) =>
				Math.max(-SEYN_MAX_OFFSET, Math.min(SEYN_MAX_OFFSET, v)) + 0;
			offset = { x: clamp(dx as number), y: clamp(dy as number) };
		} else {
			warn(`line ${i + 1}: unknown header line ignored`);
		}
	}
	return { near, offset, bodyStart: i };
}

export function parseSeyn(
	source: string,
	opts: ParseSeynOptions = {},
): SeynDocument {
	const warnings: string[] = [];
	const warn = (msg: string) => {
		if (warnings.length < MAX_WARNINGS) warnings.push(msg);
	};
	const raw = typeof source === "string" ? source : "";
	if (new TextEncoder().encode(raw).length > SEYN_MAX_BYTES)
		warn(`longer than ${SEYN_MAX_BYTES} bytes; the rest was cut off`);
	const text = normalizeSeynSource(raw);
	const fromDir = seynDirOf(opts.path);
	const lines = text.split("\n");
	const { near, offset, bodyStart } = parseHeader(lines, fromDir, warn);
	const bodyLines = lines.slice(bodyStart);

	let title: string | null = null;
	const blocks: SeynBlock[] = [];
	let paragraph: string[] = [];
	let list: SeynInline[][] | null = null;
	const endParagraph = () => {
		if (paragraph.length === 0) return;
		blocks.push({
			kind: "paragraph",
			inlines: parseSeynInline(paragraph.join(" "), fromDir),
		});
		paragraph = [];
	};
	const endList = () => {
		if (list) blocks.push({ kind: "list", items: list });
		list = null;
	};

	let seenContent = false;
	for (const rawLine of bodyLines) {
		const line = rawLine.trim();
		if (line === "") {
			endParagraph();
			endList();
			continue;
		}
		if (!seenContent) {
			seenContent = true;
			if (line.startsWith("#")) {
				const t = unescapeText(line.replace(/^#+/, "").trim());
				title =
					t.length > SEYN_MAX_TITLE_CHARS
						? t.slice(0, SEYN_MAX_TITLE_CHARS)
						: t;
				if (title === "") title = null;
				continue;
			}
		}
		if (line.startsWith("- ")) {
			endParagraph();
			if (!list) list = [];
			list.push(parseSeynInline(line.slice(2).trim(), fromDir));
			continue;
		}
		endList();
		paragraph.push(line);
	}
	endParagraph();
	endList();

	return { title, near, offset, blocks, body: bodyLines.join("\n"), warnings };
}

export interface SeynHeaderFields {
	/** A world-relative file path, or a folder path ending in "/" ("/" alone is the root). Written root-relative. */
	near?: string;
	offset?: SeynOffset;
}

/** The owner editor's save format: header lines from structured fields, then the body as typed. `parseSeyn(serializeSeyn(h, b))` gives back h's near/offset and b (normalized, trailing blank lines dropped, a leading "@" escaped as "\\@"). */
export function serializeSeyn(header: SeynHeaderFields, body: string): string {
	const lines: string[] = [];
	if (header.near !== undefined && header.near !== "") {
		const near = header.near.startsWith("/") ? header.near : `/${header.near}`;
		lines.push(`@near ${near}`);
	}
	if (header.offset) {
		const r = (v: number) =>
			Math.max(-SEYN_MAX_OFFSET, Math.min(SEYN_MAX_OFFSET, Math.round(v))) + 0;
		lines.push(`@offset ${r(header.offset.x)} ${r(header.offset.y)}`);
	}
	let text = normalizeSeynSource(body).replace(/\n+$/, "");
	// A body line that starts with "@" would otherwise be read back as header.
	if (text.startsWith("@")) text = `\\${text}`;
	return `${[...lines, text].join("\n")}\n`;
}

/** Plain text of a document (title + every block), for the search index. */
export function seynPlainText(doc: SeynDocument): string {
	const inlineText = (inlines: SeynInline[]) =>
		inlines.map((n) => (n.kind === "link" ? n.label : n.text)).join("");
	const parts: string[] = [];
	if (doc.title) parts.push(doc.title);
	for (const block of doc.blocks) {
		if (block.kind === "paragraph") parts.push(inlineText(block.inlines));
		else for (const item of block.items) parts.push(inlineText(item));
	}
	return parts.join("\n");
}

/** A root-relative @near value for a target path, as serializeSeyn expects. */
export function seynNearValue(target: {
	kind: "file" | "folder";
	path: string;
}): string {
	if (target.kind === "folder")
		return target.path === "." ? "/" : `/${target.path}/`;
	return `/${target.path}`;
}
