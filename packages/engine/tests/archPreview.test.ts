import type { Portal } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import {
	type ArchDrawOp,
	DEFAULT_ARCH_METRICS,
	effectiveRichPreview,
	fitContain,
	formatBytes,
	isInView,
	layoutArchPreview,
	selectDetailPortals,
	tableColumnChars,
	tokenizeCodeLine,
	truncateToChars,
	wrapText,
} from "../src/systems/archPreview.js";

function portal(
	overrides: Partial<Pick<Portal, "richPreview">> & {
		lines?: string[];
		binary?: boolean;
		language?: string;
	} = {},
): Pick<Portal, "file" | "preview" | "richPreview"> {
	return {
		file: {
			path: "src/a.ts",
			name: "a.ts",
			kind: "code",
			bytes: 10,
			binary: overrides.binary ?? false,
			...(overrides.language !== undefined
				? { language: overrides.language }
				: {}),
		},
		preview: { lines: overrides.lines ?? ["const a = 1;"], truncated: false },
		...(overrides.richPreview ? { richPreview: overrides.richPreview } : {}),
	};
}

const textOps = (ops: ArchDrawOp[]) =>
	ops.filter((o): o is Extract<ArchDrawOp, { op: "text" }> => o.op === "text");

describe("effectiveRichPreview (fallback selection)", () => {
	test("returns the bundle's richPreview when present", () => {
		const rich = { kind: "image", asset: "assets/x.png", bytes: 3 } as const;
		expect(effectiveRichPreview(portal({ richPreview: rich }))).toBe(rich);
	});

	test("an old bundle without richPreview falls back to preview.lines as code", () => {
		expect(
			effectiveRichPreview(
				portal({ lines: ["x = 1", "y = 2"], language: "python" }),
			),
		).toEqual({
			kind: "code",
			lines: ["x = 1", "y = 2"],
			language: "python",
			truncated: false,
		});
	});

	test("an old bundle's binary file with no lines becomes the sealed chest, labelled with name and size", () => {
		expect(effectiveRichPreview(portal({ lines: [], binary: true }))).toEqual({
			kind: "sealed",
			name: "a.ts",
			bytes: 10,
		});
	});

	test("a media.json entry wins over world.json's sealed fallback", () => {
		const audio = {
			kind: "audio",
			asset: "media/0123456789abcdef.wav",
			bytes: 10,
			format: "wav",
		} as const;
		const rich = { richPreview: { kind: "sealed" } as const, binary: true };
		expect(effectiveRichPreview(portal(rich), undefined, audio)).toBe(audio);
		expect(
			effectiveRichPreview(portal(rich), undefined, {
				kind: "sealed",
				reason: "too-large",
			}),
		).toEqual({ kind: "sealed", name: "a.ts", bytes: 10, reason: "too-large" });
	});

	test("a CSV's code preview becomes a table; a quill edit re-parses the table", () => {
		const csv: Pick<Portal, "file" | "preview" | "richPreview"> = {
			...portal(),
			file: {
				...portal().file,
				path: "data/x.csv",
				name: "x.csv",
				kind: "data",
			},
			richPreview: {
				kind: "code",
				lines: ["a,b", '1,"two, three"'],
				truncated: true,
			},
		};
		expect(effectiveRichPreview(csv)).toEqual({
			kind: "table",
			rows: [
				["a", "b"],
				["1", "two, three"],
			],
			truncated: true,
		});
		expect(effectiveRichPreview(csv, "x\ty")).toEqual({
			kind: "table",
			rows: [["x\ty"]],
			truncated: false,
		});
	});

	test("a saved quill edit replaces a code preview, keeping its language", () => {
		const rich = {
			kind: "code",
			lines: ["old"],
			language: "typescript",
			truncated: false,
		} as const;
		expect(
			effectiveRichPreview(portal({ richPreview: rich }), "new\nlines"),
		).toEqual({
			kind: "code",
			lines: ["new", "lines"],
			language: "typescript",
			truncated: false,
		});
	});

	test("a saved edit replaces a text blurb but leaves image/url previews alone", () => {
		expect(
			effectiveRichPreview(
				portal({ richPreview: { kind: "text", text: "old" } }),
				"new",
			),
		).toEqual({ kind: "text", text: "new" });
		const url = { kind: "url", url: "https://example.com/" } as const;
		expect(effectiveRichPreview(portal({ richPreview: url }), "edited")).toBe(
			url,
		);
	});
});

