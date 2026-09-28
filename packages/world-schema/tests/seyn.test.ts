import { describe, expect, test } from "vitest";
import {
	normalizeSeynSource,
	parseSeyn,
	parseSeynInline,
	parseSeynTarget,
	resolveSeynPath,
	SEYN_MAX_BYTES,
	SEYN_MAX_OFFSET,
	type SeynDocument,
	serializeSeyn,
	seynNearValue,
	seynPlainText,
} from "../src/index.js";

describe("parseSeyn: structure", () => {
	test("header, title, paragraphs and bullets", () => {
		const doc = parseSeyn(
			[
				"@near /src/index.ts",
				"@offset 60 -20",
				"# Start here",
				"",
				"This is the *entry point*.",
				"Everything hangs off it.",
				"",
				"- one",
				"- two [[/docs/|docs]]",
				"after the list",
			].join("\n"),
			{ path: "src/start.seyn" },
		);
		expect(doc.near).toEqual({ kind: "file", path: "src/index.ts" });
		expect(doc.offset).toEqual({ x: 60, y: -20 });
		expect(doc.title).toBe("Start here");
		expect(doc.warnings).toEqual([]);
		expect(doc.blocks).toEqual([
			{
				kind: "paragraph",
				inlines: [
					{ kind: "text", text: "This is the " },
					{ kind: "em", text: "entry point" },
					{ kind: "text", text: ". Everything hangs off it." },
				],
			},
			{
				kind: "list",
				items: [
					[{ kind: "text", text: "one" }],
					[
						{ kind: "text", text: "two " },
						{
							kind: "link",
							label: "docs",
							target: { kind: "folder", path: "docs" },
						},
					],
				],
			},
			{
				kind: "paragraph",
				inlines: [{ kind: "text", text: "after the list" }],
			},
		]);
	});

	test("no header, no title", () => {
		const doc = parseSeyn("just words");
		expect(doc.near).toBeNull();
		expect(doc.offset).toBeNull();
		expect(doc.title).toBeNull();
		expect(doc.body).toBe("just words");
	});

	test("only the first # line is the title; later ones are text", () => {
		const doc = parseSeyn("# One\n\n# Two");
		expect(doc.title).toBe("One");
		expect(doc.blocks).toEqual([
			{ kind: "paragraph", inlines: [{ kind: "text", text: "# Two" }] },
		]);
	});

	test("a # line that isn't first is not the title", () => {
		const doc = parseSeyn("intro\n# not a title");
		expect(doc.title).toBeNull();
	});

	test("header ends at the first non-@ line; later @ lines are text", () => {
		const doc = parseSeyn("hello\n@near /x.ts");
		expect(doc.near).toBeNull();
		expect(doc.blocks).toHaveLength(1);
	});

	test("escaped @ starts the body", () => {
		const doc = parseSeyn("\\@handle is my name");
		expect(doc.near).toBeNull();
		expect(doc.blocks[0]).toEqual({
			kind: "paragraph",
			inlines: [{ kind: "text", text: "@handle is my name" }],
		});
	});

	test("duplicate and unknown header lines warn, first wins", () => {
		const doc = parseSeyn(
			"@near /a.ts\n@near /b.ts\n@offset 1 2\n@offset 3 4\n@color red\nbody",
		);
		expect(doc.near).toEqual({ kind: "file", path: "a.ts" });
		expect(doc.offset).toEqual({ x: 1, y: 2 });
		expect(doc.warnings).toHaveLength(3);
	});

	test("offsets are clamped and must be whole numbers", () => {
		expect(parseSeyn("@offset 9999 -9999").offset).toEqual({
			x: SEYN_MAX_OFFSET,
			y: -SEYN_MAX_OFFSET,
		});
		for (const bad of [
			"@offset 1.5 2",
			"@offset 1",
			"@offset a b",
			"@offset 1 2 3",
		]) {
			const doc = parseSeyn(bad);
			expect(doc.offset, bad).toBeNull();
			expect(doc.warnings.length, bad).toBe(1);
		}
		expect(parseSeyn("@offset -0 +0").offset).toEqual({ x: 0, y: 0 });
	});

	test("@near must be a file or a folder", () => {
		for (const bad of ["https://example.com", "/other.seyn", "../../x", ""]) {
			const doc = parseSeyn(`@near ${bad}`);
			expect(doc.near?.kind, bad).toBe("invalid");
		}
		expect(parseSeyn("@near /").near).toEqual({ kind: "folder", path: "." });
		expect(parseSeyn("@near lib/", { path: "src/a.seyn" }).near).toEqual({
			kind: "folder",
			path: "src/lib",
		});
	});
});

