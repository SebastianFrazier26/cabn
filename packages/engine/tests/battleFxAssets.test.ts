import { describe, expect, test } from "vitest";
import {
	ANIMATED_MONSTER_SPECIES,
	BATTLE_FX_MONSTER_SPECIES,
	MONSTER_DEFEAT_FRAME_COUNT,
	monsterDefeatKey,
	monsterDefeatPath,
	monsterFramePath,
	monsterHitKey,
	monsterHitPath,
} from "../src/assetPaths.js";

describe("monster battle frame assets", () => {
	test("every species with art, ghost included, gets battle frames", () => {
		expect(new Set(BATTLE_FX_MONSTER_SPECIES)).toEqual(
			new Set(["ghost", ...ANIMATED_MONSTER_SPECIES]),
		);
	});

	test("paths share the idle frames' file slug", () => {
		expect(monsterHitPath("will-o-wisp")).toBe(
			"/assets/placeholders/will_o_wisp_hit_soft.png",
		);
		expect(monsterDefeatPath("rot-sprite", 2)).toBe(
			"/assets/placeholders/rot_sprite_defeat2_soft.png",
		);
		expect(monsterFramePath("rot-sprite", 0).replace("idle0", "defeat0")).toBe(
			monsterDefeatPath("rot-sprite", 0),
		);
		expect(monsterHitPath("ghost")).toBe(
			"/assets/placeholders/ghost_hit_soft.png",
		);
	});

	test("keys are unique across species and frames", () => {
		const keys = BATTLE_FX_MONSTER_SPECIES.flatMap((s) => [
			monsterHitKey(s),
			...Array.from({ length: MONSTER_DEFEAT_FRAME_COUNT }, (_, i) =>
				monsterDefeatKey(s, i),
			),
		]);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
