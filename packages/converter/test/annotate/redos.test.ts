import { describe, expect, test } from "vitest";
import { deadCode } from "../../src/annotate/deadCode.js";
import { extractRelativeRefs } from "../../src/annotate/importGraph.js";
import { leakedSecret } from "../../src/annotate/leakedSecret.js";
import { locAt } from "../../src/annotate/loc.js";
import { syntaxError } from "../../src/annotate/syntaxError.js";
import {
	jsxEmptyExpressionSpans,
	lineTextAt,
	normalizeLine,
} from "../../src/annotate/syntaxTree.js";
import { todoMarker } from "../../src/annotate/todoMarker.js";
import { runOn } from "./helpers.js";

// walk.ts's per-file content cap: the most an attacker-supplied file can hold.
const FILE_CAP = 512 * 1024;
// Every payload here took seconds to minutes before its fix; linear code
// finishes in a few milliseconds, so this leaves room for a loaded CI box.
const BUDGET_MS = 750;

function fill(unit: string, bytes = FILE_CAP): string {
	return unit.repeat(Math.floor(bytes / unit.length));
}

function timed<T>(fn: () => T): { value: T; ms: number } {
	const start = performance.now();
	const value = fn();
	return { value, ms: performance.now() - start };
}

function expectFast<T>(fn: () => T): T {
	const { value, ms } = timed(fn);
	expect(ms).toBeLessThan(BUDGET_MS);
	return value;
}

const OLD_JSX_EMPTY = /\{\s*(?:\/\*[\s\S]*?\*\/\s*)*\}/g;
// The same match with each comment ending at its first `*/`, which is what
// jsxEmptyExpressionSpans implements; the old pattern additionally let a
// comment run on past a `*/` when that rescued a match.
const FIRST_TERMINATOR_JSX_EMPTY =
	/\{\s*(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)*\}/g;

function regexSpans(re: RegExp, content: string) {
	return [...content.matchAll(re)].map((m) => ({
		start: m.index,
		end: m.index + m[0].length,
	}));
}

function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

function randomString(rand: () => number, alphabet: string[], max: number) {
	const n = Math.floor(rand() * max);
	let out = "";
	for (let i = 0; i < n; i++)
		out += alphabet[Math.floor(rand() * alphabet.length)];
	return out;
}

describe("JSX empty expressions (syntaxTree.ts)", () => {
	test.each([40, 1000, 10_000])("`{` + `/**/`×%i + ` x}` stays fast", (n) => {
		const payload = `{${"/**/".repeat(n)} x}`;
		expect(expectFast(() => jsxEmptyExpressionSpans(payload))).toEqual([]);
		expect(
			expectFast(() =>
				runOn(syntaxError, "src/a.jsx", `const a = ${payload};\n`),
			),
		).toBeDefined();
	});

	test("comment chains shared by `{`s nested in an earlier comment stay linear", () => {
		const n = 20_000;
		const payload = `/*${"{/*".repeat(n)}*/${" /**/".repeat(n)} x`;
		expect(expectFast(() => jsxEmptyExpressionSpans(payload))).toEqual([]);
	});

	test("an unclosed comment after every `{` stays linear", () => {
		expect(expectFast(() => jsxEmptyExpressionSpans(fill("{/*")))).toEqual([]);
	});

	test.each([
		"<div>{/* note */}</div>",
		"<div>{}</div>",
		"<div>{ /* a */ /* b */ }</div>",
		"<div>{/** doc **/}</div>",
		"<div>{/* multi\n line */\n}</div>",
		"<div>{/* a */ x}</div>",
		"<div>{/* unclosed </div>",
		"const o = {}; const p = { a: 1 }; f({}, {/*x*/});",
		"{/* a */}{/* b */}{}",
	])("matches the old pattern on legitimate input: %j", (content) => {
		expect(jsxEmptyExpressionSpans(content)).toEqual(
			regexSpans(OLD_JSX_EMPTY, content),
		);
	});

	test("matches the first-terminator pattern on random input", () => {
		const rand = seeded(7);
		const alphabet = ["{", "}", "/", "*", " ", "\n", "x", "/*", "*/"];
		for (let i = 0; i < 5000; i++) {
			const content = randomString(rand, alphabet, 24);
			expect(jsxEmptyExpressionSpans(content)).toEqual(
				regexSpans(FIRST_TERMINATOR_JSX_EMPTY, content),
			);
		}
	});
});

describe("connection strings (leakedSecret.ts)", () => {
	test("`mysql://a:` repeated with no `@` stays fast", () => {
		expect(
			expectFast(() => runOn(leakedSecret, "src/a.ts", fill("mysql://a:"))),
		).toEqual([]);
	});

	test("a real connection string is still found", () => {
		const content = `const url = "postgres://app:Zq8vT2mLx91Rk@db.internal:5432/app";\n`;
		expect(runOn(leakedSecret, "src/db.ts", content)).toHaveLength(1);
	});
});

const OLD_MD_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const OLD_WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

