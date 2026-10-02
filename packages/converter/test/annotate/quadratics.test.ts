import { describe, expect, test } from "vitest";
import { bracketBalance } from "../../src/annotate/bracketBalance.js";
import { codeSmell } from "../../src/annotate/codeSmell.js";
import { deadCode } from "../../src/annotate/deadCode.js";
import { resolveFindingPath } from "../../src/annotate/externalFindings.js";
import { leakedSecret } from "../../src/annotate/leakedSecret.js";
import { MAX_TREE_CHARS } from "../../src/annotate/syntaxTree.js";
import { runOn } from "./helpers.js";
import { expectLinear, FILE_CAP, fill } from "./linear.js";

// walk.ts's own file-count cap (DEFAULT_MAX_FILES), for the externalFindings
// case below.
const MAX_FILES = 2000;

// deadCode/codeSmell both anchor rule strings to a hash of the finding's
// line (syntaxTree.ts's lineAnchor); on content with no newlines at all, that
// "line" is the whole file. Hashing it fresh per finding — rather than once,
// as lineTextAt's own cache already did for the line's *text* — was
// quadratic in the finding count. Was ~5.9s (JS) / ~12.3s (Python) on this
// machine; fixed, both run in well under 100ms.
describe("deadCode stays near-linear on one very long line (syntaxTree.ts's lineAnchor)", () => {
	test("JS: `function f(){return;x;}` repeated to the tree cap", () => {
		const results = expectLinear(
			(n) => fill("function f(){return;x;}", n),
			(content) => runOn(deadCode, "src/a.ts", content),
			MAX_TREE_CHARS - 1,
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "DeadCode")).toBe(true);
	});

	test("Python: `def f(): return; x = 1` repeated to the tree cap", () => {
		const results = expectLinear(
			(n) => fill("def f(): return; x = 1\n", n),
			(content) => runOn(deadCode, "src/a.py", content),
			MAX_TREE_CHARS - 1,
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "DeadCode")).toBe(true);
	});
});

// Separately from lineAnchor: pythonUnusedLocals walked `body.cursor()` with
// an unbounded `.next()`, which has no notion of "stay inside this node" —
// once one function's body ran out of its own descendants, the cursor
// climbed out and kept walking every function after it. One call per
// top-level function made the whole pass O(functions²): ~12.3s on this
// machine for ~8,260 functions in 190KB. Fixed (bounded `.cursor().iterate`),
// it runs in well under 100ms regardless of how many functions precede the
// last one.
test("deadCode (Python): many top-level functions, each with an unused local, stays fast", () => {
	const results = expectLinear(
		(n) => fill("def f():\n    a = 1\n    return 0\n", n),
		(content) => runOn(deadCode, "src/many.py", content),
		MAX_TREE_CHARS - 1,
	);
	expect(results.length).toBeGreaterThan(0);
});

// Same lineAnchor root cause as deadCode above, reached through codeSmell's
// debug-leftover detection: `console.log(...)` repeated with no newlines is
// one line the length of the whole file, and every call is a separate
// finding. Was ~2.7s; fixed, under 100ms.
test("codeSmell: `console.log(1);` repeated to the tree cap stays fast", () => {
	const results = expectLinear(
		(n) => fill("console.log(1);", n),
		(content) => runOn(codeSmell, "src/a.js", content),
		MAX_TREE_CHARS - 1,
	);
	expect(results.length).toBeGreaterThan(0);
	expect(results.every((r) => r.code === "CodeSmell")).toBe(true);
});

// bracketBalance re-derived each issue's line text directly from
// `content.split("\n")` and hashed it per issue instead of per line — the
// same "rehash the same giant line per finding" shape as lineAnchor above,
// just not routed through it. An unclosed-bracket cascade with no newlines
// (every closer/opener lands on "line 0") produced one bracketIssue per
// character; was effectively unbounded (didn't finish in CI timeouts) at
// 512KB, now ~250ms.
describe("bracketBalance stays near-linear when every character is an issue", () => {
	test("a run of unmatched closers", () => {
		const results = expectLinear(
			(n) => fill(")", n),
			(content) => runOn(bracketBalance, "src/a.ts", content),
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "IoError")).toBe(true);
	});

	test("a run of unclosed openers", () => {
		const results = expectLinear(
			(n) => fill("(", n),
			(content) => runOn(bracketBalance, "src/a.ts", content),
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "IoError")).toBe(true);
	});
});

// scanProviders/scanConnectionStrings/scanGenericAssignments each claimed a
// matched span by linearly scanning every span claimed so far
// (`hits.some(...)`) — every span is pairwise disjoint by construction, so
// that scan was really an unindexed interval-membership test: O(hits) per
// match, O(hits²) overall. A dense run of distinct AWS-key-shaped values (one
// per line, no two overlapping) was ~1.6s at 2MB and climbing; the real
// 512KB cap only masked it (~0.1s there). Fixed (sorted-array binary search,
// one merge per pattern instead of one check per match), both stay linear.
describe("leakedSecret's overlap bookkeeping stays near-linear with many non-overlapping hits", () => {
	test("many distinct AWS-shaped keys, one per line, at the file cap", () => {
		const results = expectLinear(
			(n) => fill('const key = "AKIAABCDEFGHIJKLMNOP";\n', n),
			(content) => runOn(leakedSecret, "src/a.ts", content),
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "LeakedSecret")).toBe(true);
	});

	test("stays linear well past the file cap (regression guard for the O(hits²) shape)", () => {
		const results = expectLinear(
			(n) => fill('const key = "AKIAABCDEFGHIJKLMNOP";\n', n),
			(content) => runOn(leakedSecret, "src/a.ts", content),
			FILE_CAP * 4,
		);
		expect(results.length).toBeGreaterThan(0);
	});
});

// resolveFindingPath's fallback (a results-file path with no direct match)
// scanned every world path per finding — O(findings * worldFiles). A findings
// file whose paths don't line up with the world at all (wrong root, a stale
// tool run) sent every one of up to MAX_FINDINGS_INPUT entries through that
// full scan against up to DEFAULT_MAX_FILES world paths: ~4.5s on this
// machine. Fixed (indexed by each world path's last segment), well under 50ms.
describe("resolveFindingPath stays near-linear when nothing matches", () => {
	function worldFilesOf(n: number): Set<string> {
		const files = new Set<string>();
		for (let i = 0; i < n; i++) files.add(`src/dir${i}/file${i}.ts`);
		return files;
	}

	test("many findings, none matching any of many world files", () => {
		const worldFiles = worldFilesOf(MAX_FILES);
		const misses = expectLinear(
			(n) => n,
			(n) => {
				let count = 0;
				for (let i = 0; i < n; i++) {
					if (
						resolveFindingPath(`/unrelated/path/${i}.ts`, worldFiles) ===
						undefined
					)
						count++;
				}
				return count;
			},
			20_000,
		);
		expect(misses).toBe(20_000);
	});

	test("still resolves a real suffix match, and still rejects a genuine ambiguity", () => {
		const worldFiles = new Set(["src/app/index.ts", "src/lib/index.ts"]);
		expect(resolveFindingPath("/build/src/app/index.ts", worldFiles)).toBe(
			"src/app/index.ts",
		);
		expect(resolveFindingPath("/build/index.ts", worldFiles)).toBeUndefined();
	});
});
