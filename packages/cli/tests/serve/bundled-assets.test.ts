import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// assetPaths.ts isn't part of @cabn/engine's public "exports" map (no
// consumer outside the engine needs these paths) — imported by relative
// source path instead, monorepo-internal test coupling only, not a public
// API addition.
import {
	ANIMATED_MONSTER_SPECIES,
	ASSET_PATHS,
	BONFIRE_FRAME_COUNT,
	MONSTER_GHOST_PATH,
	monsterFramePath,
	OPTIONAL_ASSET_PATHS,
} from "../../../engine/src/assetPaths.js";
import { ORIGINALS, PLACEHOLDERS } from "../../scripts/copy-assets.mjs";

const REPO_ASSETS = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"assets",
	"generated",
);

/** "/assets/placeholders/foo.png" -> ["placeholders", "foo.png"]. */
function splitAssetPath(path: string): [subdir: string, file: string] {
	const parts = path.replace(/^\/assets\//, "").split("/");
	const file = parts.pop();
	if (!file || parts.length !== 1) {
		throw new Error(`unexpected asset path shape: ${path}`);
	}
	return [parts[0] as string, file];
}

// Every path @cabn/engine can request at runtime — if a new sprite gets added
// to assetPaths.ts and nobody updates copy-assets.mjs's fixed list, a
// published `@cabn/cli` silently loses that sprite (falls back to a tinted
// placeholder) with no build-time signal. This test is that signal.
function allRuntimeAssetPaths(): string[] {
	const paths = [
		...Object.values(ASSET_PATHS),
		...Object.values(OPTIONAL_ASSET_PATHS).filter(
			(v): v is string => typeof v === "string",
		),
		MONSTER_GHOST_PATH,
	];
	for (const species of ANIMATED_MONSTER_SPECIES) {
		paths.push(monsterFramePath(species, 0), monsterFramePath(species, 1));
	}
	for (let i = 0; i < BONFIRE_FRAME_COUNT; i++) {
		paths.push(OPTIONAL_ASSET_PATHS.bonfireFrame(i));
	}
	return paths;
}

describe("copy-assets.mjs bundle list", () => {
	test("covers every sprite path @cabn/engine's PreloadScene can request", () => {
		const bundled = { originals: ORIGINALS, placeholders: PLACEHOLDERS };
		const missing: string[] = [];
		for (const path of allRuntimeAssetPaths()) {
			const [subdir, file] = splitAssetPath(path);
			const list = bundled[subdir as keyof typeof bundled];
			if (!list?.includes(file)) missing.push(path);
		}
		expect(missing).toEqual([]);
	});

	test("every listed file actually exists in assets/generated", () => {
		const missing: string[] = [];
		for (const file of ORIGINALS) {
			if (!existsSync(join(REPO_ASSETS, "originals", file))) missing.push(file);
		}
		for (const file of PLACEHOLDERS) {
			if (!existsSync(join(REPO_ASSETS, "placeholders", file)))
				missing.push(file);
		}
		expect(missing).toEqual([]);
	});
});
