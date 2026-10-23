import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type EmbedIndexFile,
	parseShowcase,
	SHOWCASE_FILENAME,
	sitePortalId,
	validateManifest,
	type WorldManifest,
} from "@cabn/world-schema";
import { afterEach, describe, expect, test } from "vitest";
import { CabnConfigError } from "../src/cabnConfig.js";
import { convert, safeSource } from "../src/convert.js";
import type { EmbedFetch } from "../src/embedCheck.js";
import { DirSource } from "../src/sources/dir.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function entry<T>(bundle: Map<string, Uint8Array | string>, name: string): T {
	const raw = bundle.get(name);
	if (typeof raw !== "string") throw new Error(`missing bundle entry: ${name}`);
	return JSON.parse(raw) as T;
}

function fakePng(): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	new DataView(bytes.buffer).setUint32(16, 4);
	new DataView(bytes.buffer).setUint32(20, 4);
	return bytes;
}

const ORIGIN = "https://demo.example.org";

let dir: string | undefined;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

async function project(cabnJson?: unknown): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "cabn-sites-"));
	await writeFile(join(dir, "README.md"), "# hi\n");
	await mkdir(join(dir, "src"));
	await writeFile(join(dir, "src", "main.py"), "print('hi')\n");
	await writeFile(join(dir, "shot.png"), fakePng());
	if (cabnJson !== undefined)
		await writeFile(join(dir, "cabn.json"), JSON.stringify(cabnJson));
	return dir;
}

function build(
	root: string,
	extra: Partial<Parameters<typeof convert>[1]> = {},
) {
	return convert(new DirSource(root), {
		name: "p",
		source: "p",
		now: FIXED_NOW,
		...extra,
	});
}

