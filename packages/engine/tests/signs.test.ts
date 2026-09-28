import type { SignEntry } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import { footprintClear } from "../src/systems/edgeScenery.js";
import type { OwnerSignsApi } from "../src/systems/ownerSigns.js";
import {
	defaultSignSpot,
	isSafeSignUrl,
	isValidSignFileName,
	placeSign,
	resolveSignLink,
	SIGN_ARCH_KEEPOUT,
	type SignWorldGeometry,
	signKeepouts,
	standInFront,
	suggestSignPath,
} from "../src/systems/signs.js";
import { createDefaultTools, createSignTool } from "../src/systems/tools.js";

const FOOTPRINT = { w: 40, h: 64 };
const hub = { x: 0, y: 0 };
const arch = { x: 300, y: 0 };
const world: SignWorldGeometry = {
	arches: [arch, { x: -300, y: 0 }, { x: 0, y: -300 }],
	hubs: [hub],
	paths: [{ a: hub, b: { x: 0, y: 1000 } }],
	obstacles: [],
};

function input(
	offset: { x: number; y: number } | null,
	others: { x: number; y: number }[] = [],
) {
	const { circles, segments } = signKeepouts(world, others);
	return {
		anchor: arch,
		anchorKind: "portal" as const,
		hub,
		offset,
		circles,
		segments,
		footprint: FOOTPRINT,
		maxFromHub: 600,
	};
}

describe("placeSign", () => {
	test("default spot: beside the arch on the side away from the hub", () => {
		const spot = placeSign(input(null));
		expect(spot).toEqual(defaultSignSpot(arch, "portal", hub));
		expect(spot?.x).toBeGreaterThan(arch.x);
		expect(defaultSignSpot({ x: -300, y: 0 }, "portal", hub).x).toBeLessThan(
			-300,
		);
	});

	test("a clear @offset is honoured exactly", () => {
		expect(placeSign(input({ x: 130, y: -40 }))).toEqual({ x: 430, y: -40 });
	});

	test("an @offset on the arch or the path is moved to the nearest clear spot", () => {
		for (const offset of [
			{ x: 0, y: 0 },
			{ x: 0, y: 100 },
			{ x: -300, y: 200 },
		]) {
			const inp = input(offset);
			const spot = placeSign(inp);
			expect(spot, JSON.stringify(offset)).not.toBeNull();
			if (!spot) continue;
			expect(
				footprintClear(spot.x, spot.y, FOOTPRINT, inp.circles, inp.segments, 4),
			).toBe(true);
			expect(Math.hypot(spot.x - arch.x, spot.y - arch.y)).toBeGreaterThan(
				SIGN_ARCH_KEEPOUT,
			);
		}
	});

	test("never on the path corridor", () => {
		const inp = {
			...input({ x: -300, y: 300 }),
			anchor: hub,
			anchorKind: "cluster" as const,
		};
		const spot = placeSign(inp);
		expect(spot).not.toBeNull();
		expect(Math.abs(spot?.x ?? 0)).toBeGreaterThan(30);
	});

	test("keeps its distance from signs already standing", () => {
		const first = placeSign(input(null));
		expect(first).not.toBeNull();
		const second = placeSign(input(null, first ? [first] : []));
		expect(second).not.toBeNull();
		expect(second).not.toEqual(first);
		expect(
			Math.hypot(
				(second?.x ?? 0) - (first?.x ?? 0),
				(second?.y ?? 0) - (first?.y ?? 0),
			),
		).toBeGreaterThan(30);
	});

	test("stays inside the clearing and gives up rather than overlap", () => {
		const tight = { ...input(null), maxFromHub: 60 };
		expect(placeSign(tight)).toBeNull();
		const everywhere = {
			...input(null),
			circles: [{ x: arch.x, y: arch.y, radius: 5000 }],
		};
		expect(placeSign(everywhere)).toBeNull();
	});

	test("deterministic", () => {
		expect(placeSign(input({ x: 0, y: 0 }))).toEqual(
			placeSign(input({ x: 0, y: 0 })),
		);
	});
});

describe("suggestSignPath", () => {
	test("files, folders and the root", () => {
		const none = new Set<string>();
		expect(suggestSignPath({ kind: "file", path: "src/index.ts" }, none)).toBe(
			"src/index.seyn",
		);
		expect(suggestSignPath({ kind: "file", path: "README" }, none)).toBe(
			"README.seyn",
		);
		expect(suggestSignPath({ kind: "file", path: ".env" }, none)).toBe(
			"env.seyn",
		);
		expect(suggestSignPath({ kind: "folder", path: "docs/api" }, none)).toBe(
			"docs/api/api.seyn",
		);
		expect(suggestSignPath({ kind: "folder", path: "." }, none)).toBe(
			"welcome.seyn",
		);
	});

	test("skips taken names", () => {
		const taken = new Set(["src/index.seyn", "src/index-2.seyn"]);
		expect(suggestSignPath({ kind: "file", path: "src/index.ts" }, taken)).toBe(
			"src/index-3.seyn",
		);
	});

	test("suggestions always pass the file-name rule", () => {
		for (const path of ["a/b c/d.e.f", "ü/ñ.ts", "--x", ".hidden/.x"]) {
			const s = suggestSignPath({ kind: "file", path }, new Set());
			if (
				!path
					.split("/")
					.slice(0, -1)
					.some((seg) => seg.startsWith(".") || /[^A-Za-z0-9._ -]/.test(seg))
			)
				expect(isValidSignFileName(s), s).toBe(true);
		}
	});
});

