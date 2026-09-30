import { shortHash } from "../hash.js";
import { locAt } from "./loc.js";
import { normalizeLine } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

/**
 * Corrupted/rot-sprite. Coverage is deliberately narrow:
 *  - JSON (`file.language === "json"`, i.e. .json/.jsonc): `JSON.parse`,
 *    position extracted from V8's own error message (`/position (\d+)/`,
 *    present on every Node/browser JSON.parse error message this project
 *    targets) and converted to a 0-based line/col via loc.ts.
 *  - Markdown frontmatter: if the file opens with a `---` delimiter line, a
 *    matching closing `---` (or `...`, YAML's alternate end marker) must
 *    exist somewhere after it — an unterminated block is flagged.
 * TOML and YAML (outside frontmatter) are NOT parsed — a dependency-free,
 * reasonably complete parser for either was out of scope for a lightweight
 * annotator; a config file with bad YAML/TOML syntax doesn't spawn a
 * rot-sprite in this pass.
 */
export const parseFailure: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	if (file.language === "json") return checkJson(content);
	if (file.kind === "markdown") return checkFrontmatter(content);
	return [];
};

function checkJson(content: string): ErrorAnnotation[] {
	try {
		JSON.parse(content);
		return [];
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const positionMatch = /position (\d+)/.exec(message);
		const position = positionMatch?.[1] ? Number(positionMatch[1]) : 0;
		const loc = locAt(content, position);
		return [
			{
				code: "Corrupted",
				rule: `json-parse:${shortHash(jsonErrorKey(message), 8)}`,
				message: `Invalid JSON: ${message}`,
				loc,
				species: "rot-sprite",
				tier: 1,
			},
		];
	}
}

/**
 * JSON.parse's message with every position stripped: V8 says "at position N"
 * and, since about Node 21/Chrome 117, also "(line L column C)". The build
 * (Node) and the in-browser re-check (Chrome) must agree on this key, which
 * is why both forms go rather than trusting one engine's wording.
 */
export function jsonErrorKey(message: string): string {
	return normalizeLine(
		message
			.replace(/\s*\(line \d+ column \d+\)/g, "")
			.replace(/\s*at position \d+/g, ""),
	);
}

function checkFrontmatter(content: string): ErrorAnnotation[] {
	if (!/^---\r?\n/.test(content)) return [];
	const lines = content.split(/\r?\n/);
	const closingIndex = lines
		.slice(1)
		.findIndex((line) => line === "---" || line === "...");
	if (closingIndex !== -1) return [];
	return [
		{
			code: "Corrupted",
			rule: "frontmatter-unterminated",
			message: 'Frontmatter block opens with "---" but never closes.',
			loc: { line: 0, col: 0 },
			species: "rot-sprite",
			tier: 1,
		},
	];
}