describe("parseSeynInline", () => {
	test("emphasis edge cases", () => {
		expect(parseSeynInline("2 * 3 * 4", ".")).toEqual([
			{ kind: "text", text: "2 * 3 * 4" },
		]);
		expect(parseSeynInline("*a*", ".")).toEqual([{ kind: "em", text: "a" }]);
		expect(parseSeynInline("*unclosed", ".")).toEqual([
			{ kind: "text", text: "*unclosed" },
		]);
		expect(parseSeynInline("**", ".")).toEqual([{ kind: "text", text: "**" }]);
		expect(parseSeynInline("*a \\* b*", ".")).toEqual([
			{ kind: "em", text: "a * b" },
		]);
		expect(parseSeynInline("\\*not em\\*", ".")).toEqual([
			{ kind: "text", text: "*not em*" },
		]);
	});

	test("links", () => {
		expect(parseSeynInline("[[https://example.com/x?y=1]]", ".")).toEqual([
			{
				kind: "link",
				label: "https://example.com/x?y=1",
				target: { kind: "url", url: "https://example.com/x?y=1" },
			},
		]);
		expect(parseSeynInline("see [[ a.ts | the file ]]!", "src")).toEqual([
			{ kind: "text", text: "see " },
			{
				kind: "link",
				label: "the file",
				target: { kind: "file", path: "src/a.ts" },
			},
			{ kind: "text", text: "!" },
		]);
		expect(parseSeynInline("[[tour.seyn]]", "docs")).toEqual([
			{
				kind: "link",
				label: "tour.seyn",
				target: { kind: "sign", path: "docs/tour.seyn" },
			},
		]);
		expect(parseSeynInline("[[/]]", "docs")[0]).toMatchObject({
			label: "/",
			target: { kind: "folder", path: "." },
		});
	});

	test("broken link syntax stays literal", () => {
		expect(parseSeynInline("[[unclosed", ".")).toEqual([
			{ kind: "text", text: "[[unclosed" },
		]);
		expect(parseSeynInline("[[]]", ".")).toEqual([
			{ kind: "text", text: "[[]]" },
		]);
		expect(parseSeynInline("[[ |label]]", ".")).toEqual([
			{ kind: "text", text: "[[ |label]]" },
		]);
		expect(parseSeynInline("\\[[a.ts]]", ".")).toEqual([
			{ kind: "text", text: "[[a.ts]]" },
		]);
	});

	test("backslash before an ordinary character is literal", () => {
		expect(parseSeynInline("C:\\Users\\x", ".")).toEqual([
			{ kind: "text", text: "C:\\Users\\x" },
		]);
		expect(parseSeynInline("ends with \\", ".")).toEqual([
			{ kind: "text", text: "ends with \\" },
		]);
	});
});

describe("parseSeynTarget", () => {
	test.each([
		"javascript:alert(1)",
		"JAVASCRIPT:alert(1)",
		"http://example.com",
		"data:text/html,<b>x</b>",
		"mailto:a@b.c",
		"file:///etc/passwd",
		"vbscript:x",
	])("rejects scheme %s", (raw) => {
		expect(parseSeynTarget(raw, ".").kind).toBe("invalid");
	});

	test("https normalization and rejection", () => {
		expect(parseSeynTarget("HTTPS://Example.COM", ".")).toEqual({
			kind: "url",
			url: "https://example.com/",
		});
		expect(parseSeynTarget("https://user:pw@example.com", ".").kind).toBe(
			"invalid",
		);
		expect(parseSeynTarget("https://", ".").kind).toBe("invalid");
		expect(parseSeynTarget(`https://e.com/${"a".repeat(3000)}`, ".").kind).toBe(
			"invalid",
		);
		expect(parseSeynTarget("a b.ts", ".").kind).toBe("invalid");
	});

	test("paths resolve and never leave the root", () => {
		expect(parseSeynTarget("../lib/x.ts", "src/a")).toEqual({
			kind: "file",
			path: "src/lib/x.ts",
		});
		expect(parseSeynTarget("./", "src")).toEqual({
			kind: "folder",
			path: "src",
		});
		expect(parseSeynTarget("..", "src")).toEqual({
			kind: "folder",
			path: ".",
		});
		for (const bad of [
			"../x",
			"/../x",
			"a//b",
			"a\\b",
			"src/../../x",
			"a\0b",
		]) {
			expect(parseSeynTarget(bad, ".").kind, bad).toBe("invalid");
		}
	});

	test("resolveSeynPath", () => {
		expect(resolveSeynPath("/", "src")).toEqual({ path: ".", folder: true });
		expect(resolveSeynPath(".", ".")).toEqual({ path: ".", folder: true });
		expect(resolveSeynPath("x/", "a/b")).toEqual({
			path: "a/b/x",
			folder: true,
		});
		expect(resolveSeynPath("", ".")).toBeNull();
	});
});

