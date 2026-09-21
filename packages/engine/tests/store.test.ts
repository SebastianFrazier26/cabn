import { beforeEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../src/bridge/store.js";
import { createCabnStore } from "../src/bridge/store.js";

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
});