describe("tokenizeCodeLine", () => {
	test("colours keywords, strings, numbers and trailing comments", () => {
		const tokens = tokenizeCodeLine(
			'const s = "hi" + 42; // note',
			"typescript",
		);
		expect(tokens.map((t) => t.kind)).toEqual([
			"keyword",
			"plain",
			"string",
			"plain",
			"number",
			"plain",
			"comment",
		]);
		expect(tokens.map((t) => t.text).join("")).toBe(
			'const s = "hi" + 42; // note',
		);
	});

	test("uses # comments for python and not // ", () => {
		const py = tokenizeCodeLine("x = 1  # hi", "python");
		expect(py.at(-1)).toEqual({ text: "# hi", kind: "comment" });
		const noSlash = tokenizeCodeLine("a // b", "python");
		expect(noSlash.some((t) => t.kind === "comment")).toBe(false);
	});

	test("leaves text with no known language uncoloured", () => {
		expect(tokenizeCodeLine("Imported from the old wiki", undefined)).toEqual([
			{ text: "Imported from the old wiki", kind: "plain" },
		]);
	});

	test("doesn't treat identifiers containing keywords as keywords", () => {
		expect(tokenizeCodeLine("classy", "python")).toEqual([
			{ text: "classy", kind: "plain" },
		]);
	});
});

describe("text fitting", () => {
	test("truncateToChars adds an ellipsis only when it cuts", () => {
		expect(truncateToChars("abc", 5)).toBe("abc");
		expect(truncateToChars("abcdef", 4)).toBe("abc…");
		expect(truncateToChars("abc", 0)).toBe("");
	});

	test("wrapText wraps on words and hard-breaks overlong words", () => {
		expect(wrapText("the quick brown fox", 9)).toEqual([
			"the quick",
			"brown fox",
		]);
		expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
	});

	test("fitContain letterboxes a wide image inside a tall box", () => {
		expect(fitContain(200, 100, { x: 0, y: 0, w: 100, h: 200 })).toEqual({
			x: 0,
			y: 75,
			w: 100,
			h: 50,
		});
		expect(fitContain(0, 10, { x: 1, y: 2, w: 10, h: 10 }).w).toBe(0);
	});
});

