import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	assetUrl,
	DEFAULT_ASSET_BASE_URL,
	getAssetBaseUrl,
	propPath,
	setAssetBaseUrl,
	uiIconPath,
} from "../src/assetPaths.js";
import { createCabnStore } from "../src/bridge/store.js";

afterEach(() => setAssetBaseUrl(undefined));

describe("assetUrl", () => {
	test("is the identity under the default base", () => {
		expect(getAssetBaseUrl()).toBe(DEFAULT_ASSET_BASE_URL);
		expect(assetUrl(uiIconPath("orb"))).toBe(uiIconPath("orb"));
	});

	test("rewrites the canonical /assets prefix to the configured base", () => {
		setAssetBaseUrl("https://cdn.example.org/cabn/v1/");
		expect(assetUrl(propPath("well"))).toBe(
			"https://cdn.example.org/cabn/v1/placeholders/prop_well_soft.png",
		);
		setAssetBaseUrl("/static/cabn");
		expect(assetUrl(uiIconPath("orb"))).toBe(
			"/static/cabn/placeholders/ui_icon_orb_soft.png",
		);
	});

	test("leaves anything outside /assets/ alone", () => {
		setAssetBaseUrl("/static/cabn");
		expect(assetUrl("blob:abc")).toBe("blob:abc");
		expect(assetUrl("/assetsx/a.png")).toBe("/assetsx/a.png");
		expect(assetUrl("worlds/a/media/x.png")).toBe("worlds/a/media/x.png");
	});

	test("undefined resets to the default", () => {
		setAssetBaseUrl("/x");
		setAssetBaseUrl(undefined);
		expect(getAssetBaseUrl()).toBe("/assets");
	});
});

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

/** The second top-level argument of each `load.image(`/`load.spritesheet(` call. */
function loadPathArgs(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/load\.(?:image|spritesheet)\(/g)) {
		let depth = 0;
		let arg = 0;
		let start = -1;
		for (let i = (m.index ?? 0) + m[0].length; i < text.length; i++) {
			const c = text[i] as string;
			if ("([{".includes(c)) depth++;
			else if (")]}".includes(c)) {
				if (depth === 0) {
					if (arg === 1) out.push(text.slice(start, i).trim());
					break;
				}
				depth--;
			} else if (c === "," && depth === 0) {
				if (arg === 1) {
					out.push(text.slice(start, i).trim());
					break;
				}
				arg++;
				start = i + 1;
			}
		}
	}
	return out;
}

describe("every sprite load goes through assetUrl", () => {
	// A Phaser load with a bare canonical path would ignore CabnGame's
	// assetBaseUrl and 404 on a host serving the sprites elsewhere.
	test("load.image/load.spritesheet never take an unwrapped path", () => {
		const src = join(import.meta.dirname, "..", "src");
		const offenders: string[] = [];
		let seen = 0;
		for (const file of sourceFiles(src)) {
			for (const arg of loadPathArgs(readFileSync(file, "utf8"))) {
				seen++;
				if (!arg.startsWith("assetUrl("))
					offenders.push(`${relative(src, file)}: ${arg}`);
			}
		}
		expect(seen).toBeGreaterThan(20);
		expect(offenders).toEqual([]);
	});
});

describe("petsEnabled", () => {
	test("defaults to true and is settable", () => {
		const store = createCabnStore();
		expect(store.getState().petsEnabled).toBe(true);
		store.getState().setPetsEnabled(false);
		expect(store.getState().petsEnabled).toBe(false);
	});
});
