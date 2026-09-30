import type { WorldLayerManifest, WorldManifest } from "@cabn/world-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import { NIGHT_TOKENS } from "../src/react/pixelThemeTokens.js";
import { createShadowLayer } from "../src/shadow/provider.js";
import { NETHER_SKIN, SHADOW_SKIN } from "../src/shadow/skin.js";
import { CRIMSON_TOKENS } from "../src/shadow/tokens.js";
import {
	DEFAULT_SKIN,
	resolveSkin,
	skinTextures,
} from "../src/systems/worldLayer.js";

// worldLayerSeam.ts draws with Phaser, which can't load outside a browser;
// its save-slot and file logic never touch Phaser, so a stub is enough here.
vi.mock("phaser", () => ({
	default: {
		GameObjects: { RenderTexture: class {}, Graphics: class {} },
	},
}));
const { WorldLayerSeam } = await import("../src/scenes/worldLayerSeam.js");

const TOKEN = "t".repeat(64);
const GENERATED = "2026-09-29T00:00:00.000Z";

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

function recordingFetch(
	respond: (call: Call) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const call: Call = {
			url: String(input),
			method: init?.method ?? "GET",
			headers: (init?.headers ?? {}) as Record<string, string>,
			...(typeof init?.body === "string" ? { body: init.body } : {}),
		};
		calls.push(call);
		const { status, body } = respond(call);
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { fetch: fn, calls };
}

/** localStorage/sessionStorage stand-ins that record every write. */
function recordingStorage(): { storage: Storage; writes: string[] } {
	const data = new Map<string, string>();
	const writes: string[] = [];
	const storage = {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => {
			writes.push(k);
			data.set(k, v);
		},
		removeItem: (k: string) => {
			writes.push(`-${k}`);
			data.delete(k);
		},
		clear: () => data.clear(),
		key: () => null,
		get length() {
			return data.size;
		},
	} as Storage;
	return { storage, writes };
}

const layerManifest = {
	layerVersion: 1,
	baseGeneratedAt: GENERATED,
	generatedAt: GENERATED,
	stats: { fileCount: 1, totalBytes: 9, truncated: false, skippedFiles: 0 },
	clusters: [
		{
			id: "root#shadow",
			path: ".",
			label: ". (hidden)",
			pos: { x: -600, y: -400 },
			biome: "meadow",
			portalIds: [".env"],
			chunk: "chunks/root-shadow.json",
		},
	],
	paths: [{ from: "root", to: "root#shadow", kind: "trail" }],
	portals: [
		{
			id: ".env",
			clusterId: "root#shadow",
			file: {
				path: ".env",
				name: ".env",
				kind: "config",
				bytes: 9,
				binary: false,
			},
			preview: { lines: ["SECRET=1"], truncated: false },
			spawns: [],
		},
	],
	monsters: [],
	extendedMonsters: [],
	signs: [],
	textSha256: { ".env": "a".repeat(64) },
} as unknown as WorldLayerManifest;