describe("robustness", () => {
	test("normalization", () => {
		expect(normalizeSeynSource("\uFEFFa\r\nb\rc\td\u0007e\u202Ef")).toBe(
			"a\nb\nc de" + "f",
		);
	});

	test("oversized input is cut at the byte cap", () => {
		const doc = parseSeyn("x".repeat(SEYN_MAX_BYTES + 100));
		expect(doc.warnings.some((w) => w.includes("cut off"))).toBe(true);
		expect(doc.body.length).toBe(SEYN_MAX_BYTES);
		// A multi-byte character straddling the cap is dropped, not mangled.
		const emoji = parseSeyn(`${"x".repeat(SEYN_MAX_BYTES - 1)}🌲`);
		expect(emoji.body).toBe("x".repeat(SEYN_MAX_BYTES - 1));
	});

	test("warnings are capped", () => {
		const doc = parseSeyn(`${"@x\n".repeat(100)}body`);
		expect(doc.warnings.length).toBeLessThanOrEqual(20);
	});

	test("never throws on hostile or random input", () => {
		const samples: unknown[] = [
			undefined,
			null,
			42,
			{},
			"",
			"\n\n\n",
			"@",
			"@@@@",
			"@near",
			"@offset",
			"#",
			"# ",
			"-",
			"- ",
			"[[",
			"]]",
			"[[|]]",
			"[[a|b|c]]",
			"*",
			"\\",
			"<script>alert(1)</script>",
			"[[javascript:alert(1)|click]]",
			"\u0000\u0001\uFFFF\uD800",
		];
		let seed = 1234;
		const alphabet = "@#-*[]|\\/:. \nabcdhtps\u00e9\uD83C\uDF32";
		for (let n = 0; n < 500; n++) {
			let s = "";
			const len = n % 80;
			for (let i = 0; i < len; i++) {
				seed = (seed * 1103515245 + 12345) >>> 0;
				s += alphabet[seed % alphabet.length];
			}
			samples.push(s);
		}
		for (const sample of samples) {
			let doc: SeynDocument | undefined;
			expect(() => {
				doc = parseSeyn(sample as string, { path: "a/b.seyn" });
			}).not.toThrow();
			expect(Array.isArray(doc?.blocks)).toBe(true);
			for (const block of doc?.blocks ?? []) {
				const inlines =
					block.kind === "paragraph" ? [block.inlines] : block.items;
				for (const line of inlines)
					for (const node of line)
						if (node.kind === "link" && node.target.kind === "url")
							expect(node.target.url.startsWith("https://")).toBe(true);
			}
		}
	});
});

describe("serializeSeyn", () => {
	test("round-trips header fields and body", () => {
		const body = "# Title\n\nsome *text*\n- a bullet";
		const text = serializeSeyn(
			{
				near: seynNearValue({ kind: "file", path: "src/a.ts" }),
				offset: { x: 12.4, y: -7 },
			},
			body,
		);
		expect(text).toBe(`@near /src/a.ts\n@offset 12 -7\n${body}\n`);
		const doc = parseSeyn(text, { path: "src/a.seyn" });
		expect(doc.near).toEqual({ kind: "file", path: "src/a.ts" });
		expect(doc.offset).toEqual({ x: 12, y: -7 });
		expect(doc.body).toBe(`${body}\n`);
		expect(doc.title).toBe("Title");
	});

	test("escapes a body that starts with @ and clamps offsets", () => {
		const text = serializeSeyn({ offset: { x: 5000, y: 0 } }, "@me");
		const doc = parseSeyn(text);
		expect(doc.offset).toEqual({ x: SEYN_MAX_OFFSET, y: 0 });
		expect(seynPlainText(doc)).toBe("@me");
	});

	test("near values", () => {
		expect(seynNearValue({ kind: "folder", path: "." })).toBe("/");
		expect(seynNearValue({ kind: "folder", path: "docs" })).toBe("/docs/");
		expect(serializeSeyn({ near: "docs/" }, "x")).toBe("@near /docs/\nx\n");
	});
});
