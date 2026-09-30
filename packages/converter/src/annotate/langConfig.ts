export interface LangConfig {
	lineComment?: string;
	blockComment?: readonly [string, string];
	/** Single-character string delimiters. */
	strings: readonly string[];
	/** Multi-character string delimiters checked before `strings` (Python's triple quotes) — also reused for Go's backtick raw strings (a single-char delimiter, but sharing tripleStrings' escape-free, newline-tolerant handling: no interpolation, no backslash processing, closes only on the matching delimiter). */
	tripleStrings?: readonly string[];
	/** JS/TS template literal delimiter (backtick) — unlike `strings`/`tripleStrings`, this supports backslash escapes *and* `${expr}` interpolation (including nested template literals inside the expression), so it gets its own state machine in codeScanner rather than the single-char string path. */
	templateLiteralDelim?: string;
}

// Scope is deliberately narrow — js/ts/py/rs/go plus the classic curly-brace
// c-family (c, cpp, csharp, java). A language missing here gets no
// bracketBalance/todoMarker coverage at all rather than a guessed-wrong
// comment syntax producing false positives/negatives.
export const LANG_CONFIGS: Readonly<Record<string, LangConfig>> = {
	javascript: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'"],
		templateLiteralDelim: "`",
	},
	typescript: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'"],
		templateLiteralDelim: "`",
	},
	python: {
		lineComment: "#",
		strings: ['"', "'"],
		tripleStrings: ['"""', "'''"],
	},
	rust: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		// Raw strings (r"...", r#"..."#) aren't tokenized — they're rare enough
		// in practice that treating a raw string's contents as normal code
		// (still bracket-matched literally) is an acceptable false-positive
		// risk for a lightweight scanner, not a silent skip.
		strings: ['"'],
	},
	go: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"'],
		// Backtick raw strings: no escapes, no interpolation, span lines freely
		// — the same "consume until literal closer" handling tripleStrings
		// already gives Python's triple quotes, not the single-char `strings`
		// path (which would misreport a multi-line raw string as unterminated
		// at its first newline).
		tripleStrings: ["`"],
	},
	c: { lineComment: "//", blockComment: ["/*", "*/"], strings: ['"', "'"] },
	cpp: { lineComment: "//", blockComment: ["/*", "*/"], strings: ['"', "'"] },
	csharp: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'"],
	},
	java: { lineComment: "//", blockComment: ["/*", "*/"], strings: ['"', "'"] },
};

export function langConfigFor(
	language: string | undefined,
): LangConfig | undefined {
	return language ? LANG_CONFIGS[language] : undefined;
}
