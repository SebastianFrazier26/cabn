export interface FormatOptions {
	trimTrailingWhitespace: boolean;
	ensureFinalNewline: boolean;
	/**
	 * 0-based line indexes whose trailing whitespace is content, not noise —
	 * lines ending inside a multi-line string/template literal. Trimming
	 * those would change the program.
	 */
	protectedLines?: ReadonlySet<number>;
}

/** Markdown's two-trailing-spaces hard line break makes trailing whitespace meaningful there. */
export function defaultFormatOptions(
	language: string | undefined,
): FormatOptions {
	return {
		trimTrailingWhitespace: language !== "markdown",
		ensureFinalNewline: true,
	};
}

/**
 * Languages where indentation *is* the structure (a Python block ends where
 * its indentation does) — re-indenting from a grammar's guess could silently
 * move a statement into or out of a block, so Format only normalizes
 * whitespace for these.
 */
const INDENTATION_SENSITIVE = new Set(["python", "yaml", "markdown"]);

export function shouldReindent(language: string | undefined): boolean {
	return !INDENTATION_SENSITIVE.has(language ?? "");
}

/**
 * The file's own indent unit, so re-indenting a 4-space file doesn't turn it
 * into CodeMirror's default 2 spaces: tabs if most indented lines start with
 * one, else the most common positive step between consecutive indented
 * lines, falling back to 2 spaces for a file with no indentation to learn from.
 */
export function detectIndentUnit(text: string): string {
	let tabLines = 0;
	let spaceLines = 0;
	const steps = new Map<number, number>();
	let previous = 0;
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
		if (lead.startsWith("\t")) tabLines++;
		else if (lead.length > 0) spaceLines++;
		const width = lead.startsWith("\t") ? previous : lead.length;
		const step = width - previous;
		if (!lead.startsWith("\t") && step > 0 && step <= 8) {
			steps.set(step, (steps.get(step) ?? 0) + 1);
		}
		previous = width;
	}
	if (tabLines > spaceLines) return "\t";
	let best = 2;
	let bestCount = 0;
	for (const [step, count] of steps) {
		if (count > bestCount || (count === bestCount && step < best)) {
			best = step;
			bestCount = count;
		}
	}
	return " ".repeat(best);
}

/** The whitespace-only half of "Format document" (re-indentation is CodeMirror's job; see react/editorTools.ts). */
export function formatText(text: string, options: FormatOptions): string {
	let lines = text.split("\n");
	if (options.trimTrailingWhitespace) {
		lines = lines.map((line, i) =>
			options.protectedLines?.has(i) ? line : line.replace(/[ \t]+$/, ""),
		);
	}
	let out = lines.join("\n");
	if (options.ensureFinalNewline && out.length > 0 && !out.endsWith("\n")) {
		out += "\n";
	}
	return out;
}

export interface LineChange {
	from: number;
	to: number;
	insert: string;
}

/**
 * Minimal per-line edits turning `before` into `after`, for two texts that
 * differ only within lines (indentation, trailing whitespace) plus at most
 * extra lines appended at the end. Dispatching these instead of one
 * whole-document replacement keeps the caret, folds and undo history
 * anchored where they were — a whole-doc swap maps every position to the
 * document start.
 */
export function lineChanges(before: string, after: string): LineChange[] {
	const a = before.split("\n");
	const b = after.split("\n");
	const changes: LineChange[] = [];
	let offset = 0;
	const shared = Math.min(a.length, b.length);
	for (let i = 0; i < shared; i++) {
		const oldLine = a[i] as string;
		const newLine = b[i] as string;
		if (oldLine !== newLine) {
			const oldParts = splitWhitespace(oldLine);
			const newParts = splitWhitespace(newLine);
			if (oldParts.body === newParts.body) {
				// Indent and trailing edits stay separate so a caret sitting in the
				// line's body is never inside a replaced span.
				pushDiff(changes, offset, oldParts.indent, newParts.indent);
				pushDiff(
					changes,
					offset + oldParts.indent.length + oldParts.body.length,
					oldParts.trailing,
					newParts.trailing,
				);
			} else {
				pushDiff(changes, offset, oldLine, newLine);
			}
		}
		offset += oldLine.length + 1;
	}
	if (b.length > a.length) {
		changes.push({
			from: before.length,
			to: before.length,
			insert: `\n${b.slice(a.length).join("\n")}`,
		});
	} else if (a.length > b.length) {
		const keep = b.length === 0 ? 0 : offset - 1;
		changes.push({ from: keep, to: before.length, insert: "" });
	}
	return changes;
}

function splitWhitespace(line: string): {
	indent: string;
	body: string;
	trailing: string;
} {
	const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
	const rest = line.slice(indent.length);
	const trailing = /[ \t]*$/.exec(rest)?.[0] ?? "";
	return {
		indent,
		body: rest.slice(0, rest.length - trailing.length),
		trailing,
	};
}

/** Pushes the single common-prefix/suffix-trimmed edit turning `a` (at `offset`) into `b`, if they differ. */
function pushDiff(
	changes: LineChange[],
	offset: number,
	a: string,
	b: string,
): void {
	if (a === b) return;
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	changes.push({
		from: offset + prefix,
		to: offset + a.length - suffix,
		insert: b.slice(prefix, b.length - suffix),
	});
}

/** Applies `lineChanges` output — the pure mirror of what CodeMirror does with the same specs, used by tests. */
export function applyLineChanges(
	text: string,
	changes: readonly LineChange[],
): string {
	let out = "";
	let cursor = 0;
	for (const c of [...changes].sort((x, y) => x.from - y.from)) {
		out += text.slice(cursor, c.from) + c.insert;
		cursor = c.to;
	}
	return out + text.slice(cursor);
}

/** 0-based indexes of lines whose end-of-line falls inside one of `ranges`. */
export function linesEndingInside(
	text: string,
	ranges: ReadonlyArray<{ from: number; to: number }>,
): Set<number> {
	const result = new Set<number>();
	if (ranges.length === 0) return result;
	let line = 0;
	for (let i = 0; i <= text.length; i++) {
		if (i === text.length || text[i] === "\n") {
			for (const r of ranges) {
				if (i > r.from && i < r.to) {
					result.add(line);
					break;
				}
			}
			line++;
		}
	}
	return result;
}
