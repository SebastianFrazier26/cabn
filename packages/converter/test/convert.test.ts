import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest, type WorldManifest } from "@cabn/world-schema";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import { DirSource } from "../src/sources/dir.js";
import { ZipSource } from "../src/sources/zip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function parseBundleEntry<T>(
	bundle: Map<string, Uint8Array | string>,
	name: string,
): T {
	const raw = bundle.get(name);
	if (typeof raw !== "string") throw new Error(`missing bundle entry: ${name}`);
	return JSON.parse(raw) as T;
}

describe("convert (DirSource)", () => {
	test("produces a valid, complete bundle for the mini-python fixture", async () => {
		const source = new DirSource(join(FIXTURES, "mini-python"));
		const bundle = await convert(source, {
			name: "mini-python",
			source: "mini-python",
			now: FIXED_NOW,
		});

		expect([...bundle.keys()].sort()).toEqual(
			[
				"world.json",
				"search-index.json",
				"assets.json",
				"chunks/root.json",
				"chunks/pkg.json",
				"chunks/pkg--sub.json",
				"chunks/pkg--utils.json",
			].sort(),
		);

		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(() => validateManifest(manifest)).not.toThrow();
		expect(manifest.meta.generatedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(manifest.meta.fileCount).toBe(6);
		expect(manifest.portals.map((p) => p.id).sort()).toEqual(
			[
				"README.md",
				".env",
				"main.py",
				"pkg/__init__.py",
				"pkg/sub/helper.py",
				"pkg/utils/strings.py",
			].sort(),
		);

		const helperPortal = manifest.portals.find(
			(p) => p.id === "pkg/sub/helper.py",
		);
		expect(helperPortal?.file.kind).toBe("code");
		expect(helperPortal?.file.language).toBe("python");
		expect(helperPortal?.preview.lines[0]).toContain("def greet");

		const rootChunk = parseBundleEntry<{
			files: Record<string, { content: string }>;
		}>(bundle, "chunks/root.json");
		expect(rootChunk.files["README.md"]?.content).toContain("mini-python");

		// .env matches a default secret pattern: listed (name visible), but its
		// content must never land in a chunk or the search index.
		const envPortal = manifest.portals.find((p) => p.id === ".env");
		expect(envPortal).toBeDefined();
		expect(envPortal?.preview.lines).toEqual([]);
		expect(rootChunk.files[".env"]).toBeUndefined();
		const searchIndexRaw = bundle.get("search-index.json");
		expect(typeof searchIndexRaw === "string" && searchIndexRaw).not.toContain(
			"DEBUG=true",
		);
	});

	test("includeSecrets: true restores .env content in the chunk and search index", async () => {
		const source = new DirSource(join(FIXTURES, "mini-python"));
		const bundle = await convert(source, {
			name: "mini-python",
			source: "mini-python",
			now: FIXED_NOW,
			includeSecrets: true,
		});
		const rootChunk = parseBundleEntry<{
			files: Record<string, { content: string }>;
		}>(bundle, "chunks/root.json");
		expect(rootChunk.files[".env"]?.content).toBe("DEBUG=true\n");
	});

	test("skips default-ignored dirs and treats oversized/binary files as metadata-only", async () => {
		const source = new DirSource(join(FIXTURES, "ignored-and-binary"));
		const bundle = await convert(source, {
			name: "ignored",
			source: "ignored",
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");

		const paths = manifest.portals.map((p) => p.id);
		expect(paths).not.toContain("node_modules/leftpad/index.js");
		expect(paths).not.toContain(".git/config");
		expect(paths).toContain("src/app.ts");

		const giant = manifest.portals.find((p) => p.id === "giant.txt");
		expect(giant?.preview.lines).toEqual([]);
		expect(giant?.preview.truncated).toBe(true);
		expect(giant?.file.lines).toBeUndefined();

		const image = manifest.portals.find((p) => p.id === "pixel.png");
		expect(image?.file.kind).toBe("image");
		expect(image?.file.binary).toBe(true);

		const chunk = parseBundleEntry<{ files: Record<string, unknown> }>(
			bundle,
			"chunks/root.json",
		);
		expect(chunk.files["giant.txt"]).toBeUndefined();
		expect(chunk.files["pixel.png"]).toBeUndefined();
	});

	test("splits an oversized directory into annexes end to end", async () => {
		const source = new DirSource(join(FIXTURES, "annex-heavy"));
		const bundle = await convert(source, {
			name: "annex-heavy",
			source: "annex-heavy",
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");

		const clusterIds = manifest.clusters.map((c) => c.id).sort();
		expect(clusterIds).toEqual(["many", "many__2", "root"]);
		expect(manifest.paths).toContainEqual({
			from: "many",
			to: "many__2",
			kind: "trail",
		});
		expect(bundle.has("chunks/many__2.json")).toBe(true);
	});

	test("full bundle snapshot for mini-python", async () => {
		const source = new DirSource(join(FIXTURES, "mini-python"));
		const bundle = await convert(source, {
			name: "mini-python",
			source: "mini-python",
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest).toMatchSnapshot();
	});
});

describe("convert (ZipSource)", () => {
	test("produces the same world.json as the equivalent directory (modulo nothing — generatedAt is fixed)", async () => {
		const zipBytes = await readFile(join(FIXTURES, "mini-python.zip"));
		const dirBundle = await convert(
			new DirSource(join(FIXTURES, "mini-python")),
			{
				name: "mini-python",
				source: "mini-python",
				now: FIXED_NOW,
			},
		);
		const zipBundle = await convert(new ZipSource(zipBytes), {
			name: "mini-python",
			source: "mini-python.zip",
			now: FIXED_NOW,
		});

		const dirManifest = parseBundleEntry<WorldManifest>(
			dirBundle,
			"world.json",
		);
		const zipManifest = parseBundleEntry<WorldManifest>(
			zipBundle,
			"world.json",
		);

		// meta.source legitimately differs (dir path vs zip filename); everything
		// else about the world's shape must match exactly.
		const { meta: dirMeta, ...dirRest } = dirManifest;
		const { meta: zipMeta, ...zipRest } = zipManifest;
		expect(zipRest).toEqual(dirRest);
		expect(zipMeta.source).toBe("mini-python.zip");
		expect(zipMeta.fileCount).toBe(dirMeta.fileCount);
	});
});

describe("convert: review-fix regressions", () => {
	let dir: string | undefined;

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	test("a file literally named __proto__ round-trips through its chunk, not lost to the prototype setter", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-proto-"));
		await writeFile(join(dir, "__proto__"), "not actually a prototype\n");

		const bundle = await convert(new DirSource(dir), {
			name: "proto",
			source: dir,
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.portals.map((p) => p.id)).toContain("__proto__");

		const rootChunk = parseBundleEntry<{
			files: Record<string, { content: string }>;
		}>(bundle, "chunks/root.json");
		expect(Object.hasOwn(rootChunk.files, "__proto__")).toBe(true);
		// biome-ignore lint/suspicious/noProto: the literal key under test, not the accessor
		expect(rootChunk.files.__proto__?.content).toBe(
			"not actually a prototype\n",
		);
	});

	test("meta.truncated and skippedFiles report a partial world", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-truncate-"));
		for (let i = 0; i < 5; i++) await writeFile(join(dir, `f${i}.txt`), "x");

		const bundle = await convert(new DirSource(dir), {
			name: "t",
			source: dir,
			now: FIXED_NOW,
			maxFiles: 3,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.meta.truncated).toBe(true);
		expect(manifest.meta.skippedFiles).toBe(2);
		expect(manifest.meta.fileCount).toBe(3);
	});

	test("meta.truncated is false and skippedFiles is 0 for a complete world", async () => {
		const bundle = await convert(new DirSource(join(FIXTURES, "mini-python")), {
			name: "mini-python",
			source: "mini-python",
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(manifest.meta.truncated).toBe(false);
		expect(manifest.meta.skippedFiles).toBe(0);
	});

	test("converting the same fixture twice with a fixed clock produces byte-identical bundles", async () => {
		const opts = { name: "mini-python", source: "mini-python", now: FIXED_NOW };
		const first = await convert(
			new DirSource(join(FIXTURES, "mini-python")),
			opts,
		);
		const second = await convert(
			new DirSource(join(FIXTURES, "mini-python")),
			opts,
		);

		expect([...first.keys()].sort()).toEqual([...second.keys()].sort());
		for (const [name, content] of first) {
			expect(content, `bundle entry ${name} differed between runs`).toEqual(
				second.get(name),
			);
		}
	});
});