describe("markdown links (importGraph.ts)", () => {
	test.each([
		["`[`", "["],
		["`[](`", "[]("],
		["`[a](`", "[a]("],
		["`[[`", "[["],
		["`[[a|`", "[[a|"],
	])("%s repeated with no closer stays fast", (_label, unit) => {
		expect(
			expectFast(() => extractRelativeRefs("notes/a.md", fill(unit))),
		).toBeDefined();
	});

	test("finds the same links as the old patterns on random input", () => {
		const rand = seeded(11);
		const alphabet = ["[", "]", "(", ")", "|", "a", ".", "/", " ", "\n", "#"];
		for (let i = 0; i < 5000; i++) {
			const content = randomString(rand, alphabet, 30);
			const expected = [
				...[...content.matchAll(OLD_MD_LINK)].map((m) =>
					normalizeLikeImportGraph(m[1] ?? ""),
				),
				...[...content.matchAll(OLD_WIKILINK)].map(
					(m) => (m[1] ?? "").trim() || null,
				),
			].filter((s): s is string => s !== null);
			expect(
				extractRelativeRefs("notes/a.md", content).map((r) => r.spec),
			).toEqual(expected);
		}
	});

	test("reports where the link target itself is", () => {
		const refs = extractRelativeRefs(
			"notes/a.md",
			"See [./b.md](./b.md) and\n[[ c ]].\n",
		);
		expect(refs.map((r) => [r.spec, r.line, r.col])).toEqual([
			["./b.md", 0, 13],
			["c", 1, 3],
		]);
	});
});

// importGraph.ts's normalizeMdTarget, restated so the fuzz test compares the
// scanners against the old regexes rather than against themselves.
function normalizeLikeImportGraph(raw: string): string | null {
	const withoutTitle = raw.trim().split(/\s+/)[0] ?? "";
	const withoutFragment = withoutTitle.split("#")[0] ?? "";
	if (withoutFragment === "") return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) return null;
	if (withoutFragment.startsWith("/")) return null;
	return withoutFragment;
}

describe("import scanning (importGraph.ts)", () => {
	test("a file of blank lines stays fast", () => {
		expect(
			expectFast(() => extractRelativeRefs("src/a.js", fill("\n"))),
		).toEqual([]);
	});

	test("`from` and a long run of dots stays fast", () => {
		expect(
			expectFast(() =>
				extractRelativeRefs("pkg/a.py", `from ${".".repeat(FILE_CAP - 5)}`),
			),
		).toEqual([]);
	});

	test("side-effect and relative Python imports still resolve", () => {
		expect(
			extractRelativeRefs("src/a.js", "\n\n  import './side.js';\n").map(
				(r) => r.spec,
			),
		).toEqual(["./side.js"]);
		expect(
			extractRelativeRefs("pkg/a.py", "from ..core.util import x\n").map(
				(r) => [r.spec, r.pyModuleSpec],
			),
		).toEqual([["..core.util.x", "..core.util"]]);
		expect(
			extractRelativeRefs("pkg/a.py", "from . import views\n").map(
				(r) => r.spec,
			),
		).toEqual([".views"]);
	});
});

describe("HTML comments (todoMarker.ts)", () => {
	test("`<!--` repeated with no `-->` stays fast", () => {
		expect(
			expectFast(() => runOn(todoMarker, "notes/a.md", fill("<!--"))),
		).toEqual([]);
	});

	test("many closed comments, each with a marker, stay fast", () => {
		const results = expectFast(() =>
			runOn(todoMarker, "notes/a.md", fill("<!-- TODO x -->\n")),
		);
		expect(results.length).toBeGreaterThan(30_000);
	});

	test("a marker in a comment is found; one outside is not", () => {
		const results = runOn(
			todoMarker,
			"notes/a.md",
			"TODO outside\n<!-- FIXME inside -->\n<!-- unclosed TODO",
		);
		expect(results.map((r) => r.rule.split(":")[1])).toEqual(["FIXME"]);
	});
});

describe("tree annotators on adversarial lines", () => {
	test("a long whitespace run before an error at end of file stays fast", () => {
		expect(
			expectFast(() =>
				runOn(syntaxError, "src/a.js", `${" ".repeat(150_000)}let`),
			),
		).toHaveLength(1);
	});

	test("a Python line of `lambda`s stays fast", () => {
		expect(
			expectFast(() =>
				runOn(syntaxError, "src/a.py", fill("lambda ", 150_000)),
			),
		).toBeDefined();
	});

	test("blank lines inside a Python function stay fast", () => {
		const content = `def f():\n${"\n".repeat(150_000)}    unused = 1\n    return 2\n`;
		expect(
			expectFast(() => runOn(deadCode, "src/a.py", content)),
		).toBeDefined();
	});
});

describe("line lookups shared by every annotator", () => {
	function naiveLoc(content: string, index: number) {
		let line = 0;
		let col = 0;
		for (let i = 0; i < Math.min(index, content.length); i++) {
			if (content[i] === "\n") {
				line++;
				col = 0;
			} else col++;
		}
		return { line, col };
	}
	function naiveLineText(content: string, index: number) {
		const start = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
		const endAt = content.indexOf("\n", index);
		return normalizeLine(
			content.slice(start, endAt === -1 ? content.length : endAt),
		);
	}

	test("locAt and lineTextAt match a scan from the start, across contents", () => {
		const rand = seeded(3);
		for (let i = 0; i < 2000; i++) {
			const content = randomString(rand, ["\n", "a", " ", "b"], 16);
			for (let index = -1; index <= content.length + 1; index++) {
				expect(locAt(content, index)).toEqual(naiveLoc(content, index));
				expect(lineTextAt(content, index)).toBe(naiveLineText(content, index));
			}
		}
	});
});
