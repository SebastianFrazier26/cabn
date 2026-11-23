import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findUnscopedSelectors } from "../src/build/scope.js";

describe("findUnscopedSelectors", () => {
	it("accepts selectors that start with the root class", () => {
		const css = `
			.fs-post { color: red; }
			.fs-post a, .fs-post > h1:hover { color: blue; }
			.fs-post.is-dark .chart::after { content: "}"; }
			.fs-post[data-x="a,b"] p { margin: 0; }
		`;
		expect(findUnscopedSelectors(css, ".fs-post")).toEqual({
			selectors: [],
			globals: [],
		});
	});

	it("reports selectors that do not", () => {
		const css = `
			body { margin: 0; }
			.fs-post h1, h2 { color: red; }
			.fs-poster { color: red; }
			:root { --x: 1; }
			* { box-sizing: border-box; }
		`;
		expect(findUnscopedSelectors(css, ".fs-post").selectors).toEqual([
			"body",
			"h2",
			".fs-poster",
			":root",
			"*",
		]);
	});

	it("looks inside conditional at-rules", () => {
		const css = `
			@media (max-width: 600px) {
				.fs-post { padding: 0; }
				html { font-size: 12px; }
				@supports (display: grid) { .other { display: grid; } }
			}
			@layer post { .fs-post p { margin: 0; } }
		`;
		expect(findUnscopedSelectors(css, ".fs-post").selectors).toEqual([
			"html",
			".other",
		]);
	});

	it("lists at-rules that are global by nature", () => {
		const css = `
			@import url("x.css");
			@font-face { font-family: "Scorebug"; src: url(a.woff2); }
			@keyframes fs-pulse { from { opacity: 0; } to { opacity: 1; } }
			@property --fs-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
		`;
		expect(findUnscopedSelectors(css, ".fs-post")).toEqual({
			selectors: [],
			globals: [
				'@import url("x.css")',
				'@font-face "Scorebug"',
				"@keyframes fs-pulse",
				"@property --fs-angle",
			],
		});
	});

	it("ignores comments, including ones holding braces", () => {
		const css = "/* body { } */ .fs-post { color: red; /* } h1 { */ }";
		expect(findUnscopedSelectors(css, ".fs-post").selectors).toEqual([]);
	});

	it("does not inspect rules nested inside a scoped rule", () => {
		const css = ".fs-post { h1 { color: red; } &:hover { color: blue; } }";
		expect(findUnscopedSelectors(css, ".fs-post").selectors).toEqual([]);
	});

	it("rejects a root that is not a single class", () => {
		expect(() => findUnscopedSelectors("", "fs-post")).toThrow(/class/);
		expect(() => findUnscopedSelectors("", ".a .b")).toThrow(/class/);
	});

	it("passes the package's own stylesheet", () => {
		const css = readFileSync(
			new URL("../src/styles.css", import.meta.url),
			"utf8",
		);
		const found = findUnscopedSelectors(css, ".cabn-blog");
		// Sub-blocks are named .cabn-blog-*, which the prefix check below covers.
		expect(
			found.selectors.filter((selector) => !selector.startsWith(".cabn-blog-")),
		).toEqual([]);
		expect(found.globals).toEqual(['@font-face "CabnDotGothic16"']);
	});
});
