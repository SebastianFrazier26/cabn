import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldManifest } from "@cabn/world-schema";
import { zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { CabnConfigError, loadCabnConfig } from "../src/cabnConfig.js";
import { convert } from "../src/convert.js";
import { DirSource } from "../src/sources/dir.js";
import { ZipSource } from "../src/sources/zip.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");
const utf8 = (s: string) => new TextEncoder().encode(s);

function parseBundleEntry<T>(
	bundle: Map<string, Uint8Array | string>,
	name: string,
): T {
	const raw = bundle.get(name);
	if (typeof raw !== "string") throw new Error(`missing bundle entry: ${name}`);
	return JSON.parse(raw) as T;
}

// A single valid, real-looking PNG header (see test/imageDimensions.test.ts —
// only the signature + IHDR fields are ever read by the sniffer).
function fakePng(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	new DataView(bytes.buffer).setUint32(16, width);
	new DataView(bytes.buffer).setUint32(20, height);
	return bytes;
}

describe("loadCabnConfig (DirSource)", () => {
	let dir: string | undefined;

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	test("returns undefined config when no cabn.json is present", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-config-"));
		await writeFile(join(dir, "a.txt"), "hi\n");
		const { config } = await loadCabnConfig(new DirSource(dir));
		expect(config).toBeUndefined();
	});

	test("loads and validates a well-formed cabn.json", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-config-"));
		await writeFile(
			join(dir, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "README.md": { kind: "text", text: "hi" } },
				allowedEmbedOrigins: [],
			}),
		);
		const { config } = await loadCabnConfig(new DirSource(dir));
		expect(config?.previews["README.md"]).toEqual({ kind: "text", text: "hi" });
	});

	test("rejects invalid JSON with a cabn.json-prefixed message", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-config-"));
		await writeFile(join(dir, "cabn.json"), "{ not json");
		await expect(loadCabnConfig(new DirSource(dir))).rejects.toThrow(
			CabnConfigError,
		);
		await expect(loadCabnConfig(new DirSource(dir))).rejects.toThrow(
			/^cabn\.json:/,
		);
	});

	test("rejects a schema-invalid cabn.json with the offending path in the message", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-config-"));
		await writeFile(
			join(dir, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				previews: {
					"page.html": { kind: "url", url: "https://evil.example/x" },
				},
				allowedEmbedOrigins: ["https://good.example"],
			}),
		);
		await expect(loadCabnConfig(new DirSource(dir))).rejects.toThrow(
			/page\.html/,
		);
	});
});

describe("loadCabnConfig (ZipSource)", () => {
	test("reads cabn.json from a zip the same way as a directory", async () => {
		const zipped = zipSync({
			"cabn.json": utf8(
				JSON.stringify({
					cabnConfigVersion: 1,
					previews: { "a.txt": { kind: "text", text: "hi" } },
					allowedEmbedOrigins: [],
				}),
			),
			"a.txt": utf8("hello"),
		});
		const { config } = await loadCabnConfig(new ZipSource(zipped));
		expect(config?.previews["a.txt"]).toEqual({ kind: "text", text: "hi" });
	});
});

