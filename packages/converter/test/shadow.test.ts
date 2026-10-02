import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	WorldLayerDeltaSchema,
	type WorldManifest,
	worldLayerIssues,
} from "@cabn/world-schema";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import { convertShadow } from "../src/shadow.js";
import { DirSource } from "../src/sources/dir.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");
const j = (...parts: string[]) => parts.join("");
// Assembled at runtime so the source never holds a scanner-matchable key.
const ANTHROPIC = j("sk-", "ant-", "demo-cabnFakeKeyForTheMagpie42");
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
	0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
]);

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function fixture(
	files: Record<string, string | Uint8Array>,
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "cabn-shadow-"));
	dirs.push(dir);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	return dir;
}

async function both(dir: string, trackedPaths?: ReadonlySet<string>) {
	const bundle = await convert(new DirSource(dir), {
		name: "w",
		source: "w",
		now: FIXED_NOW,
	});
	const base = JSON.parse(bundle.get("world.json") as string) as WorldManifest;
	const delta = await convertShadow(new DirSource(dir), base, {
		now: FIXED_NOW,
		...(trackedPaths ? { trackedPaths } : {}),
	});
	return { bundle, base, delta };
}

const PROJECT = {
	"README.md": "# hi\n",
	"src/app.ts": "export const a = 1;\n",
	"src/.eslintrc.json": '{ "root": true }\n',
	".env": `ANTHROPIC_API_KEY=${ANTHROPIC}\n`,
	".github/CODEOWNERS": "* @me\n",
	".github/workflows/ci.yml": "on: push\n",
	".github/notes.seyn": "# CI notes\nhello\n",
	".vscode/settings.json": "{}\n",
	".assets/logo.png": PNG,
	".git/config": "[core]\n",
	".venv/lib/site.py": "x = 1\n",
	"node_modules/.bin/tool": "#!/bin/sh\n",
	"docs/.hidden-only/a.md": "# nested\n",
};

