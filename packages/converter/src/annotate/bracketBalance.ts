import { shortHash } from "../hash.js";
import { scanCode } from "./codeScanner.js";
import { langConfigFor } from "./langConfig.js";
import { normalizeLine, uniquifyRules } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

function messageFor(issue: { type: string; ch: string }): string {
	switch (issue.type) {
		case "unclosed":
			return `Unclosed "${issue.ch}" — no matching closer before end of file.`;
		case "mismatched":
			return `"${issue.ch}" is never closed with its matching bracket (a different closer appears first).`;
		case "unexpected-close":
			return `Unexpected closing "${issue.ch}" with no opener.`;
		default:
			return `Unterminated string literal starting with ${issue.ch === "`" ? "a backtick" : `"${issue.ch}"`}.`;
	}
}

/**
 * IoError/gremlin. Scoped to js/ts/py/rs/go/c-family (see langConfig.ts) — a
 * language outside that set gets no coverage, never a guessed-wrong result.
 * Known risks from codeScanner.ts's single-pass tokenizer: no nested
 * `${}` tracking inside JS template literals (brackets inside an
 * interpolation aren't matched against the surrounding code), no Rust raw
 * strings, no re-sync after the first mismatch (a mismatch pops the stack and
 * keeps scanning, which can cascade into a second reported issue that's
 * really the same root cause).
 */
export const bracketBalance: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	const config = langConfigFor(file.language);
	if (!config) return [];

	const { bracketIssues } = scanCode(content, config);
	const lines = content.split("\n");
	// Many issues often land on the same line (every unclosed opener on the
	// stack is reported at EOF; a run of unexpected closers lands wherever
	// they are) — hash each line once rather than per issue, which re-hashed
	// the same line (the whole file, on content with no newlines) from
	// scratch per issue and was quadratic in the issue count.
	const lineHashes = new Map<number, string>();
	const hashOf = (line: number): string => {
		const cached = lineHashes.get(line);
		if (cached !== undefined) return cached;
		const hash = shortHash(normalizeLine(lines[line] ?? ""), 8);
		lineHashes.set(line, hash);
		return hash;
	};
	const results: ErrorAnnotation[] = bracketIssues.map((issue) => ({
		code: "IoError",
		rule: `bracket:${issue.type}:${issue.ch}:${hashOf(issue.loc.line)}`,
		message: messageFor(issue),
		loc: issue.loc,
		species: "gremlin",
		tier: 1,
	}));
	return uniquifyRules(results);
};