describe("shadow client", () => {
	it("sends every shadow request to /owner/shadow/* with the owner token, cluster ids encoded", async () => {
		const { fetch, calls } = recordingFetch((call) => {
			if (call.url.endsWith("/manifest"))
				return { status: 200, body: layerManifest };
			return {
				status: 200,
				body: { clusterId: "root#shadow", files: {} },
			};
		});
		const layer = createShadowLayer({
			baseUrl: "http://127.0.0.1:9",
			token: TOKEN,
			fetch,
		});
		await layer.load();
		await layer.fetchChunk("root#shadow");
		await layer.fetchChunk(".github/workflows").catch(() => undefined);
		expect(calls.map((c) => c.url)).toEqual([
			"http://127.0.0.1:9/owner/shadow/manifest",
			"http://127.0.0.1:9/owner/shadow/chunk/root%23shadow",
			"http://127.0.0.1:9/owner/shadow/chunk/.github%2Fworkflows",
		]);
		for (const call of calls)
			expect(call.headers["x-cabn-owner-token"]).toBe(TOKEN);
	});

	it("a 409 save is a conflict, in character, and nothing reaches browser storage", async () => {
		const local = recordingStorage();
		const session = recordingStorage();
		vi.stubGlobal("localStorage", local.storage);
		vi.stubGlobal("sessionStorage", session.storage);
		try {
			const { fetch, calls } = recordingFetch(() => ({
				status: 409,
				body: { error: "changed", currentSha256: "b".repeat(64) },
			}));
			const layer = createShadowLayer({ baseUrl: "", token: TOKEN, fetch });
			const result = await layer.saveFile(".env", "MINE=1\n", "a".repeat(64));
			expect(result).toMatchObject({ ok: false, conflict: true });
			if (!result.ok) expect(result.message).toContain(".env");
			expect(calls[0]?.url).toBe("/owner/shadow/save");
			expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
				path: ".env",
				content: "MINE=1\n",
				baseSha256: "a".repeat(64),
			});
			expect(local.writes).toEqual([]);
			expect(session.writes).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("a saved file is patched into the loaded layer index", async () => {
		const { buildSearchIndex } = await import("@cabn/converter/core");
		const index = buildSearchIndex([
			{ id: ".env", path: ".env", name: ".env", content: "OLD value" },
		]);
		const { fetch } = recordingFetch((call) =>
			call.url.endsWith("search-index")
				? { status: 200, body: index }
				: { status: 200, body: { path: ".env", sha256: "c".repeat(64) } },
		);
		const layer = createShadowLayer({ baseUrl: "", token: TOKEN, fetch });
		const mini = await layer.searchIndex();
		expect(mini.search("brandnew")).toHaveLength(0);
		const result = await layer.saveFile(
			".env",
			"BRANDNEW value",
			"a".repeat(64),
		);
		expect(result).toEqual({ ok: true, sha256: "c".repeat(64) });
		expect(mini.search("brandnew").map((r) => r.id)).toEqual([".env"]);
	});

	it("shadow signs go to the owner sign routes with realm shadow", async () => {
		const { fetch, calls } = recordingFetch(() => ({
			status: 200,
			body: {
				sign: {
					path: ".github/a.seyn",
					source: "# a",
					anchor: { kind: "cluster", id: ".github" },
				},
			},
		}));
		const layer = createShadowLayer({ baseUrl: "", token: TOKEN, fetch });
		await layer
			.saveSign({ path: ".github/a.seyn", content: "# a", create: true })
			.catch(() => undefined);
		await layer.removeSign(".github/a.seyn");
		expect(calls.map((c) => c.url)).toEqual([
			"/owner/signs/save",
			"/owner/signs/delete",
		]);
		for (const call of calls)
			expect(JSON.parse(call.body ?? "{}").realm).toBe("shadow");
	});
});

describe("WorldLayerSeam save slot", () => {
	let local: ReturnType<typeof recordingStorage>;
	beforeEach(() => {
		local = recordingStorage();
		vi.stubGlobal("localStorage", local.storage);
	});
	afterEach(() => vi.unstubAllGlobals());

	const base = {
		meta: { name: "b", generatedAt: GENERATED, source: "s" },
		clusters: [
			{
				id: "root",
				path: ".",
				label: ".",
				pos: { x: 0, y: 0 },
				biome: "meadow",
				portalIds: [],
				chunk: "chunks/root.json",
			},
		],
		portals: [],
		paths: [],
		monsters: [],
	} as unknown as WorldManifest;

	it("keeps layer visits and defeats in the sibling slot and never writes file content", async () => {
		const { fetch } = recordingFetch((call) =>
			call.url.endsWith("/manifest")
				? { status: 200, body: layerManifest }
				: { status: 200, body: { path: ".env", sha256: "d".repeat(64) } },
		);
		const provider = createShadowLayer({ baseUrl: "", token: TOKEN, fetch });
		const seam = WorldLayerSeam.create(base, {
			provider,
			manifest: layerManifest,
		});
		if (!seam) throw new Error("layer should fit");
		seam.openSlot("w1");
		expect(seam.recordVisit("root")).toBe(false);
		expect(seam.recordVisit("root#shadow")).toBe(true);
		const saved = await seam.saveFile(".env", "NEW=1\n");
		expect(saved).toEqual({ ok: true });
		expect(new Set(local.writes)).toEqual(new Set(["cabn:save:w1#shadow"]));
		const slot = JSON.parse(
			local.storage.getItem("cabn:save:w1#shadow") ?? "{}",
		);
		expect(slot.fileOverrides).toEqual({});
		expect(slot.visitedClusters).toEqual(["root#shadow"]);
		expect(JSON.stringify(slot)).not.toContain("NEW=1");
	});

	it("a layer that doesn't fit its base is refused", () => {
		const provider = createShadowLayer({ baseUrl: "", token: TOKEN });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			WorldLayerSeam.create(base, {
				provider,
				manifest: {
					...layerManifest,
					baseGeneratedAt: "2020-01-01T00:00:00.000Z",
				},
			}),
		).toBeNull();
		spy.mockRestore();
	});
});

