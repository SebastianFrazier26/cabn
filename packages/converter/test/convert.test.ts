import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { validateManifest, type WorldManifest } from "@cabn/world-schema";
import { zipSync } from "fflate";
import MiniSearch from "minisearch";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import { SEARCH_FIELDS, SEARCH_STORE_FIELDS } from "../src/search-index.js";
import { DirSource } from "../src/sources/dir.js";
import type { FileSource, SourceEntry } from "../src/sources/types.js";
import { ZipSource } from "../src/sources/zip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
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
				"media.json",
				"monsters.json",
				"embeds.json",
				"signs.json",
				"chunks/root.json",
				"chunks/pkg.json",
				"chunks/pkg--sub.json",
				"chunks/pkg--utils.json",
			].sort(),
		);

		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(() => validateManifest(manifest)).not.toThrow();
		expect(manifest.meta.generatedAt).toBe("2026-01-01T00:00:00.000Z");
		// 2026-09-28: the fixture's .env is hidden, so it is no longer part of a normal world.
		expect(manifest.meta.fileCount).toBe(5);
		expect(manifest.portals.map((p) => p.id).sort()).toEqual(
			[
				"README.md",
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

		// .env is hidden: neither its name nor its content reaches any bundle file.
		expect(manifest.portals.find((p) => p.id === ".env")).toBeUndefined();
		expect(rootChunk.files[".env"]).toBeUndefined();
		for (const value of bundle.values()) {
			if (typeof value === "string") expect(value).not.toContain(".env");
		}
		const searchIndexRaw = bundle.get("search-index.json");
		expect(typeof searchIndexRaw === "string" && searchIndexRaw).not.toContain(
			"DEBUG=true",
		);
	});

	test("includeSecrets: true restores a visible secret file's content but never brings back a hidden one", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cabn-secrets-"));
		try {
			await writeFile(join(dir, "aws-credentials.txt"), "KEY=visible\n");
			await writeFile(join(dir, ".env"), "KEY=hidden\n");
			const bundle = await convert(new DirSource(dir), {
				name: "secrets",
				source: "secrets",
				now: FIXED_NOW,
				includeSecrets: true,
			});
			const rootChunk = parseBundleEntry<{
				files: Record<string, { content: string }>;
			}>(bundle, "chunks/root.json");
			expect(rootChunk.files["aws-credentials.txt"]?.content).toBe(
				"KEY=visible\n",
			);
			expect(rootChunk.files[".env"]).toBeUndefined();
			for (const value of bundle.values()) {
				if (typeof value === "string")
					expect(value).not.toContain("KEY=hidden");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
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

	test("spawns a monster of every species for the broken-world fixture (M6 annotators end to end)", async () => {
		const source = new DirSource(join(FIXTURES, "broken-world"));
		const bundle = await convert(source, {
			name: "broken-world",
			source: "broken-world",
			now: FIXED_NOW,
		});
		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		expect(() => validateManifest(manifest)).not.toThrow();

		const speciesFound = new Set(manifest.monsters.map((m) => m.species));
		expect(speciesFound).toEqual(
			new Set([
				"ghost",
				"rot-sprite",
				"warded-mimic",
				"gremlin",
				"ouroboros",
				"will-o-wisp",
			]),
		);

		// Every portal-attached monster id shows up in its own portal's spawns;
		// the ouroboros here is a two-file cycle inside one cluster (both b.ts
		// and c.ts are direct children of the fixture root), so it attaches to
		// the first file (lexicographic) rather than a cross-cluster path.
		for (const monster of manifest.monsters) {
			if (!monster.portalId) continue;
			const portal = manifest.portals.find((p) => p.id === monster.portalId);
			expect(portal?.spawns).toContain(monster.id);
		}

		const ouroboros = manifest.monsters.find((m) => m.species === "ouroboros");
		expect(ouroboros?.portalId).toBe("src/b.ts");
		expect(ouroboros?.pathId).toBeUndefined();

		// Snapshotting monsters/portal.spawns only (not the whole manifest) —
		// clusters/paths/preview text are already covered by the mini-python
		// snapshot above and would just add noise here.
		expect(
			manifest.monsters
				.map(({ id: _id, ...rest }) => rest)
				.sort((a, b) => a.error.code.localeCompare(b.error.code)),
		).toMatchSnapshot();
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

// 2026-10-01: an entry withheld by a source's own total-bytes cap — not its
// own per-file cap — used to reach convert() as a real Uint8Array of length
// 0 (ZipSource's read() defaulted to an empty buffer instead of signalling
// "withheld"). It then looked exactly like a legitimate empty text file: a
// "" chunk entry and a "" doc in the search index, instead of the sealed
// portal every other content-less file gets.
describe("convert: an archive-wide total-bytes cap reached partway through conversion", () => {
	function hasSearchDoc(
		bundle: Map<string, Uint8Array | string>,
		id: string,
	): boolean {
		const raw = bundle.get("search-index.json");
		if (typeof raw !== "string") throw new Error("missing search-index.json");
		const file = JSON.parse(raw) as { index: unknown };
		const mini = MiniSearch.loadJSON<{
			id: string;
			path: string;
			name: string;
			content: string;
		}>(JSON.stringify(file.index), {
			fields: [...SEARCH_FIELDS],
			storeFields: [...SEARCH_STORE_FIELDS],
		});
		return mini.has(id);
	}

	test("zip source: a later small entry under maxFileBytes is sealed, not an empty-text portal, and reports its real size", async () => {
		// a.txt (740) retains fully; b.txt (16) is well under maxFileBytes on
		// its own, but 740 + 16 > 750 trips the archive-wide total mid-stream.
		const zipped = zipSync({
			"a.txt": new Uint8Array(740).fill(65),
			"b.txt": utf8("small but capped"),
		});
		const bundle = await convert(
			new ZipSource(zipped, { maxTotalBytes: 750 }),
			{ name: "cap-test", source: "cap-test.zip", now: FIXED_NOW },
		);

		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		const bPortal = manifest.portals.find((p) => p.id === "b.txt");
		expect(bPortal).toBeDefined();
		expect(bPortal?.richPreview).toEqual({ kind: "sealed" });
		expect(bPortal?.file.bytes).toBe(utf8("small but capped").length);

		const rootChunk = parseBundleEntry<{ files: Record<string, unknown> }>(
			bundle,
			"chunks/root.json",
		);
		expect(Object.hasOwn(rootChunk.files, "b.txt")).toBe(false);
		expect(hasSearchDoc(bundle, "b.txt")).toBe(false);
		expect(hasSearchDoc(bundle, "a.txt")).toBe(true);
	});

	// DirSource has no total-bytes cap of its own (local trees are trusted,
	// unlike an uploaded zip) — this exercises convert()'s generic handling of
	// any FileSource that withholds content below maxFileBytes, the same
	// contract a future directory-side budget would need.
	test("directory-like source: an entry whose content the source withheld is sealed, not an empty-text portal", async () => {
		const withheldPath = "b.txt";
		const source: FileSource = {
			async *entries(): AsyncIterable<SourceEntry> {
				yield {
					path: "a.txt",
					bytes: 5,
					read: () => Promise.resolve(utf8("hello")),
				};
				yield {
					path: withheldPath,
					bytes: 17, // the real size, known even though content was withheld
					read: () => Promise.resolve(undefined),
				};
			},
		};
		const bundle = await convert(source, {
			name: "cap-test",
			source: "cap-test",
			now: FIXED_NOW,
		});

		const manifest = parseBundleEntry<WorldManifest>(bundle, "world.json");
		const bPortal = manifest.portals.find((p) => p.id === withheldPath);
		expect(bPortal).toBeDefined();
		expect(bPortal?.richPreview).toEqual({ kind: "sealed" });
		expect(bPortal?.file.bytes).toBe(17);

		const rootChunk = parseBundleEntry<{ files: Record<string, unknown> }>(
			bundle,
			"chunks/root.json",
		);
		expect(Object.hasOwn(rootChunk.files, withheldPath)).toBe(false);
		expect(hasSearchDoc(bundle, withheldPath)).toBe(false);
		expect(hasSearchDoc(bundle, "a.txt")).toBe(true);
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

describe("meta.themeSeed", () => {
	const dirs: string[] = [];
	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
		);
	});

	async function themeSeedOf(files: Record<string, string>): Promise<number> {
		const parent = await mkdtemp(join(tmpdir(), "cabn-tint-"));
		dirs.push(parent);
		const root = join(parent, "my-project");
		for (const [path, content] of Object.entries(files)) {
			await mkdir(join(root, path, ".."), { recursive: true });
			await writeFile(join(root, path), content);
		}
		const bundle = await convert(new DirSource(root), {
			name: basename(root),
			source: root,
		});
		const seed = parseBundleEntry<WorldManifest>(bundle, "world.json").meta
			.themeSeed;
		if (seed === undefined) throw new Error("themeSeed missing");
		return seed;
	}

	const tree = {
		"README.md": "# hi\n",
		"src/main.py": "print('hi')\n",
		"src/util/strings.py": "X = 1\n",
	};

	test("the same tree and folder name under different parents keeps its tint", async () => {
		const a = await themeSeedOf(tree);
		const b = await themeSeedOf(tree);
		expect(dirs[0]).not.toBe(dirs[1]);
		expect(a).toBe(b);
	});

	test("a different file tree changes it", async () => {
		const a = await themeSeedOf(tree);
		const b = await themeSeedOf({ ...tree, "src/extra.py": "Y = 2\n" });
		expect(a).not.toBe(b);
	});
});