describe("cabn.json sites", () => {
	test("become url portals in the root cluster, first in ring order", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [
				{ id: "live", title: "Live demo", url: `${ORIGIN}/`, hero: true },
				{
					id: "docs",
					title: "Docs",
					url: `${ORIGIN}/docs`,
					fallbackImage: "shot.png",
				},
			],
		});
		const bundle = await build(root);
		const manifest = validateManifest(entry(bundle, "world.json"));
		const rootCluster = manifest.clusters.find((c) => c.path === ".");
		expect(rootCluster?.portalIds.slice(0, 2)).toEqual([
			sitePortalId("live"),
			sitePortalId("docs"),
		]);
		const live = manifest.portals.find((p) => p.id === sitePortalId("live"));
		expect(live?.richPreview).toEqual({
			kind: "url",
			url: `${ORIGIN}/`,
			title: "Live demo",
		});
		expect(live?.file).toMatchObject({ name: "Live demo", bytes: 0 });
		const docs = manifest.portals.find((p) => p.id === sitePortalId("docs"));
		expect(docs?.richPreview).toMatchObject({
			kind: "url",
			fallbackImage: expect.stringMatching(/^media\//),
		});
		// Real files only: sites never count as files or reach a chunk.
		expect(manifest.meta.fileCount).toBe(3);
		const chunk = entry<{ files: Record<string, unknown> }>(
			bundle,
			"chunks/root.json",
		);
		expect(Object.keys(chunk.files)).not.toContain(sitePortalId("live"));

		const showcase = parseShowcase(entry(bundle, SHOWCASE_FILENAME));
		expect(showcase.heroPortalId).toBe(sitePortalId("live"));
		expect(showcase.sitePortalIds).toHaveLength(2);
	});

	test("the framability check covers sites; blocked sites are recorded", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [{ id: "live", title: "Live", url: `${ORIGIN}/`, hero: true }],
		});
		const fetch: EmbedFetch = async () => ({
			status: 200,
			headers: {
				get: (name) => (name === "x-frame-options" ? "DENY" : null),
			},
		});
		const bundle = await build(root, { embedNetwork: { fetch } });
		const embeds = entry<EmbedIndexFile>(bundle, "embeds.json");
		expect(embeds.entries[sitePortalId("live")]).toMatchObject({
			framable: false,
			basis: "headers",
		});
	});

	test("an un-allowlisted site origin fails the conversion", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [],
			sites: [{ id: "live", title: "Live", url: `${ORIGIN}/` }],
		});
		await expect(build(root)).rejects.toThrow(
			/not listed in allowedEmbedOrigins/,
		);
	});

	test("two heroes fail the conversion", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [
				{ id: "a", title: "A", url: `${ORIGIN}/`, hero: true },
				{ id: "b", title: "B", url: `${ORIGIN}/`, hero: true },
			],
		});
		await expect(build(root)).rejects.toThrow(CabnConfigError);
	});

	test("a missing fallbackImage names the site", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [
				{ id: "a", title: "A", url: `${ORIGIN}/`, fallbackImage: "nope.png" },
			],
		});
		await expect(build(root)).rejects.toThrow(/sites\["a"\]\.fallbackImage/);
	});

	test("a real file at a site's portal path fails instead of colliding", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [{ id: "a", title: "A", url: `${ORIGIN}/` }],
		});
		await mkdir(join(root, "@cabn-site"));
		await writeFile(join(root, "@cabn-site", "a"), "x\n");
		await expect(build(root)).rejects.toThrow(/would collide/);
	});

	test("the root clearing is sized for its sites", async () => {
		const plain = await project();
		const without = validateManifest(entry(await build(plain), "world.json"));
		await rm(plain, { recursive: true, force: true });
		const withSites = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: Array.from({ length: 8 }, (_, i) => ({
				id: `s${i}`,
				title: `S${i}`,
				url: `${ORIGIN}/`,
			})),
		});
		const grown = validateManifest(entry(await build(withSites), "world.json"));
		const distance = (m: WorldManifest) => {
			const src = m.clusters.find((c) => c.path === "src");
			return Math.hypot(src?.pos.x ?? 0, src?.pos.y ?? 0);
		};
		expect(distance(grown)).toBeGreaterThan(distance(without));
	});

	test("a hero site gives the root clearing room for it inside the ring", async () => {
		const site = (hero: boolean) => ({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			sites: [{ id: "a", title: "A", url: `${ORIGIN}/`, hero }],
		});
		const plain = await project(site(false));
		const withoutHero = validateManifest(
			entry(await build(plain), "world.json"),
		);
		await rm(plain, { recursive: true, force: true });
		const heroDir = await project(site(true));
		const withHero = validateManifest(
			entry(await build(heroDir), "world.json"),
		);
		const src = (m: WorldManifest) => m.clusters.find((c) => c.path === "src");
		const d = (m: WorldManifest) =>
			Math.hypot(src(m)?.pos.x ?? 0, src(m)?.pos.y ?? 0);
		// Root clearing 384 + 90 margin, plus the child's own clearing and the gap.
		expect(d(withHero)).toBeGreaterThanOrEqual(384 + 90 + 60);
		expect(d(withHero)).toBeGreaterThan(d(withoutHero));
	});

	test("a world without sites writes an empty showcase.json", async () => {
		const root = await project();
		const bundle = await build(root);
		expect(entry(bundle, SHOWCASE_FILENAME)).toEqual({
			showcaseVersion: 1,
			sites: [],
		});
	});

	test("world info is carried into showcase.json, not world.json", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			world: { title: "T", description: "D", order: 4 },
		});
		const bundle = await build(root);
		const manifest = entry<WorldManifest>(bundle, "world.json");
		expect(JSON.stringify(manifest.meta)).not.toContain('"description"');
		expect(parseShowcase(entry(bundle, SHOWCASE_FILENAME))).toMatchObject({
			title: "T",
			description: "D",
			order: 4,
		});
	});
});

describe("display name and meta.source", () => {
	const titled = (title: string) => ({
		cabnConfigVersion: 1,
		world: { title },
	});

	test("nameOverride > injected title > repo title > name", async () => {
		const root = await project(titled("Repo"));
		const name = async (extra: Partial<Parameters<typeof convert>[1]>) =>
			entry<WorldManifest>(await build(root, extra), "world.json").meta.name;
		expect(await name({})).toBe("Repo");
		expect(await name({ config: titled("Host") })).toBe("Host");
		expect(await name({ config: titled("Host"), nameOverride: "Flag" })).toBe(
			"Flag",
		);
		expect(await name({ config: { cabnConfigVersion: 1 } })).toBe("p");
	});

	test("an absolute source never reaches world.json", async () => {
		const root = await project();
		for (const source of [
			root,
			"C:\\Users\\me\\proj",
			"\\\\host\\share\\proj",
		]) {
			const meta = entry<WorldManifest>(
				await build(root, { source }),
				"world.json",
			).meta;
			expect(meta.source).not.toMatch(/[\\/]/);
		}
		expect(safeSource("/a/b/proj/")).toBe("proj");
		expect(safeSource("C:\\x\\proj")).toBe("proj");
		expect(safeSource("upload.zip")).toBe("upload.zip");
		expect(safeSource("proj#side")).toBe("proj#side");
	});
});

