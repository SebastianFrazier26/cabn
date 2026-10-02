import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// Monorepo-internal coupling to the engine's source, as in the cli's
// bundled-assets.test.ts: these modules aren't in @cabn/engine's exports map.
import { SUDO_ICON_PATH } from "../../engine/src/shadow/assets.js";
import * as shadowSkin from "../../engine/src/shadow/skin.js";
import { shadowAssetsDir } from "../index.js";
import { SHADOW } from "../scripts/copy-shadow.mjs";

const REPO_SHADOW = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"shadow",
);

const isAssetPath = (v: unknown): v is string =>
	typeof v === "string" && v.startsWith("/assets/");

function walkAssetPaths(value: unknown, out: string[]): void {
	if (isAssetPath(value)) out.push(value);
	else if (Array.isArray(value)) for (const v of value) walkAssetPaths(v, out);
	else if (value && typeof value === "object")
		for (const v of Object.values(value)) walkAssetPaths(v, out);
}

describe("@cabn/shadow-art", () => {
	test("covers every texture the shadow skins name", () => {
		const found: string[] = [SUDO_ICON_PATH];
		walkAssetPaths(Object.values(shadowSkin), found);
		const paths = [...new Set(found)];
		expect(paths.length).toBeGreaterThan(15);
		const missing = paths.filter((path) => {
			const match = /^\/assets\/shadow\/([^/]+)$/.exec(path);
			return !match || !SHADOW.includes(match[1] as string);
		});
		expect(missing).toEqual([]);
	});

	test("every listed file exists in assets/generated/shadow", () => {
		expect(SHADOW.filter((f) => !existsSync(join(REPO_SHADOW, f)))).toEqual([]);
	});

	test("the entry exports the built art directory", () => {
		expect(shadowAssetsDir).toBe(
			join(import.meta.dirname, "..", "dist", "shadow"),
		);
		// `pnpm -r build` runs before `pnpm -r test`; a lone test run may not have built.
		if (existsSync(shadowAssetsDir)) {
			expect(
				SHADOW.filter((f) => !existsSync(join(shadowAssetsDir, f))),
			).toEqual([]);
		}
	});
});
