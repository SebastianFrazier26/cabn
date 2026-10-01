import { describe, expect, test } from "vitest";
import { bracketBalance } from "../../src/annotate/bracketBalance.js";
import { codeSmell } from "../../src/annotate/codeSmell.js";
import { deadCode } from "../../src/annotate/deadCode.js";
import { resolveFindingPath } from "../../src/annotate/externalFindings.js";
import { leakedSecret } from "../../src/annotate/leakedSecret.js";
import { MAX_TREE_CHARS } from "../../src/annotate/syntaxTree.js";
import { runOn } from "./helpers.js";

// walk.ts's per-file content cap — the most an attacker-supplied file can
// hold; walk.ts's own file-count cap (DEFAULT_MAX_FILES) for the
// externalFindings case below.
const FILE_CAP = 512 * 1024;
const MAX_FILES = 2000;
// Generous on purpose: these all used to take seconds (see each test's
// comment for the measured before/after — the fixed versions finish in
// 10s-100s of milliseconds run alone), so this leaves plenty of room for a
// loaded CI box, or this suite's own parallel workers, without going flaky.
const BUDGET_MS = 1500;

function repeatExact(unit: string, targetBytes: number): string {
	return unit.repeat(Math.floor(targetBytes / unit.length));
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

// deadCode/codeSmell both anchor rule strings to a hash of the finding's
// line (syntaxTree.ts's lineAnchor); on content with no newlines at all, that
// "line" is the whole file. Hashing it fresh per finding — rather than once,
// as lineTextAt's own cache already did for the line's *text* — was
// quadratic in the finding count. Was ~5.9s (JS) / ~12.3s (Python) on this
// machine; fixed, both run in well under 100ms.
describe("deadCode stays near-linear on one very long line (syntaxTree.ts's lineAnchor)", () => {
	test("JS: `function f(){return;x;}` repeated to the tree cap", () => {
		const content = repeatExact("function f(){return;x;}", MAX_TREE_CHARS - 1);
		const results = expectFast(() => runOn(deadCode, "src/a.ts", content));
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "DeadCode")).toBe(true);
	});

	test("Python: `def f(): return; x = 1` repeated to the tree cap", () => {
		const content = repeatExact("def f(): return; x = 1\n", MAX_TREE_CHARS - 1);
		const results = expectFast(() => runOn(deadCode, "src/a.py", content));
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
	const content = repeatExact(
		"def f():\n    a = 1\n    return 0\n",
		MAX_TREE_CHARS - 1,
	);
	const results = expectFast(() => runOn(deadCode, "src/many.py", content));
	expect(results.length).toBeGreaterThan(0);
});

// Same lineAnchor root cause as deadCode above, reached through codeSmell's
// debug-leftover detection: `console.log(...)` repeated with no newlines is
// one line the length of the whole file, and every call is a separate
// finding. Was ~2.7s; fixed, under 100ms.
test("codeSmell: `console.log(1);` repeated to the tree cap stays fast", () => {
	const content = repeatExact("console.log(1);", MAX_TREE_CHARS - 1);
	const results = expectFast(() => runOn(codeSmell, "src/a.js", content));
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
		const content = repeatExact(")", FILE_CAP);
		const results = expectFast(() =>
			runOn(bracketBalance, "src/a.ts", content),
		);
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "IoError")).toBe(true);
	});

	test("a run of unclosed openers", () => {
		const content = repeatExact("(", FILE_CAP);
		const results = expectFast(() =>
			runOn(bracketBalance, "src/a.ts", content),
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
		const content = repeatExact(
			'const key = "AKIAABCDEFGHIJKLMNOP";\n',
			FILE_CAP,
		);
		const results = expectFast(() => runOn(leakedSecret, "src/a.ts", content));
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.code === "LeakedSecret")).toBe(true);
	});

	test("stays linear well past the file cap (regression guard for the O(hits²) shape)", () => {
		const unit = 'const key = "AKIAABCDEFGHIJKLMNOP";\n';
		const small = timed(() =>
			runOn(leakedSecret, "src/a.ts", repeatExact(unit, FILE_CAP)),
		).ms;
		const big = timed(() =>
			runOn(leakedSecret, "src/a.ts", repeatExact(unit, FILE_CAP * 4)),
		).ms;
		// Quadratic work would roughly 16x when the input 4xs; a generous 8x
		// bound still catches it while leaving room for timer noise.
		expect(big).toBeLessThan(Math.max(small * 8, 50));
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
		const { ms } = timed(() => {
			let misses = 0;
			for (let i = 0; i < 20_000; i++) {
				if (
					resolveFindingPath(`/unrelated/path/${i}.ts`, worldFiles) ===
					undefined
				)
					misses++;
			}
			return misses;
		});
		expect(ms).toBeLessThan(BUDGET_MS);
	});

	test("still resolves a real suffix match, and still rejects a genuine ambiguity", () => {
		const worldFiles = new Set(["src/app/index.ts", "src/lib/index.ts"]);
		expect(resolveFindingPath("/build/src/app/index.ts", worldFiles)).toBe(
			"src/app/index.ts",
		);
		expect(resolveFindingPath("/build/index.ts", worldFiles)).toBeUndefined();
	});
});
