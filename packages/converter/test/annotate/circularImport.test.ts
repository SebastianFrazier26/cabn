import { describe, expect, test } from "vitest";
import { findCircularImports } from "../../src/annotate/circularImport.js";

describe("findCircularImports", () => {
	test("finds a direct two-file cycle", () => {
		const files = new Map([
			["a.ts", 'import { b } from "./b.js";\n'],
			["b.ts", 'import { a } from "./a.js";\n'],
		]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["a.ts", "b.ts"]);
	});

	test("finds a three-file cycle", () => {
		const files = new Map([
			["a.ts", 'import { b } from "./b.js";\n'],
			["b.ts", 'import { c } from "./c.js";\n'],
			["c.ts", 'import { a } from "./a.js";\n'],
		]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	test("a DAG (no back-edge) has no cycles", () => {
		const files = new Map([
			["a.ts", 'import { b } from "./b.js";\n'],
			["b.ts", 'import { c } from "./c.js";\n'],
			["c.ts", "export const c = 1;\n"],
		]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	test("a file importing itself is a self-cycle", () => {
		const files = new Map([["a.ts", 'import { a } from "./a.js";\n']]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["a.ts"]);
	});

	test("breaking one edge of a cycle resolves it", () => {
		const files = new Map([
			["a.ts", "export const a = 1;\n"],
			["b.ts", 'import { a } from "./a.js";\n'],
		]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	test("markdown links between files are not treated as import edges", () => {
		const files = new Map([
			["a.md", "[b](./b.md)\n"],
			["b.md", "[a](./a.md)\n"],
		]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	test("an import to a file outside the given set is not part of any cycle", () => {
		const files = new Map([["a.ts", 'import { x } from "./missing.js";\n']]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	test("Python relative import cycle", () => {
		const files = new Map([
			["pkg/a.py", "from .b import thing\n"],
			["pkg/b.py", "from .a import other\n"],
		]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["pkg/a.py", "pkg/b.py"]);
	});

	// Known false positive, pinned rather than fixed here — see
	// docs/testing/2026-09-29-wide-pass.md ("from . import <submodule> is
	// flagged as a self-import"). `from . import views` is ambiguous between
	// "import the submodule views" and "import the name views defined in
	// __init__.py"; resolvePyTarget (importGraph.ts) always picks the second
	// reading and resolves bare "from . import x" to the current package's
	// own __init__.py, so this ordinary sibling-module idiom (used by e.g.
	// Flask's own example apps) reads as __init__.py importing itself and
	// trips the isSelfLoop branch below. Fixing it means resolving `x`
	// against the package's real file listing, a design change reported
	// rather than made in this pass. This test pins today's behavior so a
	// fix changes it deliberately, not by accident.
	test("from . import <submodule> in __init__.py is mis-flagged as a self-cycle (known false positive)", () => {
		const files = new Map([
			["pkg/__init__.py", "from . import views\n"],
			["pkg/views.py", "x = 1\n"],
		]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["pkg/__init__.py"]);
	});
});
