import { stat } from "node:fs/promises";

export const SHADOW_ART_HINT =
	"cabn serve: install @cabn/shadow-art for the full nether look (npm i -g @cabn/shadow-art, or beside @cabn/cli). The shadow realm works without it, tint only.";

async function isDir(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Where `cabn serve --owner` reads `/assets/shadow/*` from: the optional
 * `@cabn/shadow-art` package when it's installed and built, else this
 * monorepo's `assets/generated/shadow/`, else nowhere (the engine's
 * resolveSkin then drops every texture group and the realm shows tint only).
 * The art is a separate package so a default `@cabn/cli` install doesn't
 * carry ~14MB that only owner mode uses.
 */
export async function resolveShadowArtDir(
	repoShadowDir: string,
): Promise<string | undefined> {
	try {
		const { shadowAssetsDir } = await import("@cabn/shadow-art");
		if (await isDir(shadowAssetsDir)) return shadowAssetsDir;
	} catch {
		// Not installed: an optional peer dependency.
	}
	return (await isDir(repoShadowDir)) ? repoShadowDir : undefined;
}