describe("world layer store lifecycle", () => {
	it("tracks the offered layers and the active one; clearing the world drops it", () => {
		const store = createCabnStore();
		const provider = createShadowLayer({ baseUrl: "", token: TOKEN });
		expect(store.getState().worldLayers).toEqual([]);
		store.getState().setActiveLayer("shadow");
		expect(store.getState().activeLayerId).toBeNull();
		store.getState().setWorldLayers([provider]);
		store.getState().setActiveLayer("shadow");
		expect(store.getState().activeLayerId).toBe("shadow");
		expect(store.getState().layerUiTokens).toBe(CRIMSON_TOKENS);
		store
			.getState()
			.setLayerSaveIssue({ portalId: ".env", message: "x", conflict: true });
		store.getState().setActiveLayer(null);
		expect(store.getState().activeLayerId).toBeNull();
		expect(store.getState().layerUiTokens).toBeNull();
		expect(store.getState().layerSaveIssue).toBeNull();
		store.getState().setActiveLayer("shadow");
		store.getState().clearWorldContext();
		expect(store.getState().activeLayerId).toBeNull();
		expect(store.getState().worldLayers).toEqual([provider]);
		store.getState().setActiveLayer("shadow");
		store.getState().setWorldLayers([]);
		expect(store.getState().activeLayerId).toBeNull();
	});
});

describe("skins", () => {
	it("the default skin changes nothing; the shadow skin is the nether art and a crimson HUD", () => {
		for (const [key, value] of Object.entries(DEFAULT_SKIN))
			if (key !== "id") expect(value, key).toBeNull();
		expect(SHADOW_SKIN).toBe(NETHER_SKIN);
		expect(NETHER_SKIN.uiTokens).toBe(CRIMSON_TOKENS);
		expect(skinTextures(DEFAULT_SKIN)).toEqual([]);
		const textures = skinTextures(NETHER_SKIN);
		expect(textures.length).toBeGreaterThan(15);
		for (const t of textures) {
			expect(t.key.startsWith("shadow-"), t.key).toBe(true);
			expect(t.path.startsWith("/assets/shadow/"), t.path).toBe(true);
		}
		expect(new Set(textures.map((t) => t.key)).size).toBe(textures.length);
		expect(CRIMSON_TOKENS.diffAddText).toBe(NIGHT_TOKENS.diffAddText);
		expect(CRIMSON_TOKENS.panelBody).not.toBe(NIGHT_TOKENS.panelBody);
	});
});

describe("skin resolution", () => {
	it("hands DEFAULT_SKIN back untouched, whatever has loaded", () => {
		expect(resolveSkin(DEFAULT_SKIN, () => false)).toBe(DEFAULT_SKIN);
		expect(resolveSkin(DEFAULT_SKIN, () => true)).toBe(DEFAULT_SKIN);
	});

	it("keeps a fully loaded skin as is", () => {
		expect(resolveSkin(NETHER_SKIN, () => true)).toBe(NETHER_SKIN);
	});

	it("falls back to today's look per texture group, never half-skinned", () => {
		const missing = new Set([
			NETHER_SKIN.pathTextures?.cobbles[2]?.key,
			NETHER_SKIN.arch?.overlay.key,
			NETHER_SKIN.scenery?.oak?.key,
		]);
		const skin = resolveSkin(NETHER_SKIN, (k) => !missing.has(k));
		expect(skin.pathTextures).toBeNull();
		expect(skin.arch).toBeNull();
		expect(skin.scenery?.oak).toBeUndefined();
		// Its own redraw since the dead-plant pass, so it survives the oak's miss.
		expect(skin.scenery?.["blossom-oak"]).toBe(
			NETHER_SKIN.scenery?.["blossom-oak"],
		);
		expect(skin.scenery?.pine).toBe(NETHER_SKIN.scenery?.pine);
		expect(skin.fieldTiles).toBe(NETHER_SKIN.fieldTiles);
		expect(skin.brazier).toBe(NETHER_SKIN.brazier);
		expect(skin.grade).toBe(NETHER_SKIN.grade);
		expect(skinTextures(skin).every((t) => !missing.has(t.key))).toBe(true);
	});
});