describe("layoutArchPreview", () => {
	const W = 90;
	const H = 125;
	const m = DEFAULT_ARCH_METRICS;
	const maxChars = Math.floor(
		(W - m.padding * 2) / (m.fontPx * m.charWidthRatio),
	);
	const maxLines = Math.floor(
		(H - m.padding * 2) / (m.fontPx * m.lineHeightRatio),
	);

	const inside = (ops: ArchDrawOp[]) => {
		for (const op of textOps(ops)) {
			expect(op.y).toBeGreaterThanOrEqual(0);
			expect(op.y + op.sizePx * m.lineHeightRatio).toBeLessThanOrEqual(
				H + 0.001,
			);
			expect(
				op.x + op.text.length * op.sizePx * m.charWidthRatio,
			).toBeLessThanOrEqual(W - m.padding + 0.001);
		}
	};

	test("code: never more rows than fit, never wider than the opening", () => {
		const lines = Array.from(
			{ length: 40 },
			(_, i) => `let value${i} = "${"x".repeat(60)}";`,
		);
		const ops = layoutArchPreview(
			{ kind: "code", lines, language: "typescript", truncated: true },
			W,
			H,
		);
		const rows = new Set(textOps(ops).map((o) => o.y));
		expect(rows.size).toBe(maxLines);
		inside(ops);
		expect(ops[0]).toMatchObject({ op: "fill", color: "codeBg" });
	});

	test("markdown: headings render bold and larger, content stops at the bottom", () => {
		const ops = layoutArchPreview(
			{
				kind: "markdown",
				nodes: [
					{ type: "heading", level: 1, text: "Title" },
					...Array.from({ length: 10 }, () => ({
						type: "paragraph" as const,
						text: "Lorem ipsum dolor sit amet consectetur",
					})),
				],
				truncated: false,
			},
			W,
			H,
		);
		const [first] = textOps(ops);
		expect(first).toMatchObject({
			text: "Title",
			bold: true,
			color: "heading",
		});
		expect(first?.sizePx).toBeGreaterThan(m.fontPx);
		inside(ops);
	});

	test("text: overflowing blurbs end in an ellipsis", () => {
		const ops = layoutArchPreview(
			{ kind: "text", text: "word ".repeat(200) },
			W,
			H,
		);
		const texts = textOps(ops);
		expect(texts).toHaveLength(maxLines);
		expect(texts.at(-1)?.text.endsWith("…")).toBe(true);
		expect(texts.every((t) => t.text.length <= maxChars)).toBe(true);
	});

	test("image: one image op inside the padded box", () => {
		const ops = layoutArchPreview(
			{ kind: "image", asset: "assets/p.png", bytes: 1 },
			W,
			H,
		);
		expect(ops.find((o) => o.op === "image")).toEqual({
			op: "image",
			asset: "assets/p.png",
			box: {
				x: m.padding,
				y: m.padding,
				w: W - m.padding * 2,
				h: H - m.padding * 2,
			},
		});
	});

	test("url: host + title card, with the fallback image below when given", () => {
		const bare = layoutArchPreview(
			{ kind: "url", url: "https://example.com/x", title: "Example" },
			W,
			H,
		);
		expect(textOps(bare).map((t) => t.text)).toEqual([
			"↗ example.com",
			"Example",
		]);
		expect(bare.some((o) => o.op === "image")).toBe(false);

		const withImage = layoutArchPreview(
			{
				kind: "url",
				url: "https://example.com/",
				fallbackImage: "assets/shot.png",
			},
			W,
			H,
		);
		const img = withImage.find((o) => o.op === "image");
		expect(img).toMatchObject({ asset: "assets/shot.png" });
		if (img?.op === "image")
			expect(img.box.y + img.box.h).toBeLessThanOrEqual(H);
	});

	test("sealed: draws the chest pixels and a label, no file content", () => {
		const ops = layoutArchPreview({ kind: "sealed" }, W, H);
		expect(
			ops.filter((o) => o.op === "fill" && o.color === "chestGold").length,
		).toBe(4);
		expect(textOps(ops).map((t) => t.text)).toEqual(["sealed"]);
	});

	test("sealed with info: name, size and reason fit inside the opening", () => {
		const ops = layoutArchPreview(
			{
				kind: "sealed",
				name: "an-extremely-long-recording-name-that-overflows.wav",
				bytes: 7 * 1024 * 1024,
				reason: "too-large",
			},
			W,
			H,
		);
		const texts = textOps(ops).map((t) => t.text);
		expect(texts[0]).toBe("sealed");
		expect(texts[1]?.endsWith("…")).toBe(true);
		expect(texts.slice(2)).toEqual(["7.0 MB", "too large"]);
		inside(ops);
	});

	test("audio: format/size caption plus a waveform op filling the rest", () => {
		const ops = layoutArchPreview(
			{
				kind: "audio",
				asset: "media/0123456789abcdef.mp3",
				bytes: 2048,
				format: "mp3",
			},
			W,
			H,
		);
		expect(textOps(ops)[0]?.text).toBe("♪ MP3 · 2.0 KB");
		const wave = ops.find((o) => o.op === "waveform");
		expect(wave).toMatchObject({ asset: "media/0123456789abcdef.mp3" });
		if (wave?.op === "waveform") {
			expect(wave.box.y + wave.box.h).toBeLessThanOrEqual(H);
			expect(wave.box.h).toBeGreaterThan(H / 2);
		}
		inside(ops);
	});

	test("pdf: page-1 op above a caption, both inside", () => {
		const ops = layoutArchPreview(
			{ kind: "pdf", asset: "media/0123456789abcdef.pdf", bytes: 512 },
			W,
			H,
		);
		const page = ops.find((o) => o.op === "pdfPage");
		const caption = textOps(ops)[0];
		expect(caption?.text).toBe("PDF · 512 B");
		if (page?.op === "pdfPage" && caption)
			expect(page.box.y + page.box.h).toBeLessThanOrEqual(caption.y);
		inside(ops);
	});

	test("table: header row emphasized, rows capped to fit, columns never overflow", () => {
		const rows = [
			["name", "species", "rows_harvested_this_season"],
			...Array.from({ length: 60 }, (_, i) => [`g${i}`, "tomato", `${i * 10}`]),
		];
		const ops = layoutArchPreview(
			{ kind: "table", rows, truncated: true },
			W,
			H,
		);
		const texts = textOps(ops);
		expect(texts[0]).toMatchObject({ bold: true, color: "heading" });
		expect(texts[0]?.text.startsWith("na")).toBe(true);
		const rowYs = new Set(texts.map((t) => t.y));
		expect(rowYs.size).toBeLessThan(rows.length);
		expect(
			ops.some((o) => o.op === "fill" && o.color === "tableHeaderBg"),
		).toBe(true);
		inside(ops);
	});
});

