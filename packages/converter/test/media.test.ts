import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type MediaIndexFile,
	parseMediaIndex,
	type WorldManifest,
} from "@cabn/world-schema";
import { zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { type ConvertOptions, convert } from "../src/convert.js";
import {
	MediaBudget,
	mediaAssetPath,
	resolveMediaCaps,
	sniffMediaFormat,
} from "../src/media.js";
import { DirSource } from "../src/sources/dir.js";
import { ZipSource } from "../src/sources/zip.js";

const ascii = (s: string) => new TextEncoder().encode(s);
// DirSource hands back Buffers; compare as plain bytes.
const bytesOf = (v: Uint8Array | string | undefined) =>
	v instanceof Uint8Array ? new Uint8Array(v) : v;

function withHeader(header: number[] | Uint8Array, size = 64): Uint8Array {
	const out = new Uint8Array(Math.max(size, header.length));
	out.set(header, 0);
	// Distinct filler per size so two samples never dedupe by accident.
	for (let i = header.length; i < out.length; i++)
		out[i] = (i * 31 + size) & 0xff;
	return out;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 64) => withHeader(PNG, size);
const jpeg = (size = 64) => withHeader([0xff, 0xd8, 0xff, 0xe0], size);
const wav = (size = 64) =>
	withHeader([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")], size);
const webp = (size = 64) =>
	withHeader([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")], size);
const pdf = (size = 64) => withHeader(ascii("%PDF-1.4\n"), size);

describe("sniffMediaFormat", () => {
	test.each([
		["png", png()],
		["jpeg", jpeg()],
		["gif", withHeader(ascii("GIF89a"))],
		["webp", webp()],
		["wav", wav()],
		["ogg", withHeader(ascii("OggS"))],
		["mp3", withHeader(ascii("ID3"))],
		["mp3", withHeader([0xff, 0xfb, 0x90, 0x64])],
		["pdf", pdf()],
	])("recognizes %s", (format, bytes) => {
		expect(sniffMediaFormat(bytes)).toBe(format);
	});

	test("finds a PDF header after leading junk within the first KiB", () => {
		const bytes = new Uint8Array(600);
		bytes.set(ascii("%PDF-1.7"), 500);
		expect(sniffMediaFormat(bytes)).toBe("pdf");
	});

	test("rejects text, SVG, truncated signatures and reserved MP3 headers", () => {
		expect(sniffMediaFormat(ascii("hello world"))).toBeUndefined();
		expect(
			sniffMediaFormat(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')),
		).toBeUndefined();
		expect(sniffMediaFormat(new Uint8Array(PNG.slice(0, 4)))).toBeUndefined();
		// Sync bits set but MPEG version "reserved" (01).
		expect(
			sniffMediaFormat(new Uint8Array([0xff, 0xe8, 0, 0])),
		).toBeUndefined();
		// RIFF container that is neither WAVE nor WEBP (e.g. AVI).
		expect(
			sniffMediaFormat(
				withHeader([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")]),
			),
		).toBeUndefined();
	});
});

describe("resolveMediaCaps", () => {
	test("defaults, cabn.json override, and host ceilings in that precedence", () => {
		expect(resolveMediaCaps(undefined)).toEqual({
			maxFileBytes: 5 * 1024 * 1024,
			maxTotalBytes: 50 * 1024 * 1024,
		});
		const config = {
			cabnConfigVersion: 1 as const,
			previews: {},
			allowedEmbedOrigins: [],
			media: { maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 1000 },
		};
		expect(resolveMediaCaps(config)).toEqual({
			maxFileBytes: 10 * 1024 * 1024,
			maxTotalBytes: 1000,
		});
		expect(
			resolveMediaCaps(config, { maxFileBytes: 512, maxTotalBytes: 5000 }),
		).toEqual({ maxFileBytes: 512, maxTotalBytes: 1000 });
	});
});

describe("MediaBudget", () => {
	test("charges identical bytes once and refuses past the total", () => {
		const budget = new MediaBudget({ maxFileBytes: 100, maxTotalBytes: 150 });
		const a = png(80);
		expect(budget.admit("png", a).ok).toBe(true);
		expect(budget.admit("png", a).ok).toBe(true);
		expect(budget.totalBytes).toBe(80);
		expect(budget.admit("png", png(90))).toEqual({
			ok: false,
			reason: "budget",
		});
		expect(budget.admit("png", png(101))).toEqual({
			ok: false,
			reason: "too-large",
		});
	});

	test("an extension that disagrees with the bytes is a mismatch", () => {
		const budget = new MediaBudget({ maxFileBytes: 100, maxTotalBytes: 1000 });
		expect(budget.admit("png", jpeg())).toEqual({
			ok: false,
			reason: "type-mismatch",
		});
		expect(budget.admit("pdf", ascii("not a pdf at all"))).toEqual({
			ok: false,
			reason: "type-mismatch",
		});
	});

	test("asset paths are content-addressed with the sniffed extension", () => {
		const bytes = jpeg();
		expect(mediaAssetPath(bytes, "jpeg")).toMatch(/^media\/[0-9a-f]{16}\.jpg$/);
		expect(mediaAssetPath(bytes, "jpeg")).toBe(mediaAssetPath(jpeg(), "jpeg"));
		expect(mediaAssetPath(bytes, "jpeg")).not.toBe(
			mediaAssetPath(jpeg(65), "jpeg"),
		);
	});
});

describe("convert — media shipping", () => {
	let dir: string | undefined;
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	async function project(files: Record<string, Uint8Array | string>) {
		dir = await mkdtemp(join(tmpdir(), "cabn-media-"));
		for (const [path, content] of Object.entries(files)) {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), content);
		}
		return dir;
	}

	async function build(root: string, opts: Partial<ConvertOptions> = {}) {
		const bundle = await convert(new DirSource(root), {
			name: "m",
			source: "m",
			...opts,
		});
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		const mediaRaw = JSON.parse(
			bundle.get("media.json") as string,
		) as MediaIndexFile;
		const rich = (id: string) =>
			manifest.portals.find((p) => p.id === id)?.richPreview;
		return {
			bundle,
			manifest,
			mediaRaw,
			media: parseMediaIndex(mediaRaw),
			rich,
		};
	}

	test("images, audio and PDFs ship as media/<hash>.<ext>; world.json stays old-engine safe", async () => {
		const root = await project({
			"a.png": png(),
			"b.wav": wav(),
			"c.pdf": pdf(),
			"d.mp3": withHeader(ascii("ID3")),
		});
		const { bundle, media, rich, mediaRaw } = await build(root);

		const image = rich("a.png");
		expect(image?.kind).toBe("image");
		const imageAsset = image?.kind === "image" ? image.asset : "";
		expect(imageAsset).toMatch(/^media\/[0-9a-f]{16}\.png$/);
		expect(bytesOf(bundle.get(imageAsset))).toEqual(png());

		// Audio/PDF are sealed in world.json (what a pre-media engine sees)...
		expect(rich("b.wav")).toEqual({ kind: "sealed" });
		expect(rich("c.pdf")).toEqual({ kind: "sealed" });
		// ...and described in media.json for engines that read it.
		const audio = media.get("b.wav");
		expect(audio).toMatchObject({ kind: "audio", format: "wav", bytes: 64 });
		expect(media.get("d.mp3")).toMatchObject({ kind: "audio", format: "mp3" });
		const doc = media.get("c.pdf");
		expect(doc?.kind).toBe("pdf");
		if (audio?.kind === "audio")
			expect(bytesOf(bundle.get(audio.asset))).toEqual(wav());
		if (doc?.kind === "pdf") expect(doc.asset).toMatch(/\.pdf$/);
		expect(mediaRaw.totalBytes).toBe(64 * 4);
		expect(media.has("a.png")).toBe(false);
	});

	test("an extension/content mismatch stays sealed and ships no bytes", async () => {
		const root = await project({
			"fake.png": ascii("definitely not a png, just text\n"),
			"renamed.pdf": png(),
		});
		const { bundle, media, rich } = await build(root);
		expect(rich("fake.png")).toEqual({ kind: "sealed" });
		expect(media.get("fake.png")).toEqual({
			kind: "sealed",
			reason: "type-mismatch",
		});
		expect(media.get("renamed.pdf")).toEqual({
			kind: "sealed",
			reason: "type-mismatch",
		});
		expect([...bundle.keys()].some((k) => k.startsWith("media/"))).toBe(false);
	});

	test("over the per-file cap is sealed before reading; the world budget seals later files", async () => {
		const root = await project({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				media: { maxFileBytes: 100, maxTotalBytes: 150 },
			}),
			"a.png": png(80),
			"b.png": png(90),
			"c.png": png(200),
		});
		const { media, rich, mediaRaw } = await build(root);
		expect(rich("a.png")?.kind).toBe("image");
		expect(media.get("b.png")).toEqual({ kind: "sealed", reason: "budget" });
		expect(media.get("c.png")).toEqual({ kind: "sealed", reason: "too-large" });
		expect(mediaRaw.totalBytes).toBe(80);
	});

	test("host ceilings win over a more generous cabn.json", async () => {
		const root = await project({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				media: { maxFileBytes: 20 * 1024 * 1024 },
			}),
			"a.png": png(2000),
		});
		const { media } = await build(root, { mediaMaxFileBytes: 1000 });
		expect(media.get("a.png")).toEqual({ kind: "sealed", reason: "too-large" });
	});

	// ~1s alone, past vitest's 5s default when `pnpm -r test` loads the machine.
	test("media above walk()'s 512 KB text cap but under the media cap still ships", async () => {
		const big = png(700 * 1024);
		const root = await project({ "big.png": big });
		const { bundle, rich } = await build(root);
		const preview = rich("big.png");
		expect(preview?.kind).toBe("image");
		if (preview?.kind === "image")
			expect(bytesOf(bundle.get(preview.asset))).toEqual(big);
	}, 30_000);

	test("secret-patterned and SVG files are never shipped", async () => {
		const root = await project({
			"my-credentials.png": png(),
			"logo.svg": ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
		});
		const { bundle, media, rich } = await build(root);
		expect(media.get("my-credentials.png")).toEqual({
			kind: "sealed",
			reason: "unread",
		});
		expect(media.get("logo.svg")).toEqual({
			kind: "sealed",
			reason: "unsupported",
		});
		expect(rich("logo.svg")).toEqual({ kind: "sealed" });
		expect([...bundle.keys()].some((k) => k.startsWith("media/"))).toBe(false);
	});

	test("a zip entry the source refused to extract in full ships nothing", async () => {
		const zipped = zipSync({ "big.png": png(4096), "small.png": png(64) });
		const bundle = await convert(
			new ZipSource(zipped, { maxFileBytes: 1024 }),
			{
				name: "z",
				source: "z.zip",
			},
		);
		const media = parseMediaIndex(
			JSON.parse(bundle.get("media.json") as string),
		);
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		expect(media.get("big.png")).toEqual({ kind: "sealed", reason: "unread" });
		expect(
			manifest.portals.find((p) => p.id === "small.png")?.richPreview?.kind,
		).toBe("image");
	});
});
