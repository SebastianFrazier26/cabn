import { describe, expect, it } from "vitest";
import {
	PROP_NAMES,
	type PropName,
	SCENERY_NAMES,
	SKYLINE_PIECES,
	type SkylinePiece,
} from "../src/assetPaths.js";
import { createCabnStore } from "../src/bridge/store.js";
import { createShadowLayer } from "../src/shadow/provider.js";
import { NETHER_SKIN } from "../src/shadow/skin.js";
import { FILLER_KINDS, POI_KINDS } from "../src/systems/edgeScenery.js";
import {
	resolveTimeOfDay,
	type TimeOfDayOverride,
} from "../src/systems/timeOfDay.js";
import {
	DEFAULT_SKIN,
	resolveSkin,
	resolveSkinTimeOfDay,
	type SkinSceneryKind,
} from "../src/systems/worldLayer.js";

const OVERRIDES: TimeOfDayOverride[] = ["auto", "day", "night"];
const NOON = new Date(2026, 8, 29, 12);
const MIDNIGHT = new Date(2026, 8, 29, 0);

describe("a skin's fixed time of day", () => {
	it("overrides the player's setting and the clock", () => {
		for (const override of OVERRIDES)
			for (const now of [NOON, MIDNIGHT])
				expect(resolveSkinTimeOfDay(NETHER_SKIN, override, now)).toBe("day");
		expect(resolveSkinTimeOfDay({ fixedTimeOfDay: "night" }, "day", NOON)).toBe(
			"night",
		);
	});

	it("DEFAULT_SKIN (or no skin) leaves day/night exactly as before", () => {
		expect(DEFAULT_SKIN.fixedTimeOfDay).toBeNull();
		expect(DEFAULT_SKIN.dayGlowStrength).toBeNull();
		expect(DEFAULT_SKIN.props).toBeNull();
		expect(DEFAULT_SKIN.skyline).toBeNull();
		for (const override of OVERRIDES)
			for (const now of [NOON, MIDNIGHT]) {
				const expected = resolveTimeOfDay(override, now);
				expect(resolveSkinTimeOfDay(DEFAULT_SKIN, override, now)).toBe(
					expected,
				);
				expect(resolveSkinTimeOfDay(null, override, now)).toBe(expected);
			}
	});

	it("the pin survives resolveSkin even when every texture failed", () => {
		const resolved = resolveSkin(NETHER_SKIN, () => false);
		expect(resolved.fixedTimeOfDay).toBe("day");
		expect(resolved.props).toEqual({});
		expect(resolved.skyline).toEqual({});
		expect(resolved.scenery).toEqual({});
		expect(resolveSkin(DEFAULT_SKIN, () => false)).toBe(DEFAULT_SKIN);
	});

	it("the store shows the pin while the layer is active, and the setting again once it's off", () => {
		const store = createCabnStore();
		store
			.getState()
			.setWorldLayers([createShadowLayer({ baseUrl: "", token: "t" })]);
		store.getState().setTimeOfDayOverride("night");
		expect(store.getState().timeOfDay).toBe("night");

		store.getState().setActiveLayer("shadow");
		expect(store.getState().timeOfDay).toBe("day");
		expect(store.getState().timeOfDayOverride).toBe("night");
		store.getState().setTimeOfDayOverride("night");
		store.getState().refreshTimeOfDay();
		expect(store.getState().timeOfDay).toBe("day");

		store.getState().setActiveLayer(null);
		expect(store.getState().timeOfDay).toBe("night");

		store.getState().setTimeOfDayPin("day");
		expect(store.getState().timeOfDay).toBe("day");
		store.getState().clearWorldContext();
		expect(store.getState().timeOfDayPin).toBeNull();
		expect(store.getState().timeOfDay).toBe("night");

		store.getState().setActiveLayer("shadow");
		store.getState().setWorldLayers([]);
		expect(store.getState().timeOfDay).toBe("night");
	});
});

/**
 * Pieces that may stay un-redrawn in the realm (and so fall back to the
 * scatter tint). Empty on purpose: the tint is what left the green art
 * olive, so a new prop or scenery kind must bring a nether variant or be
 * listed here with a reason.
 */
const EXEMPT = new Set<string>([]);

describe("every piece a world can place has a nether variant", () => {
	const isNether = (key: string | undefined) => key?.startsWith("shadow-");

	it("clearing props", () => {
		const missing = PROP_NAMES.filter(
			(name: PropName) =>
				!EXEMPT.has(name) && !isNether(NETHER_SKIN.props?.[name]?.key),
		);
		expect(missing).toEqual([]);
	});

	it("edge scenery, points of interest and the windmill's sails", () => {
		const placed: SkinSceneryKind[] = [
			...FILLER_KINDS,
			...POI_KINDS.filter((k) => k !== "mushroom-ring"),
			"mushroom",
			"windmill-sails",
		];
		expect([...placed].sort()).toEqual([...SCENERY_NAMES].sort());
		const missing = placed.filter(
			(kind) =>
				!EXEMPT.has(kind) && !isNether(NETHER_SKIN.scenery?.[kind]?.key),
		);
		expect(missing).toEqual([]);
	});

	it("skyline pieces", () => {
		const missing = SKYLINE_PIECES.filter(
			(piece: SkylinePiece) =>
				!EXEMPT.has(piece) && !isNether(NETHER_SKIN.skyline?.[piece]?.key),
		);
		expect(missing).toEqual([]);
	});

	it("the realm's own lights keep glowing through its pinned day", () => {
		expect(NETHER_SKIN.fixedTimeOfDay).toBe("day");
		expect(NETHER_SKIN.dayGlowStrength).toBeGreaterThan(0);
		expect(NETHER_SKIN.dayGlowStrength).toBeLessThanOrEqual(1);
	});
});