describe("isValidSignFileName", () => {
	test.each([
		["welcome.seyn", true],
		["src/index.seyn", true],
		["docs/My Notes.seyn", true],
		["../x.seyn", false],
		["/abs.seyn", false],
		["a//b.seyn", false],
		["a/./b.seyn", false],
		[".git/x.seyn", false],
		["node_modules/x.seyn", false],
		["x.txt", false],
		["x.seyn.txt", false],
		[".seyn", false],
		["a\\b.seyn", false],
		["a\0.seyn", false],
		["", false],
	])("%j -> %s", (path, ok) => {
		expect(isValidSignFileName(path)).toBe(ok);
	});
});

describe("links", () => {
	const linkWorld = {
		portalIds: new Set(["src/a.ts"]),
		clusterByPath: new Map([
			[".", "root"],
			["src", "src"],
		]),
		signPaths: new Set(["b.seyn"]),
	};

	test("resolve only to things in this world", () => {
		expect(
			resolveSignLink({ kind: "file", path: "src/a.ts" }, linkWorld),
		).toEqual({ kind: "portal", id: "src/a.ts" });
		expect(
			resolveSignLink({ kind: "file", path: "gone.ts" }, linkWorld),
		).toBeNull();
		expect(resolveSignLink({ kind: "folder", path: "." }, linkWorld)).toEqual({
			kind: "cluster",
			id: "root",
		});
		expect(
			resolveSignLink({ kind: "sign", path: "b.seyn" }, linkWorld),
		).toEqual({ kind: "sign", path: "b.seyn" });
		expect(
			resolveSignLink({ kind: "invalid", raw: "x", reason: "y" }, linkWorld),
		).toBeNull();
	});

	test("isSafeSignUrl", () => {
		expect(isSafeSignUrl("https://example.com/a")).toBe(true);
		for (const bad of [
			"javascript:alert(1)",
			"http://x.com",
			"https://u:p@x.com",
			"data:,x",
			"not a url",
		])
			expect(isSafeSignUrl(bad), bad).toBe(false);
	});

	test("walking stops in front of the target, never on it", () => {
		for (const kind of ["portal", "cluster", "sign"] as const) {
			const p = standInFront({ x: 10, y: 10 }, kind);
			expect(p.x).toBe(10);
			expect(p.y).toBeGreaterThan(10);
		}
	});
});

describe("owner gating", () => {
	const api: OwnerSignsApi = {
		save: async () => ({
			path: "a.seyn",
			source: "",
			anchor: { kind: "cluster", id: "root" },
		}),
		remove: async () => {},
	};
	const draft = {
		path: null,
		near: { kind: "folder" as const, path: "." },
		offset: null,
		body: "",
		suggestedPath: "welcome.seyn",
	};

	test("no sign item among the default tools; it exists only on its own", () => {
		expect(createDefaultTools().map((t) => t.id)).not.toContain("sign");
		expect(createSignTool().id).toBe("sign");
	});

	test("without the owner capability, placing and the editor stay shut", () => {
		const store = createCabnStore();
		store.getState().setSignPlacing(true);
		store.getState().setSignDraft(draft);
		createSignTool().onUse({ store, bus: undefined as never });
		expect(store.getState().signPlacing).toBe(false);
		expect(store.getState().signDraft).toBeNull();
	});

	test("with it, the tool toggles placing and a draft ends placing", () => {
		const store = createCabnStore();
		store.getState().setOwnerSigns(api);
		createSignTool().onUse({ store, bus: undefined as never });
		expect(store.getState().signPlacing).toBe(true);
		store.getState().setSignDraft(draft);
		expect(store.getState().signPlacing).toBe(false);
		expect(store.getState().signDraft).toEqual(draft);
		store.getState().setOwnerSigns(null);
		expect(store.getState().signDraft).toBeNull();
	});

	test("placing needs world mode", () => {
		const store = createCabnStore();
		store.getState().setOwnerSigns(api);
		store.getState().enterPortal("x", "text");
		store.getState().setSignPlacing(true);
		expect(store.getState().signPlacing).toBe(false);
	});
});

describe("store: signs", () => {
	const a: SignEntry = {
		path: "a.seyn",
		source: "a",
		anchor: { kind: "cluster", id: "root" },
	};
	test("upsert replaces by path; remove clears focus/open", () => {
		const store = createCabnStore();
		store.getState().setSigns([a], { ".": "root" });
		store.getState().upsertSign({ ...a, source: "b" });
		expect(store.getState().signs).toEqual([{ ...a, source: "b" }]);
		store.getState().setFocusedSign("a.seyn");
		store.getState().setOpenSign("a.seyn");
		store.getState().removeSign("a.seyn");
		expect(store.getState()).toMatchObject({
			signs: [],
			focusedSignPath: null,
			openSignPath: null,
		});
	});

	test("the map stays shut while a sign is open; shelf entry clears signs", () => {
		const store = createCabnStore();
		store.getState().setWorldMap({
			name: "w",
			clusters: [],
			paths: [],
			portals: [],
			monsters: [],
		});
		store.getState().setSigns([a], { ".": "root" });
		store.getState().setOpenSign("a.seyn");
		store.getState().setMapOpen(true);
		expect(store.getState().mapOpen).toBe(false);
		store.getState().clearWorldContext();
		expect(store.getState()).toMatchObject({
			signs: [],
			openSignPath: null,
			folderClusters: {},
		});
	});
});