describe("convert(): cabn.json integration", () => {
	let dir: string | undefined;

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	async function makeWorld(files: Record<string, string | Uint8Array>) {
		dir = await mkdtemp(join(tmpdir(), "cabn-config-world-"));
		for (const [path, content] of Object.entries(files)) {
			const full = join(dir, path);
			await mkdir(join(full, ".."), { recursive: true });
			await writeFile(full, content);
		}
		return dir;
	}

	test("cabn.json never becomes a portal or a bundle entry itself", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: {},
				allowedEmbedOrigins: [],
			}),
			"a.txt": "hello",
		});
		const bundle = await convert(new DirSource(root), {
			name: "w",
			source: root,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.portals.map((p) => p.id)).not.toContain("cabn.json");
		expect(bundle.has("cabn.json")).toBe(false);
	});

	test("an image override copies the referenced image into bundle assets", async () => {
		const png = fakePng(64, 32);
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "README.md": { kind: "image", src: "art/logo.png" } },
				allowedEmbedOrigins: [],
			}),
			"README.md": "# hi",
			"art/logo.png": png,
		});
		const bundle = await convert(new DirSource(root), {
			name: "w",
			source: root,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		const portal = manifest.portals.find((p) => p.id === "README.md");
		expect(portal?.richPreview).toMatchObject({
			kind: "image",
			bytes: png.length,
			width: 64,
			height: 32,
		});
		const assetPath =
			portal?.richPreview?.kind === "image"
				? portal.richPreview.asset
				: undefined;
		expect(assetPath).toBeDefined();
		const assetBytes = bundle.get(assetPath as string) as Uint8Array;
		expect(Array.from(assetBytes)).toEqual(Array.from(png));

		// The overridden portal's own file content is untouched — the override
		// replaces its *preview*, not the file itself.
		expect(manifest.portals.find((p) => p.id === "art/logo.png")).toBeDefined();
	});

	test("a markdown override reads a different file than the one it previews", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "index.ts": { kind: "markdown", src: "docs/index.md" } },
				allowedEmbedOrigins: [],
			}),
			"index.ts": "export const x = 1;",
			"docs/index.md": "# Docs\n\nSee here.",
		});
		const bundle = await convert(new DirSource(root), {
			name: "w",
			source: root,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		const portal = manifest.portals.find((p) => p.id === "index.ts");
		expect(portal?.richPreview).toMatchObject({
			kind: "markdown",
			nodes: [
				{ type: "heading", level: 1, text: "Docs" },
				{ type: "paragraph", text: "See here." },
			],
		});
	});

	test("a text override needs no source file at all", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: {
					"a.bin": { kind: "text", text: "A binary blob, trust me." },
				},
				allowedEmbedOrigins: [],
			}),
			"a.bin": new Uint8Array([0, 1, 2, 0]),
		});
		const bundle = await convert(new DirSource(root), {
			name: "w",
			source: root,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.portals.find((p) => p.id === "a.bin")?.richPreview).toEqual(
			{
				kind: "text",
				text: "A binary blob, trust me.",
			},
		);
	});

	test("a url override is attached and allowedEmbedOrigins flows through to the manifest", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: {
					"portfolio.md": {
						kind: "url",
						url: "https://example.com/portfolio",
						title: "My site",
					},
				},
				allowedEmbedOrigins: ["https://example.com"],
			}),
			"portfolio.md": "# hi",
		});
		const bundle = await convert(new DirSource(root), {
			name: "w",
			source: root,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.allowedEmbedOrigins).toEqual(["https://example.com"]);
		expect(
			manifest.portals.find((p) => p.id === "portfolio.md")?.richPreview,
		).toEqual({
			kind: "url",
			url: "https://example.com/portfolio",
			title: "My site",
		});
	});

	test("rejects an override path that doesn't match any file in the world", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "does-not-exist.md": { kind: "text", text: "x" } },
				allowedEmbedOrigins: [],
			}),
			"a.txt": "hi",
		});
		await expect(
			convert(new DirSource(root), { name: "w", source: root, now: FIXED_NOW }),
		).rejects.toThrow(/does-not-exist\.md/);
	});

	test("rejects an image override whose src doesn't exist in the source", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "a.txt": { kind: "image", src: "missing.png" } },
				allowedEmbedOrigins: [],
			}),
			"a.txt": "hi",
		});
		await expect(
			convert(new DirSource(root), { name: "w", source: root, now: FIXED_NOW }),
		).rejects.toThrow(/missing\.png/);
	});

	test("rejects an image override whose src exceeds the conversion's maxFileBytes cap", async () => {
		const root = await makeWorld({
			"cabn.json": JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "a.txt": { kind: "image", src: "big.png" } },
				allowedEmbedOrigins: [],
			}),
			"a.txt": "hi",
			"big.png": new Uint8Array(2048),
		});
		await expect(
			convert(new DirSource(root), {
				name: "w",
				source: root,
				now: FIXED_NOW,
				maxFileBytes: 1024,
			}),
		).rejects.toThrow(/big\.png/);
	});

	test("rejects a cabn.json whose image src escapes the source root", async () => {
		const root = await makeWorld({ "a.txt": "hi" });
		// Written directly (not through makeWorld's writeFile+mkdir helper) since
		// the schema itself must reject this before any file lookup happens.
		await writeFile(
			join(root, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				previews: { "a.txt": { kind: "image", src: "../../etc/passwd" } },
				allowedEmbedOrigins: [],
			}),
		);
		await expect(
			convert(new DirSource(root), { name: "w", source: root, now: FIXED_NOW }),
		).rejects.toThrow(CabnConfigError);
	});
});
