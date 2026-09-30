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

	// `from . import views` is ambiguous: Python reads it as "import the
	// submodule views" if pkg/views.py exists, else "import the name views
	// already defined in __init__.py". resolvePyTarget used to always pick
	// the second reading, resolving to the current package's own
	// __init__.py — a same-file self-edge that isSelfLoop then reported as a
	// genuine cycle, even though neither file imports itself. This is one of
	// the most common Python package idioms there is (deferred
	// blueprint/view registration inside a factory function), so it fired on
	// real Flask/Django-style codebases (see docs/testing/2026-09-29-wide-
	// pass.md, Bug 2). Fixed: resolvePyTarget now tries `views` as a
	// submodule first.
	test("from . import <submodule> in __init__.py resolves to the submodule, not a self-cycle", () => {
		const files = new Map([
			["pkg/__init__.py", "from . import views\n"],
			["pkg/views.py", "x = 1\n"],
		]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	test("from .pkg import <submodule> resolves to the submodule, not the package's own __init__.py", () => {
		const files = new Map([
			["app/mod.py", "from .pkg import sub\n"],
			["app/pkg/__init__.py", "x = 1\n"],
			["app/pkg/sub.py", "y = 2\n"],
		]);
		expect(findCircularImports(files)).toHaveLength(0);
	});

	// A real cycle through the same bare-import form must still be caught:
	// pkg/__init__.py imports submodule b; b, in turn, bare-imports a name
	// that isn't one of its own submodules, which correctly falls back to
	// pkg/__init__.py — a genuine two-file cycle, not a self-loop.
	test("a true cycle through from . import <submodule> still spawns the ouroboros", () => {
		const files = new Map([
			["pkg/__init__.py", "from . import b\n"],
			["pkg/b.py", "from . import a\n"],
		]);
		const results = findCircularImports(files);
		expect(results).toHaveLength(1);
		expect(results[0]?.members).toEqual(["pkg/__init__.py", "pkg/b.py"]);
	});
});