describe("ConvertOptions.config (injected cabn.json)", () => {
	test("is used when the source has no cabn.json", async () => {
		const root = await project();
		const bundle = await build(root, {
			config: {
				cabnConfigVersion: 1,
				allowedEmbedOrigins: [ORIGIN],
				sites: [{ id: "live", title: "Live", url: `${ORIGIN}/`, hero: true }],
			},
		});
		const manifest = entry<WorldManifest>(bundle, "world.json");
		expect(manifest.allowedEmbedOrigins).toEqual([ORIGIN]);
		expect(manifest.portals.some((p) => p.id === sitePortalId("live"))).toBe(
			true,
		);
	});

	test("wins key by key over the repo's cabn.json; other keys keep the repo's", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			previews: { "README.md": { kind: "text", text: "from the repo" } },
			allowedEmbedOrigins: ["https://repo.example"],
			guide: false,
		});
		const bundle = await build(root, {
			config: {
				cabnConfigVersion: 1,
				allowedEmbedOrigins: [ORIGIN],
				world: { title: "Injected" },
			},
		});
		const manifest = entry<WorldManifest>(bundle, "world.json");
		expect(manifest.allowedEmbedOrigins).toEqual([ORIGIN]);
		expect(manifest.guide).toBe(false);
		expect(
			manifest.portals.find((p) => p.id === "README.md")?.richPreview,
		).toEqual({ kind: "text", text: "from the repo" });
		expect(parseShowcase(entry(bundle, SHOWCASE_FILENAME)).title).toBe(
			"Injected",
		);
	});

	test("a host that sets no allowlist gets none: the repo's can't widen it", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			previews: { "README.md": { kind: "url", url: `${ORIGIN}/` } },
			allowedEmbedOrigins: [ORIGIN],
		});
		await expect(
			build(root, { config: { cabnConfigVersion: 1, world: { title: "T" } } }),
		).rejects.toThrow(/not listed in allowedEmbedOrigins/);
		const plain = await build(root, {
			config: { cabnConfigVersion: 1, previews: {} },
		});
		expect(
			entry<WorldManifest>(plain, "world.json").allowedEmbedOrigins,
		).toEqual([]);
	});

	test("the repo's world and sites are dropped, with a warning", async () => {
		const root = await project({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			world: {
				title: "Repo title",
				links: [{ label: "Sneaky", url: "https://repo.example/" }],
			},
			sites: [{ id: "repo-site", title: "R", url: `${ORIGIN}/`, hero: true }],
		});
		const warnings: string[] = [];
		const bundle = await build(root, {
			config: { cabnConfigVersion: 1, allowedEmbedOrigins: [ORIGIN] },
			onWarning: (m) => warnings.push(m),
		});
		expect(warnings.join("\n")).toMatch(/world and sites ignored/);
		const showcase = parseShowcase(entry(bundle, SHOWCASE_FILENAME));
		expect(showcase.links).toEqual([]);
		expect(showcase.heroPortalId).toBeNull();
		const manifest = entry<WorldManifest>(bundle, "world.json");
		expect(manifest.meta.name).toBe("p");
		expect(manifest.portals.some((p) => p.id.startsWith("@cabn-site/"))).toBe(
			false,
		);
	});

	test("a non-object repo cabn.json fails the same way with or without injection", async () => {
		const root = await project([1, 2]);
		const without = await build(root).catch((e: Error) => e.message);
		const withConfig = await build(root, {
			config: { cabnConfigVersion: 1 },
		}).catch((e: Error) => e.message);
		expect(typeof without).toBe("string");
		expect(withConfig).toBe(without);
	});

	test("the merged result is validated as a whole", async () => {
		// The repo allowlists its url preview's origin; an injected
		// allowedEmbedOrigins replaces that list, so the repo's preview no
		// longer validates.
		const root = await project({
			cabnConfigVersion: 1,
			previews: {
				"README.md": { kind: "url", url: "https://repo.example/" },
			},
			allowedEmbedOrigins: ["https://repo.example"],
		});
		await expect(
			build(root, {
				config: { cabnConfigVersion: 1, allowedEmbedOrigins: [ORIGIN] },
			}),
		).rejects.toThrow(/injected config merged over it/);
	});
});
