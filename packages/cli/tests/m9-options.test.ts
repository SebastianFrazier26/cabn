import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runBuild } from "../src/build.js";
import { run } from "../src/cli.js";
import { collectWorldEmbedOrigins, runShelf } from "../src/shelf.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
const ORIGIN = "https://demo.example.org";
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "cabn-cli-m9-"));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Every string anywhere in a JSON value. */
function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === "object")
		return Object.values(value).flatMap(strings);
	return [];
}

describe("meta.source", () => {
	test("world.json never carries an absolute path", async () => {
		const outDir = join(root, "w");
		await runBuild(FIXTURE, { outDir, offline: true });
		const manifest = await readJson<{ meta: { source: string } }>(
			join(outDir, "world.json"),
		);
		expect(manifest.meta.source).toBe("tiny-project");
		for (const s of strings(manifest)) {
			expect(isAbsolute(s), s).toBe(false);
			expect(s).not.toContain(FIXTURE);
		}
	});

	test("is the --name when one is given", async () => {
		const outDir = join(root, "w");
		await runBuild(FIXTURE, { outDir, offline: true, name: "Shown Name" });
		const manifest = await readJson<{ meta: { source: string; name: string } }>(
			join(outDir, "world.json"),
		);
		expect(manifest.meta).toMatchObject({
			name: "Shown Name",
			source: "Shown Name",
		});
	});
});

describe("--name", () => {
	test("cabn build --name sets meta.name and the default out dir", async () => {
		const cwd = process.cwd();
		process.chdir(root);
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await run(["build", FIXTURE, "--offline", "--name", "pretty"]),
			).toBe(0);
		} finally {
			process.chdir(cwd);
		}
		const manifest = await readJson<{ meta: { name: string } }>(
			join(root, "pretty-world", "world.json"),
		);
		expect(manifest.meta.name).toBe("pretty");
	});

	test("cabn shelf --name sets the shelf name", async () => {
		const bundle = join(root, "a");
		await runBuild(FIXTURE, { outDir: bundle, offline: true });
		vi.spyOn(console, "log").mockImplementation(() => {});
		const out = join(root, "shelf");
		expect(
			await run(["shelf", bundle, "-o", out, "--name", "My Portfolio"]),
		).toBe(0);
		const shelf = await readJson<{ meta: { name: string } }>(
			join(out, "shelf.json"),
		);
		expect(shelf.meta.name).toBe("My Portfolio");
	});
});

describe("--config", () => {
	async function writeConfig(config: unknown): Promise<string> {
		const path = join(root, "outside.cabn.json");
		await writeFile(path, JSON.stringify(config));
		return path;
	}

	test("injects a cabn.json kept outside the source", async () => {
		const configPath = await writeConfig({
			cabnConfigVersion: 1,
			allowedEmbedOrigins: [ORIGIN],
			world: { title: "Injected", description: "From outside." },
			sites: [{ id: "live", title: "Live", url: `${ORIGIN}/`, hero: true }],
		});
		const outDir = join(root, "w");
		vi.spyOn(console, "log").mockImplementation(() => {});
		expect(
			await run([
				"build",
				FIXTURE,
				"-o",
				outDir,
				"--offline",
				"--config",
				configPath,
			]),
		).toBe(0);
		const manifest = await readJson<{ portals: { id: string }[] }>(
			join(outDir, "world.json"),
		);
		expect(manifest.portals.map((p) => p.id)).toContain("@cabn-site/live");
		const showcase = await readJson(join(outDir, "showcase.json"));
		expect(showcase).toMatchObject({ world: { title: "Injected" } });
	});

	test("the injected config wins over the repo's cabn.json", async () => {
		const src = join(root, "src");
		await cp(FIXTURE, src, { recursive: true });
		await writeFile(
			join(src, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				guide: true,
				world: { title: "Repo" },
			}),
		);
		const outDir = join(root, "w");
		await runBuild(src, {
			outDir,
			offline: true,
			config: { cabnConfigVersion: 1, world: { title: "Host" } },
		});
		expect(await readJson(join(outDir, "showcase.json"))).toMatchObject({
			world: { title: "Host" },
		});
		expect(await readJson(join(outDir, "world.json"))).toMatchObject({
			guide: true,
		});
	});

	test("an invalid config file fails the build with its name", async () => {
		const path = join(root, "broken.json");
		await writeFile(path, "{ nope");
		await expect(
			runBuild(FIXTURE, { outDir: join(root, "w"), config: path }),
		).rejects.toThrow(/broken\.json is not valid JSON/);
		const bad = await writeConfig({
			cabnConfigVersion: 1,
			sites: [{ id: "x", title: "X", url: `${ORIGIN}/` }],
		});
		await expect(
			runBuild(FIXTURE, { outDir: join(root, "w2"), config: bad }),
		).rejects.toThrow(/allowedEmbedOrigins/);
	});
});

