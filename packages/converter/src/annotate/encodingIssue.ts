import { locAt } from "./loc.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const REPLACEMENT_CHAR = "�";

/**
 * InvalidMode/warded-mimic. walk.ts/convert.ts decode every file with
 * `new TextDecoder("utf-8", { fatal: false })`, which turns any invalid UTF-8
 * byte sequence into U+FFFD before content ever reaches an annotator — so
 * scanning the already-decoded string for U+FFFD *is* "contains invalid
 * UTF-8", not a separate check. One monster per file (first occurrence's
 * location), not one per bad byte, to avoid a single badly-encoded file
 * spawning a mimic per character.
 */
export const encodingIssue: Annotator = (ctx) => {
	const { content } = ctx;
	if (content === undefined) return [];

	const firstIndex = content.indexOf(REPLACEMENT_CHAR);
	if (firstIndex === -1) return [];

	let count = 0;
	for (
		let i = content.indexOf(REPLACEMENT_CHAR);
		i !== -1;
		i = content.indexOf(REPLACEMENT_CHAR, i + 1)
	) {
		count++;
	}

	const loc = locAt(content, firstIndex);
	const result: ErrorAnnotation = {
		code: "InvalidMode",
		rule: "encoding:replacement-char",
		message: `Found ${count} invalid/undecodable character${count === 1 ? "" : "s"} (U+FFFD) — likely not valid UTF-8.`,
		loc,
		species: "warded-mimic",
		tier: 1,
	};
	return [result];
};
