export interface LangConfig {
	lineComment?: string;
	blockComment?: readonly [string, string];
	/** Single-character string delimiters. */
	strings: readonly string[];
	/** Multi-character string delimiters checked before `strings` (Python's triple quotes). */
	tripleStrings?: readonly string[];
}

// Scope is deliberately narrow — js/ts/py/rs/go plus the classic curly-brace
// c-family (c, cpp, csharp, java). A language missing here gets no
// bracketBalance/todoMarker coverage at all rather than a guessed-wrong
// comment syntax producing false positives/negatives.
export const LANG_CONFIGS: Readonly<Record<string, LangConfig>> = {
	javascript: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'", "`"],
	},
	typescript: {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'", "`"],
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
		strings: ['"', "`"],
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
