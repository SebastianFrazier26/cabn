import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { WorldManifest } from "@cabn/world-schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import { DirSource } from "../src/sources/dir.js";
import { isHiddenPath } from "../src/walk.js";

/**
 * Negative tests: nothing hidden ever reaches a normal world bundle — not a
 * path, not a byte of content. Each hidden file carries a unique canary.
 */
const CANARIES = {
	".github/ci.yml": "SHADOW_CANARY_GITHUB_7f3a",
	".vscode/settings.json": "SHADOW_CANARY_VSCODE_19c2",
	"src/.eslintrc.json": "SHADOW_CANARY_ESLINT_b04d",
	".env": "SHADOW_CANARY_ENV_5e61",
};
const HIDDEN_NAMES = [".github", ".vscode", ".eslintrc", ".env", ".assets"];

let dir: string;
let bundle: Map<string, Uint8Array | string>;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-canary-"));
	const files: Record<string, string | Uint8Array> = {
		"README.md": "# canary world\n",
		"src/app.ts": "export const app = 1;\n",
		"src/notes.seyn": "# a visible sign\n",
		".assets/logo.png": new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]),
		".github/notes.seyn": "# SHADOW_CANARY_SIGN_aa01\n",
	};
	for (const [path, canary] of Object.entries(CANARIES))
		files[path] = `value: ${canary}\n`;
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	bundle = await convert(new DirSource(dir), {
		name: "canary",
		source: "canary",
		now: () => new Date("2026-01-01T00:00:00.000Z"),
	});
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

const decoder = new TextDecoder();
const text = (v: Uint8Array | string) =>
	typeof v === "string" ? v : decoder.decode(v);

describe("shadow canary: a normal bundle carries nothing hidden", () => {
	test("the expected bundle files exist", () => {
		for (const key of [
			"world.json",
			"search-index.json",
			"signs.json",
			"monsters.json",
			"media.json",
		])
			expect(bundle.has(key), key).toBe(true);
		expect([...bundle.keys()].some((k) => k.startsWith("chunks/"))).toBe(true);
	});

	test("no key is hidden and no key or value holds a canary or hidden name", () => {
		for (const [key, value] of bundle) {
			expect(isHiddenPath(key), key).toBe(false);
			const body = text(value);
			for (const canary of [...Object.values(CANARIES), "SHADOW_CANARY"]) {
				expect(key).not.toContain(canary);
				expect(body, `${key} leaks ${canary}`).not.toContain(canary);
			}
			for (const name of HIDDEN_NAMES)
				expect(body, `${key} names ${name}`).not.toContain(name);
		}
	});

	test("every portal, cluster and sign path is visible", () => {
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		for (const p of manifest.portals) expect(isHiddenPath(p.id)).toBe(false);
		for (const c of manifest.clusters)
			expect(isHiddenPath(c.path === "." ? "" : c.path)).toBe(false);
		const signs = JSON.parse(bundle.get("signs.json") as string) as {
			signs: { path: string }[];
		};
		expect(signs.signs.map((s) => s.path)).toEqual(["src/notes.seyn"]);
		const media = JSON.parse(bundle.get("media.json") as string);
		expect(media.previews).toEqual({});
		expect([...bundle.keys()].some((k) => k.startsWith("media/"))).toBe(false);
	});
});

describe("import graph", () => {
	const SRC = join(import.meta.dirname, "..", "src");

	async function reachable(entry: string): Promise<Set<string>> {
		const seen = new Set<string>();
		const visit = async (file: string): Promise<void> => {
			const rel = relative(SRC, file);
			if (seen.has(rel)) return;
			seen.add(rel);
			const source = await readFile(file, "utf8");
			for (const m of source.matchAll(
				/(?:import|export)[^"']*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g,
			)) {
				const spec = m[1] ?? m[2];
				if (!spec) continue;
				await visit(join(dirname(file), spec.replace(/\.js$/, ".ts")));
			}
		};
		await visit(join(SRC, entry));
		return seen;
	}

	test("browser.ts cannot reach shadow.ts or shadowLayout.ts", async () => {
		const fromBrowser = await reachable("browser.ts");
		expect(fromBrowser.has("walk.ts")).toBe(true);
		expect(fromBrowser.has("shadow.ts")).toBe(false);
		expect(fromBrowser.has("shadowLayout.ts")).toBe(false);
	});

	test("the Node entry does export the shadow realm", async () => {
		const fromIndex = await reachable("index.ts");
		expect(fromIndex.has("shadow.ts")).toBe(true);
		expect(fromIndex.has("shadowLayout.ts")).toBe(true);
	});
});