describe("tableColumnChars", () => {
	test("natural widths when they fit, proportional shrink (min 3) when not", () => {
		expect(
			tableColumnChars(
				[
					["ab", "c"],
					["abcd", ""],
				],
				20,
			),
		).toEqual([4, 1]);
		const widths = tableColumnChars(
			[["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]],
			14,
		);
		expect(
			widths.reduce((a, b) => a + b, 0) + widths.length - 1,
		).toBeLessThanOrEqual(14);
		expect(widths.every((w) => w >= 3)).toBe(true);
	});
});

describe("formatBytes", () => {
	test("B / KB / MB", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("selectDetailPortals (visibility culling)", () => {
	const view = { x: -400, y: -300, w: 800, h: 600 };
	const at = (id: string, x: number, y: number) => ({ id, pos: { x, y } });

	test("keeps only portals near the player and on screen, nearest first", () => {
		const picked = selectDetailPortals(
			[
				at("far", 900, 0),
				at("mid", 200, 0),
				at("near", 50, 0),
				at("offscreen", 0, 500),
			],
			{ x: 0, y: 0 },
			view,
			600,
			10,
		);
		expect(picked).toEqual(["near", "mid"]);
	});

	test("caps the count so texture work stays bounded", () => {
		const many = Array.from({ length: 50 }, (_, i) => at(`p${i}`, i, 0));
		expect(
			selectDetailPortals(many, { x: 0, y: 0 }, view, 600, 8),
		).toHaveLength(8);
	});

	test("view padding admits an arch whose centre is just off screen", () => {
		const edge = [at("edge", 450, 0)];
		expect(selectDetailPortals(edge, { x: 300, y: 0 }, view, 600, 5)).toEqual(
			[],
		);
		expect(
			selectDetailPortals(edge, { x: 300, y: 0 }, view, 600, 5, 100),
		).toEqual(["edge"]);
		expect(isInView({ x: 450, y: 0 }, view, 100)).toBe(true);
		expect(isInView({ x: 450, y: 0 }, view, 0)).toBe(false);
	});
});
