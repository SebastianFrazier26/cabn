import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// assetPaths.ts isn't part of @cabn/engine's public "exports" map (no
// consumer outside the engine needs these paths) — imported by relative
// source path instead, monorepo-internal test coupling only, not a public
// API addition.
import * as assetPaths from "../../../engine/src/assetPaths.js";
import {
	ANIMATED_MONSTER_SPECIES,
	BATTLE_FX_MONSTER_SPECIES,
	BONFIRE_FRAME_COUNT,
	MONSTER_DEFEAT_FRAME_COUNT,
	PATH_COBBLE_COUNT,
	PATH_STAMP_COUNT,
	PROP_NAMES,
	SCENERY_NAMES,
	SKYLINE_PIECES,
	UI_ICON_NAMES,
	UI_SCREEN_NAMES,
	UI_SPARKLE_COLORS,
	UI_TOOL_ICON_NAMES,
	WORLD_ART_BIOMES,
} from "../../../engine/src/assetPaths.js";
import { PET_PROVIDERS } from "../../../engine/src/pets/providers.js";
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

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const petSpecies = [
	...new Set(Object.values(PET_PROVIDERS).map((p) => p.species)),
];

// A path helper takes an argument, so the test can't call it blind: each one
// needs the engine domain it's called over. Keyed by export name so a new
// `fooPath(x)` export with no entry here fails the "every path helper" test
// below instead of silently going unchecked.
const PATH_HELPER_DOMAINS: Record<string, () => string[]> = {
	monsterFramePath: () =>
		ANIMATED_MONSTER_SPECIES.flatMap((s) => [
			assetPaths.monsterFramePath(s, 0),
			assetPaths.monsterFramePath(s, 1),
		]),
	monsterHitPath: () =>
		BATTLE_FX_MONSTER_SPECIES.map((s) => assetPaths.monsterHitPath(s)),
	monsterDefeatPath: () =>
		BATTLE_FX_MONSTER_SPECIES.flatMap((s) =>
			range(MONSTER_DEFEAT_FRAME_COUNT).map((i) =>
				assetPaths.monsterDefeatPath(s, i),
			),
		),
	biomeTileSheetPath: () =>
		WORLD_ART_BIOMES.map((b) => assetPaths.biomeTileSheetPath(b)),
	pathStampPath: () =>
		range(PATH_STAMP_COUNT).map((i) => assetPaths.pathStampPath(i)),
	propPath: () => PROP_NAMES.map((n) => assetPaths.propPath(n)),
	petStripPath: () => petSpecies.map((s) => assetPaths.petStripPath(s)),
	petPortraitPath: () => petSpecies.map((s) => assetPaths.petPortraitPath(s)),
	uiIconPath: () => UI_ICON_NAMES.map((n) => assetPaths.uiIconPath(n)),
	uiToolIconPath: () =>
		UI_TOOL_ICON_NAMES.map((n) => assetPaths.uiToolIconPath(n)),
	uiScreenPath: () => UI_SCREEN_NAMES.map((n) => assetPaths.uiScreenPath(n)),
	uiSparklePath: () =>
		UI_SPARKLE_COLORS.map((c) => assetPaths.uiSparklePath(c)),
	sceneryPath: () => SCENERY_NAMES.map((n) => assetPaths.sceneryPath(n)),
	skylinePath: () =>
		SKYLINE_PIECES.flatMap((p) => [
			assetPaths.skylinePath(p, "day"),
			assetPaths.skylinePath(p, "night"),
		]),
	pathCobblePath: () =>
		range(PATH_COBBLE_COUNT).map((i) => assetPaths.pathCobblePath(i)),
	"OPTIONAL_ASSET_PATHS.bonfireFrame": () =>
		range(BONFIRE_FRAME_COUNT).map((i) =>
			assetPaths.OPTIONAL_ASSET_PATHS.bonfireFrame(i),
		),
};

const isAssetPath = (v: unknown): v is string =>
	typeof v === "string" && v.startsWith("/assets/");

/**
 * Walks every export of assetPaths.ts rather than naming paths by hand: plain
 * "/assets/..." strings, objects of them (ASSET_PATHS, OPTIONAL_ASSET_PATHS),
 * no-arg `*Entries()` helpers, and every path helper via PATH_HELPER_DOMAINS.
 * Returns path helpers it had no domain for, so a new one can't slip by.
 */
function allRuntimeAssetPaths(): { paths: string[]; unknownHelpers: string[] } {
	const paths: string[] = [];
	const unknownHelpers: string[] = [];
	const helper = (name: string) => {
		const domain = PATH_HELPER_DOMAINS[name];
		if (domain) paths.push(...domain());
		else unknownHelpers.push(name);
	};
	for (const [name, value] of Object.entries(assetPaths)) {
		if (isAssetPath(value)) {
			paths.push(value);
		} else if (typeof value === "function") {
			if (name.endsWith("Path")) helper(name);
			else if (name.endsWith("Entries")) {
				for (const [, path] of (value as () => [string, string][])()) {
					paths.push(path);
				}
			}
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const [key, inner] of Object.entries(value)) {
				if (isAssetPath(inner)) paths.push(inner);
				else if (typeof inner === "function" && name.endsWith("_PATHS")) {
					helper(`${name}.${key}`);
				}
			}
		}
	}
	return { paths: [...new Set(paths)], unknownHelpers };
}

describe("copy-assets.mjs bundle list", () => {
	test("every path helper in assetPaths.ts has a known argument domain", () => {
		expect(allRuntimeAssetPaths().unknownHelpers).toEqual([]);
	});

	test("the engine walk finds the hotbar icons (sanity check on the walk itself)", () => {
		const { paths } = allRuntimeAssetPaths();
		for (const name of UI_ICON_NAMES) {
			expect(paths).toContain(assetPaths.uiIconPath(name));
		}
	});

	test("covers every sprite path @cabn/engine can request", () => {
		const bundled = { originals: ORIGINALS, placeholders: PLACEHOLDERS };
		const missing: string[] = [];
		for (const path of allRuntimeAssetPaths().paths) {
			const [subdir, file] = splitAssetPath(path);
			const list = bundled[subdir as keyof typeof bundled];
			if (!list?.includes(file)) missing.push(path);
		}
		expect(missing).toEqual([]);
	});

	// The shadow skin's own coverage lives in packages/shadow-art's tests.
	test("nothing shadow is in the main bundle list", () => {
		expect(
			allRuntimeAssetPaths().paths.filter((p) => p.includes("/shadow/")),
		).toEqual([]);
		expect(
			[...ORIGINALS, ...PLACEHOLDERS].filter((f) => f.includes("nether")),
		).toEqual([]);
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