describe("shelf showcase info", () => {
	test("orders by order then name and carries description, links, heroUrl", async () => {
		const build = async (dir: string, name: string, world: object) => {
			await runBuild(FIXTURE, {
				outDir: join(root, dir),
				offline: true,
				name,
				config: {
					cabnConfigVersion: 1,
					allowedEmbedOrigins: [ORIGIN],
					world,
					sites: [
						{ id: "live", title: "Live", url: `${ORIGIN}/${dir}`, hero: true },
					],
				},
			});
			return join(root, dir);
		};
		const dirs = [
			await build("c", "charlie", { order: 2 }),
			await build("b", "bravo", { order: 1, description: "B world" }),
			await build("a", "alpha", {
				order: 2,
				links: [{ label: "Repo", url: "https://github.com/" }],
			}),
		];
		const out = join(root, "shelf");
		await runShelf(dirs, { outDir: out, name: "P" });
		const shelf = await readJson<{
			worlds: {
				name: string;
				description?: string;
				heroUrl?: string;
				links?: unknown[];
			}[];
		}>(join(out, "shelf.json"));
		expect(shelf.worlds.map((w) => w.name)).toEqual([
			"bravo",
			"alpha",
			"charlie",
		]);
		expect(shelf.worlds[0]).toMatchObject({
			description: "B world",
			heroUrl: `${ORIGIN}/b`,
		});
		expect(shelf.worlds[1]?.links).toHaveLength(1);
	});

	test("a bundle without showcase.json still shelves", async () => {
		const bundle = join(root, "old");
		await runBuild(FIXTURE, { outDir: bundle, offline: true });
		await rm(join(bundle, "showcase.json"));
		const out = join(root, "shelf");
		expect((await runShelf([bundle], { outDir: out })).worlds).toBe(1);
	});

	test("collectWorldEmbedOrigins unions every world's origins", async () => {
		const a = join(root, "a");
		const b = join(root, "b");
		await runBuild(FIXTURE, {
			outDir: a,
			offline: true,
			config: {
				cabnConfigVersion: 1,
				allowedEmbedOrigins: [ORIGIN, "https://z.example"],
			},
		});
		await runBuild(FIXTURE, {
			outDir: b,
			offline: true,
			config: { cabnConfigVersion: 1, allowedEmbedOrigins: [ORIGIN] },
		});
		expect(await collectWorldEmbedOrigins([a, b])).toEqual([
			ORIGIN,
			"https://z.example",
		]);
	});
});

describe("serveSource", () => {
	test("is stable per directory, never the path, and differs between same-named dirs", async () => {
		const { serveSource } = await import("../src/serve/server.js");
		const a = serveSource("/home/me/one/proj");
		expect(a).toMatch(/^proj~[0-9a-f]{8}$/);
		expect(serveSource("/home/me/one/proj")).toBe(a);
		expect(serveSource("/home/me/two/proj")).not.toBe(a);
	});
});

describe("--name beats every cabn.json title", () => {
	test("world.json and shelf.json agree on the name", async () => {
		const outDir = join(root, "w");
		await runBuild(FIXTURE, {
			outDir,
			offline: true,
			name: "Flag",
			config: { cabnConfigVersion: 1, world: { title: "Host" } },
		});
		expect(
			(await readJson<{ meta: { name: string } }>(join(outDir, "world.json")))
				.meta.name,
		).toBe("Flag");
		const out = join(root, "shelf");
		await runShelf([outDir], { outDir: out });
		const shelf = await readJson<{ worlds: { name: string }[] }>(
			join(out, "shelf.json"),
		);
		expect(shelf.worlds[0]?.name).toBe("Flag");
	});

	test("without --name the injected title names both", async () => {
		const outDir = join(root, "w");
		await runBuild(FIXTURE, {
			outDir,
			offline: true,
			config: { cabnConfigVersion: 1, world: { title: "Host" } },
		});
		const out = join(root, "shelf");
		await runShelf([outDir], { outDir: out });
		const shelf = await readJson<{ worlds: { name: string }[] }>(
			join(out, "shelf.json"),
		);
		expect(shelf.worlds[0]?.name).toBe("Host");
	});

	test("repo world.links never reach the shelf under injection", async () => {
		const src = join(root, "src");
		await cp(FIXTURE, src, { recursive: true });
		await writeFile(
			join(src, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				world: { links: [{ label: "Sneaky", url: "https://repo.example/" }] },
			}),
		);
		const outDir = join(root, "w");
		await runBuild(src, {
			outDir,
			offline: true,
			config: { cabnConfigVersion: 1, world: { description: "Host" } },
		});
		const out = join(root, "shelf");
		await runShelf([outDir], { outDir: out });
		const shelf = await readJson<{
			worlds: { links?: unknown[]; description?: string }[];
		}>(join(out, "shelf.json"));
		expect(shelf.worlds[0]?.links).toBeUndefined();
		expect(shelf.worlds[0]?.description).toBe("Host");
	});
});
