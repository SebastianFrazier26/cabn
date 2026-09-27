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
});
