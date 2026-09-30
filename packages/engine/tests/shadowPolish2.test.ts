import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	BATTLE_FX_MONSTER_SPECIES,
	MONSTER_DEFEAT_FRAME_COUNT,
	MONSTER_GHOST_PATH,
	monsterDefeatPath,
	monsterFramePath,
	monsterHitPath,
	UI_ICON_NAMES,
	UI_TOOL_ICON_NAMES,
	uiIconPath,
	uiToolIconPath,
} from "../src/assetPaths.js";
import { NETHER_SKIN } from "../src/shadow/skin.js";
import {
	DEFAULT_SKIN,
	resolveSkin,
	skinMonsterAnims,
	skinTextures,
} from "../src/systems/worldLayer.js";

vi.mock("phaser", () => ({
	default: { Math: { Easing: { Linear: (v: number) => v } } },
}));
const { addWindmillSails } = await import("../src/render/sceneryBaker.js");

const GENERATED = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"assets",
	"generated",
);

/** A PNG's width and height, straight from its IHDR chunk. */
function pngSize(assetPath: string): [number, number] {
	const file = join(GENERATED, assetPath.replace(/^\/assets\//, ""));
	const data = readFileSync(file);
	return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

describe("nether monsters", () => {
	const monsters = NETHER_SKIN.monsters ?? {};

	it("every species has a swap, frame for frame the size of its normal art", () => {
		expect(Object.keys(monsters).sort()).toEqual(
			[...BATTLE_FX_MONSTER_SPECIES].sort(),
		);
		expect(Object.keys(monsters)).toHaveLength(11);
		for (const species of BATTLE_FX_MONSTER_SPECIES) {
			const art = monsters[species];
			if (!art) throw new Error(species);
			const normalIdle =
				species === "ghost"
					? [MONSTER_GHOST_PATH]
					: [monsterFramePath(species, 0), monsterFramePath(species, 1)];
			expect(
				art.idle.map((t) => pngSize(t.path)),
				species,
			).toEqual(normalIdle.map(pngSize));
			expect(pngSize(art.hit.path), species).toEqual(
				pngSize(monsterHitPath(species)),
			);
			expect(art.defeat).toHaveLength(MONSTER_DEFEAT_FRAME_COUNT);
			expect(
				art.defeat.map((t) => pngSize(t.path)),
				species,
			).toEqual(
				art.defeat.map((_, i) => pngSize(monsterDefeatPath(species, i))),
			);
		}
	});

	it("uses its own texture and animation keys, never the normal ones", () => {
		const keys = Object.values(monsters).flatMap((m) =>
			m ? [...m.idle, m.hit, ...m.defeat].map((t) => t.key) : [],
		);
		expect(new Set(keys).size).toBe(keys.length);
		for (const key of keys) expect(key.startsWith("monster-")).toBe(false);
		const ghost = monsters.ghost;
		const imp = monsters.imp;
		if (!ghost || !imp) throw new Error("missing");
		expect(skinMonsterAnims(ghost).idle).toBeNull();
		expect(skinMonsterAnims(imp).idle).toMatch(/:idle$/);
		expect(skinTextures(NETHER_SKIN).map((t) => t.key)).toEqual(
			expect.arrayContaining(keys),
		);
	});

	it("a species whose art failed to load falls back to its normal look, alone", () => {
		const failed = monsters.bramble?.hit.key;
		const resolved = resolveSkin(NETHER_SKIN, (key) => key !== failed);
		expect(resolved.monsters?.bramble).toBeUndefined();
		expect(Object.keys(resolved.monsters ?? {})).toHaveLength(10);
	});
});

describe("the windmill under the skin", () => {
	function fakeScene() {
		const tweens: unknown[] = [];
		const image = { setDepth: () => image, setTint: () => image };
		return {
			tweens,
			scene: {
				add: { image: () => image },
				tweens: { add: (t: unknown) => tweens.push(t) },
			},
		};
	}

	it("the nether skin holds the sails still; the normal world lets them turn", () => {
		expect(NETHER_SKIN.stillScenery).toContain("windmill-sails");
		expect(DEFAULT_SKIN.stillScenery).toBeNull();
		const still = fakeScene();
		addWindmillSails(still.scene as never, 0, 0, 90, 1, true);
		expect(still.tweens).toHaveLength(0);
		const turning = fakeScene();
		addWindmillSails(turning.scene as never, 0, 0, 90, 1, false);
		expect(turning.tweens).toHaveLength(1);
	});
});

describe("crimson HUD icons", () => {
	const icons = NETHER_SKIN.uiIcons ?? {};
	const normal = new Set<string>([
		...UI_ICON_NAMES.map(uiIconPath),
		...UI_TOOL_ICON_NAMES.map(uiToolIconPath),
	]);

	it("swaps exactly the icons drawn with green, Replace included, for same-size variants", () => {
		expect(Object.keys(icons).sort()).toEqual(
			[
				uiToolIconPath("replace"),
				uiToolIconPath("goto"),
				...(
					[
						"orb",
						"spyglass",
						"bag",
						"quill",
						"wand",
						"key",
						"sign",
						"owner",
					] as const
				).map(uiIconPath),
			].sort(),
		);
		for (const [from, to] of Object.entries(icons)) {
			expect(normal.has(from), from).toBe(true);
			expect(to.startsWith("/assets/shadow/"), to).toBe(true);
			expect(pngSize(to), to).toEqual(pngSize(from));
		}
	});
});

describe("DEFAULT_SKIN", () => {
	it("sets the new fields to null", () => {
		expect(DEFAULT_SKIN.monsters).toBeNull();
		expect(DEFAULT_SKIN.stillScenery).toBeNull();
		expect(DEFAULT_SKIN.uiIcons).toBeNull();
		expect(resolveSkin(DEFAULT_SKIN, () => false)).toBe(DEFAULT_SKIN);
	});
});