describe("convertShadow", () => {
	test("hidden files become annex and folder clusters; ignored ones never appear", async () => {
		const dir = await fixture(PROJECT);
		const { base, delta } = await both(dir);

		expect(() => WorldLayerDeltaSchema.parse(delta)).not.toThrow();
		expect(worldLayerIssues(base, delta)).toEqual([]);
		expect(delta.baseGeneratedAt).toBe(base.meta.generatedAt);

		const byId = new Map(delta.clusters.map((c) => [c.id, c]));
		expect([...byId.keys()].sort()).toEqual(
			[
				"root#shadow",
				"src#shadow",
				".github",
				".github--workflows",
				".vscode",
				".assets",
				"docs--.hidden-only",
			].sort(),
		);
		expect(byId.get("root#shadow")?.portalIds).toEqual([".env"]);
		expect(byId.get("root#shadow")?.annexOf).toBe("root");
		expect(byId.get("src#shadow")?.annexOf).toBe("src");

		const parentOf = new Map(delta.paths.map((p) => [p.to, p]));
		expect(parentOf.get("root#shadow")).toMatchObject({
			from: "root",
			kind: "trail",
		});
		// A hidden folder hangs off its visible ancestor's annex when there is one...
		expect(parentOf.get(".github")?.from).toBe("root#shadow");
		expect(parentOf.get(".github--workflows")?.from).toBe(".github");
		// ...else off the nearest visible cluster ("docs" has no files of its own, so root).
		expect(parentOf.get("docs--.hidden-only")?.from).toBe("root#shadow");

		const portalIds = delta.portals.map((p) => p.id);
		for (const bad of [
			".git/config",
			".venv/lib/site.py",
			"node_modules/.bin/tool",
		])
			expect(portalIds).not.toContain(bad);
		for (const p of portalIds)
			expect(base.portals.map((b) => b.id)).not.toContain(p);
		expect(delta.stats.fileCount).toBe(delta.portals.length);
	});

	test("secret-named hidden files are readable; hidden media is a sealed chest", async () => {
		const dir = await fixture(PROJECT);
		const { delta } = await both(dir);
		expect(delta.chunks["root#shadow"]?.files[".env"]?.content).toContain(
			"ANTHROPIC_API_KEY=",
		);
		const logo = delta.portals.find((p) => p.id === ".assets/logo.png");
		expect(logo?.richPreview).toEqual({ kind: "sealed" });
		expect(delta.chunks[".assets"]?.files).toEqual({});
		expect(delta.textSha256[".env"]).toBe(
			createHash("sha256").update(PROJECT[".env"]).digest("hex"),
		);
		expect(delta.textSha256[".assets/logo.png"]).toBeUndefined();
	});

	test("a visible secret file stays out of the shadow realm", async () => {
		const dir = await fixture({ "deploy.pem": "KEY\n", ".npmrc": "x=1\n" });
		const { base, delta } = await both(dir);
		expect(base.portals.map((p) => p.id)).toEqual(["deploy.pem"]);
		expect(delta.portals.map((p) => p.id)).toEqual([".npmrc"]);
	});

	test("signs in hidden folders are shadow signs; search covers hidden docs", async () => {
		const dir = await fixture(PROJECT);
		const { bundle, delta } = await both(dir);
		expect(delta.signs.map((s) => s.path)).toEqual([".github/notes.seyn"]);
		expect(delta.signs[0]?.anchor).toEqual({ kind: "cluster", id: ".github" });
		expect(JSON.parse(bundle.get("signs.json") as string).signs).toEqual([]);
		const index = JSON.stringify(delta.searchIndex);
		expect(index).toContain(".github/workflows/ci.yml");
		expect(index).not.toContain("src/app.ts");
	});

	test("magpie on a hidden secret-named file only when git tracks it", async () => {
		const dir = await fixture({
			"README.md": "# hi\n",
			".env": `ANTHROPIC_API_KEY=${ANTHROPIC}\n`,
			".github/deploy.yml": `token: ${ANTHROPIC}\n`,
		});
		const magpiesOn = (delta: Awaited<ReturnType<typeof both>>["delta"]) =>
			[...delta.monsters, ...delta.extendedMonsters]
				.filter((m) => m.species === "magpie")
				.map((m) => m.portalId)
				.sort();

		const untracked = await both(dir);
		expect(magpiesOn(untracked.delta)).toEqual([".github/deploy.yml"]);

		const tracked = await both(dir, new Set([".env"]));
		expect(magpiesOn(tracked.delta)).toEqual([".env", ".github/deploy.yml"]);
		// LeakedSecret isn't a world.json code: it rides in extendedMonsters, like monsters.json.
		expect(
			tracked.delta.extendedMonsters.some((m) => m.portalId === ".env"),
		).toBe(true);
	});

	test("keeps only monsters on hidden portals or shadow paths", async () => {
		const dir = await fixture({
			"src/todo.ts": "// TODO: visible\nexport const a = 1;\n",
			".scripts/todo.ts": "// TODO: hidden\nexport const b = 2;\n",
		});
		const { base, delta } = await both(dir);
		expect(base.monsters.map((m) => m.portalId)).toContain("src/todo.ts");
		const all = [...delta.monsters, ...delta.extendedMonsters];
		expect(all.length).toBeGreaterThan(0);
		for (const m of all) expect(m.portalId).toBe(".scripts/todo.ts");
	});

	test("a stale delta is refused", async () => {
		const dir = await fixture(PROJECT);
		const { base, delta } = await both(dir);
		const moved = {
			...base,
			meta: { ...base.meta, generatedAt: "2027-01-01T00:00:00.000Z" },
		};
		expect(worldLayerIssues(moved, delta)[0]).toMatch(/stale/);
	});

	test("a world with no hidden files yields an empty delta", async () => {
		const dir = await fixture({ "a.ts": "export {};\n" });
		const { delta } = await both(dir);
		expect(delta.clusters).toEqual([]);
		expect(delta.portals).toEqual([]);
		expect(delta.paths).toEqual([]);
	});
});
