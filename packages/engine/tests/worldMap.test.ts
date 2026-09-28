import type { WorldManifest } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	mapProjection,
	summarizeWorldMap,
	type WorldMapSummary,
} from "../src/systems/worldMap.js";

const empty: WorldMapSummary = {
	name: "Empty",
	clusters: [],
	paths: [],
	portals: [],
	monsters: [],
};

describe("world map geometry", () => {
	it("projects an empty world without NaN and keeps remote players at the edge", () => {
		const point = mapProjection(empty, 200, 140)({ x: 0, y: 0 });
		expect(point).toEqual({ x: 100, y: 70 });
		const single = {
			...empty,
			clusters: [{ id: "one", label: "One", pos: { x: 0, y: 0 } }],
		};
		expect(mapProjection(single, 200, 140)({ x: 0, y: 0 })).toEqual(point);
		expect(mapProjection(empty, 200, 140)({ x: 10000, y: -10000 })).toEqual({
			x: 192,
			y: 8,
		});
	});
	it("preserves proportions with negative coordinates and fits all markers", () => {
		const map = {
			...empty,
			clusters: [
				{ id: "a", label: "a", pos: { x: -500, y: -50 } },
				{ id: "b", label: "b", pos: { x: 500, y: 50 } },
			],
		};
		const project = mapProjection(map, 720, 400);
		const a = project({ x: -500, y: -50 });
		const b = project({ x: 500, y: 50 });
		expect((b.x - a.x) / (b.y - a.y)).toBeCloseTo(10);
		for (const p of [a, b]) {
			expect(p.x).toBeGreaterThan(16);
			expect(p.x).toBeLessThan(704);
			expect(p.y).toBeGreaterThan(16);
			expect(p.y).toBeLessThan(384);
		}
	});
	it("copies portal anchors, resolves path monsters and skips absent references", () => {
		const manifest = {
			meta: { name: "Test" },
			clusters: [
				{ id: "a", label: "A", pos: { x: 0, y: 0 } },
				{ id: "b", label: "B", pos: { x: 100, y: 80 } },
			],
			paths: [
				{ from: "a", to: "b", kind: "directory" },
				{ from: "missing", to: "a", kind: "directory" },
			],
			portals: [
				{ id: "file", file: { path: "a.ts" } },
				{ id: "missing", file: { path: "missing.ts" } },
			],
			monsters: [
				{
					id: "portal",
					portalId: "file",
					species: "ghost",
					error: { message: "bug" },
				},
				{
					id: "path",
					pathId: "a::b",
					species: "ouroboros",
					error: { message: "cycle" },
				},
				{ id: "invalid", pathId: "a::missing", error: {} },
			],
		} as unknown as WorldManifest;
		const anchor = { x: 20, y: 30 };
		const map = summarizeWorldMap(manifest, new Map([["file", anchor]]));
		expect(map.paths).toHaveLength(1);
		expect(map.portals).toHaveLength(1);
		expect(map.monsters.map((m) => m.pos)).toEqual([
			{ x: 20, y: 30 },
			{ x: 50, y: 40 },
		]);
		anchor.x = 999;
		expect(map.portals[0]?.pos.x).toBe(20);
	});
});

describe("world map lifecycle", () => {
	it("requires world geometry, closes on file entry, replaces geometry and clears visited history", () => {
		const store = createCabnStore();
		store.getState().setMapOpen(true);
		expect(store.getState().mapOpen).toBe(false);
		store.getState().setWorldMap(empty);
		store.getState().setGuideOpen(true);
		store.getState().setMapOpen(true);
		expect(store.getState().mapOpen).toBe(false);
		store.getState().setGuideOpen(false);
		store.getState().setVisitedClusterIds(["old"]);
		store.getState().setMapOpen(true);
		expect(store.getState().mapOpen).toBe(true);
		store.getState().enterPortal("file", "unsaved");
		expect(store.getState().mapOpen).toBe(false);
		store.getState().setMapOpen(true);
		expect(store.getState().mapOpen).toBe(false);
		store.getState().setWorldMap({ ...empty, name: "Next" });
		expect(store.getState().visitedClusterIds).toEqual([]);
		store.getState().setTimeOfDayOverride("night");
		const buffer = store.getState().activeFileState;
		store.getState().clearWorldContext();
		expect(store.getState().worldMap).toBeNull();
		expect(store.getState().activeFileState).toBe(buffer);
		expect(store.getState().timeOfDayOverride).toBe("night");
	});
});
