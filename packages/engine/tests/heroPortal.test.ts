import { HERO_ROOT_MIN_RING_RADIUS_PX as CONVERTER_HERO_RING } from "@cabn/converter/browser";
import { describe, expect, test } from "vitest";
import { PORTAL_ARCH_FRAME_SIZE } from "../src/assetPaths.js";
import {
	BONFIRE_RAW_SIZE_PX,
	BONFIRE_SCALE,
	WORLD_PORTAL_SCALE,
} from "../src/render/scale.js";
import {
	HERO_HUB_DISTANCE_PX,
	HERO_ROOT_MIN_RING_RADIUS_PX,
	HERO_SPAWN_GAP_PX,
	heroAngle,
	heroPosition,
	heroSpawnPosition,
	resolveHeroPortalId,
} from "../src/systems/heroPortal.js";
import { layoutPortalRing } from "../src/systems/portalRing.js";

const PORTAL_ARCH_DISPLAY_SIZE = PORTAL_ARCH_FRAME_SIZE * WORLD_PORTAL_SCALE;
const SPAWN_OFFSET = (BONFIRE_RAW_SIZE_PX * BONFIRE_SCALE) / 2 + 24;

describe("hero portal placement", () => {
	test("hub distance is spawn offset plus the spawn gap; ring clearance is one arch", () => {
		expect(HERO_ROOT_MIN_RING_RADIUS_PX - HERO_HUB_DISTANCE_PX).toBe(
			PORTAL_ARCH_DISPLAY_SIZE,
		);
		// The converter sizes the root clearing with its own copy.
		expect(CONVERTER_HERO_RING).toBe(HERO_ROOT_MIN_RING_RADIUS_PX);
		expect(HERO_HUB_DISTANCE_PX).toBeCloseTo(
			SPAWN_OFFSET + HERO_SPAWN_GAP_PX,
			0,
		);
	});

	test("a fresh spawn is in live-page range of the hero but outside the dock's focus", () => {
		const hub = { x: 10, y: -20 };
		for (const angle of [0, 1, -2.5, Math.PI]) {
			const hero = heroPosition(hub, angle);
			const spawn = heroSpawnPosition(hub, angle, SPAWN_OFFSET);
			const d = Math.hypot(hero.x - spawn.x, hero.y - spawn.y);
			expect(d).toBeLessThan(150);
			expect(d).toBeGreaterThan(100);
		}
	});

	test("defaults east and otherwise sits in the widest gap between paths", () => {
		expect(heroAngle([])).toBe(0);
		expect(heroAngle([Math.PI / 2, -Math.PI / 2 + 0.2])).toBeCloseTo(
			0.1 + Math.PI,
			5,
		);
	});

	test("the root ring never reaches the hero arch", () => {
		const sizes = {
			archSlotPx: PORTAL_ARCH_DISPLAY_SIZE,
			pathGatePx: PORTAL_ARCH_DISPLAY_SIZE / 2,
			minRadiusPx: HERO_ROOT_MIN_RING_RADIUS_PX,
		};
		for (const count of [0, 1, 5, 20]) {
			const ring = layoutPortalRing(count, [0.4, 2.2], sizes);
			expect(ring.radius - HERO_HUB_DISTANCE_PX).toBeGreaterThanOrEqual(
				PORTAL_ARCH_DISPLAY_SIZE,
			);
		}
	});

	test("only a hero that is really in the root cluster counts", () => {
		expect(resolveHeroPortalId("@cabn-site/a", ["@cabn-site/a", "x"])).toBe(
			"@cabn-site/a",
		);
		expect(resolveHeroPortalId("@cabn-site/a", ["x"])).toBeNull();
		expect(resolveHeroPortalId(null, ["x"])).toBeNull();
	});
});
