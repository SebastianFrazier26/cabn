import { beforeEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../src/bridge/store.js";
import { createCabnStore } from "../src/bridge/store.js";
import { shouldShowVictoryToast } from "../src/systems/victoryTrigger.js";

describe("createCabnStore", () => {
	let store: StoreApi<CabnStore>;

	beforeEach(() => {
		store = createCabnStore();
	});

	it("starts in world mode with no active portal/cluster", () => {
		const state = store.getState();
		expect(state.mode).toBe("world");
		expect(state.activeClusterId).toBeNull();
		expect(state.activePortalId).toBeNull();
		expect(state.activePortalContent).toBeNull();
		expect(state.loadedChunks).toEqual([]);
		expect(state.searchOpen).toBe(false);
	});

	it("clears world context atomically on shelf entry while preserving the bag, clock and file buffer", () => {
		store.getState().enterPortal("a.ts", "saved text");
		const buffer = store.getState().activeFileState;
		if (!buffer) throw new Error("Expected a text file buffer");
		store
			.getState()
			.setActiveFileState(
				buffer.update({ changes: { from: 0, to: 5, insert: "unsaved" } }).state,
			);
		store.getState().setTimeOfDayOverride("night");
		store.setState({
			activeClusterId: "root",
			activeWorldBase: "/worlds/previous/",
			loadedChunks: ["root"],
			portals: [
				{
					id: "a",
					clusterId: "root",
					name: "a.ts",
					path: "a.ts",
					kind: "code",
					bytes: 12,
					previewLine: "text",
					edited: false,
				},
			],
			monsters: [{ id: "bug", species: "ghost", message: "boo", tier: 1 }],
			defeatedMonsterIds: ["other-bug"],
			searchOpen: true,
			spyglassOpen: true,
			focusedPortalPreview: {
				portalId: "a",
				fileName: "a.ts",
				path: "a.ts",
				preview: { kind: "text", text: "text" },
				allowedEmbedOrigins: [],
			},
			nearWebPortal: {
				portalId: "web",
				url: "https://example.com",
				allowedEmbedOrigins: [],
			},
			guideNpc: { pos: { x: 1, y: 2 }, talked: true },
			guideOpen: true,
			bagSlots: [
				{
					id: "slot",
					text: "kept",
					sourcePortalId: "a",
					startLine: 0,
					endLine: 0,
				},
			],
		});
		const before = store.getState();
		const observations: CabnStore[] = [];
		const unsubscribe = store.subscribe((state) => observations.push(state));
		store.getState().clearWorldContext();
		unsubscribe();
		const state = store.getState();
		expect(observations).toHaveLength(1);
		expect(state).toMatchObject({
			activeClusterId: null,
			activeWorldBase: null,
			loadedChunks: [],
			portals: [],
			monsters: [],
			defeatedMonsterIds: [],
			searchOpen: false,
			spyglassOpen: false,
			focusedPortalPreview: null,
			nearWebPortal: null,
			guideNpc: null,
			guideOpen: false,
			timeOfDayOverride: "night",
			timeOfDay: "night",
		});
		expect(state.bagSlots).toBe(before.bagSlots);
		expect(state.activeFileState).toBe(before.activeFileState);
		expect(state.activeFileSavedDoc).toBe(before.activeFileSavedDoc);
		expect(state.activePortalContent).toBe(before.activePortalContent);
		expect(
			shouldShowVictoryToast(
				1,
				state.monsters.length,
				state.monsters.length > 0,
			),
		).toBe(false);
	});

	it("enterPortal switches to file mode and stores the portal + content", () => {
		store.getState().enterPortal("src/index.ts", "console.log('hi')");
		const state = store.getState();
		expect(state.mode).toBe("file");
		expect(state.activePortalId).toBe("src/index.ts");
		expect(state.activePortalContent).toBe("console.log('hi')");
	});

	it("enterPortal accepts null content for binary/unreadable files", () => {
		store.getState().enterPortal("assets/logo.png", null);
		expect(store.getState().activePortalContent).toBeNull();
		expect(store.getState().mode).toBe("file");
	});

	it("exitPortal returns to world mode and clears portal state", () => {
		store.getState().enterPortal("src/index.ts", "content");
		store.getState().exitPortal();
		const state = store.getState();
		expect(state.mode).toBe("world");
		expect(state.activePortalId).toBeNull();
		expect(state.activePortalContent).toBeNull();
	});

	it("setActiveCluster and setLoadedChunks update independently of portal state", () => {
		store.getState().setActiveCluster("root");
		store.getState().setLoadedChunks(["root", "root--src"]);
		const state = store.getState();
		expect(state.activeClusterId).toBe("root");
		expect(state.loadedChunks).toEqual(["root", "root--src"]);
		expect(state.mode).toBe("world");
	});

	it("setPlayerPos and setSearchOpen update their own fields only", () => {
		store.getState().setPlayerPos({ x: 12, y: -4 });
		store.getState().setSearchOpen(true);
		const state = store.getState();
		expect(state.playerPos).toEqual({ x: 12, y: -4 });
		expect(state.searchOpen).toBe(true);
	});

	it("openEditor switches to editor mode with the given caret line/language", () => {
		store.getState().enterPortal("src/index.ts", "a\nb\nc");
		store.getState().openEditor({ initialLine: 2, language: "typescript" });
		const state = store.getState();
		expect(state.mode).toBe("editor");
		expect(state.editorInitialLine).toBe(2);
		expect(state.editorLanguage).toBe("typescript");
		// The editor never replaces which file is open, only overlays it.
		expect(state.activePortalId).toBe("src/index.ts");
	});

	it("closeEditor returns to file mode without touching the open portal", () => {
		store.getState().enterPortal("src/index.ts", "a\nb\nc");
		store.getState().openEditor({ initialLine: 0, language: undefined });
		store.getState().closeEditor();
		const state = store.getState();
		expect(state.mode).toBe("file");
		expect(state.activePortalId).toBe("src/index.ts");
	});

	it("setActivePortalContent replaces the open file's content in place", () => {
		store.getState().enterPortal("src/index.ts", "old");
		store.getState().setActivePortalContent("new");
		const state = store.getState();
		expect(state.activePortalContent).toBe("new");
		expect(state.mode).toBe("file");
		expect(state.activePortalId).toBe("src/index.ts");
	});

	it("startEncounter switches to encounter mode with the given monster active", () => {
		store.getState().enterPortal("src/index.ts", "a\nb\nc");
		store.getState().startEncounter("monster:abc");
		const state = store.getState();
		expect(state.mode).toBe("encounter");
		expect(state.activeMonsterId).toBe("monster:abc");
		expect(state.activePortalId).toBe("src/index.ts");
	});

	it("endEncounter returns to file mode and clears the active monster", () => {
		store.getState().startEncounter("monster:abc");
		store.getState().endEncounter();
		const state = store.getState();
		expect(state.mode).toBe("file");
		expect(state.activeMonsterId).toBeNull();
	});

	it("setMonsters and setDefeatedMonsterIds update their own fields only", () => {
		store.getState().setMonsters([
			{
				id: "monster:abc",
				species: "ghost",
				message: "boo",
				tier: 1,
				portalId: "a.ts",
			},
		]);
		store.getState().setDefeatedMonsterIds(["monster:abc"]);
		const state = store.getState();
		expect(state.monsters).toEqual([
			{
				id: "monster:abc",
				species: "ghost",
				message: "boo",
				tier: 1,
				portalId: "a.ts",
			},
		]);
		expect(state.defeatedMonsterIds).toEqual(["monster:abc"]);
		expect(state.mode).toBe("world");
	});

	it("startRun switches to run mode and stores the overlay snapshot", () => {
		const run = {
			totalSteps: 3,
			index: 0,
			currentLine: 1,
			status: "playing" as const,
			speed: 1 as const,
			log: ["line 1: import"],
			approximateLines: false,
		};
		store.getState().startRun(run);
		const state = store.getState();
		expect(state.mode).toBe("run");
		expect(state.run).toEqual(run);
	});

	it("setRun replaces the snapshot without touching mode", () => {
		const run = {
			totalSteps: 3,
			index: 0,
			currentLine: 1,
			status: "playing" as const,
			speed: 1 as const,
			log: [],
			approximateLines: false,
		};
		store.getState().startRun(run);
		store.getState().setRun({ ...run, index: 1, currentLine: 2 });
		const state = store.getState();
		expect(state.mode).toBe("run");
		expect(state.run?.index).toBe(1);
	});

	it("stopRun returns to file mode and clears the run snapshot", () => {
		store.getState().startRun({
			totalSteps: 1,
			index: 0,
			currentLine: 1,
			status: "done" as const,
			speed: 1 as const,
			log: [],
			approximateLines: false,
		});
		store.getState().stopRun();
		const state = store.getState();
		expect(state.mode).toBe("file");
		expect(state.run).toBeNull();
	});

	it("starts with an auto time-of-day override", () => {
		expect(store.getState().timeOfDayOverride).toBe("auto");
	});

	it("setTimeOfDayOverride pins timeOfDay when overridden to day/night", () => {
		store.getState().setTimeOfDayOverride("night");
		expect(store.getState().timeOfDayOverride).toBe("night");
		expect(store.getState().timeOfDay).toBe("night");

		store.getState().setTimeOfDayOverride("day");
		expect(store.getState().timeOfDay).toBe("day");
	});

	it("refreshTimeOfDay re-resolves from the current override without changing it", () => {
		store.getState().setTimeOfDayOverride("night");
		store.getState().refreshTimeOfDay();
		expect(store.getState().timeOfDayOverride).toBe("night");
		expect(store.getState().timeOfDay).toBe("night");
	});
});
