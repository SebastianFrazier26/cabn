import { describe, expect, it, vi } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	createOwnerToolkitTool,
	digitPick,
	OWNER_TOOLKIT_HOTKEY,
	ownerToolkitEntries,
	stepPick,
} from "../src/systems/ownerToolkit.js";
import { createDefaultTools } from "../src/systems/tools.js";
import type {
	LayerTool,
	WorldLayerProvider,
} from "../src/systems/worldLayer.js";

function fakeLayer(id: string, tool: LayerTool): WorldLayerProvider {
	return { id, tools: [tool] } as unknown as WorldLayerProvider;
}

const layerTool = (onUse = vi.fn()): LayerTool => ({
	id: "peek",
	label: "Peek",
	name: "Peek (extra files)",
	icon: "peek.png",
	onUse,
});

const none = {
	signs: false,
	git: false,
	layers: [],
	signPlacing: false,
	activeLayerId: null,
};

describe("owner toolkit entries", () => {
	it("is empty without any owner capability, so there's no slot and O does nothing", () => {
		expect(ownerToolkitEntries(none)).toEqual([]);
	});

	it("lists signs, then each layer's tools, then the three git flows", () => {
		const entries = ownerToolkitEntries({
			...none,
			signs: true,
			git: true,
			layers: [fakeLayer("extra", layerTool())],
		});
		expect(entries.map((e) => e.id)).toEqual([
			"sign",
			"extra:peek",
			"git:commit",
			"git:switch",
			"git:branch",
		]);
		expect(entries.map((e) => e.label)).toEqual([
			"Place sign",
			"Peek",
			"Commit",
			"Switch branch",
			"Create branch",
		]);
		expect(entries.filter((e) => e.group === "Git")).toHaveLength(3);
	});

	it("takes a layer entry's name, icon and action from the provider's tool", () => {
		const onUse = vi.fn();
		const [entry] = ownerToolkitEntries({
			...none,
			layers: [fakeLayer("extra", layerTool(onUse))],
			activeLayerId: "extra",
		});
		expect(entry?.detail).toBe("extra files");
		expect(entry?.icon).toBe("peek.png");
		expect(entry?.active).toBe(true);
		const ctx = { store: createCabnStore(), bus: undefined as never };
		entry?.run(ctx);
		expect(onUse).toHaveBeenCalledWith(ctx);
	});

	it("git entries open the rift's picker on that owner flow", () => {
		const store = createCabnStore();
		store.getState().setGit({} as never);
		const entry = ownerToolkitEntries({ ...none, git: true }).find(
			(e) => e.id === "git:switch",
		);
		entry?.run({ store, bus: undefined as never });
		expect(store.getState().universeOpen).toBe(true);
		expect(store.getState().universeOwnerFocus).toBe("switch");
		store.getState().setUniverseOpen(false);
		expect(store.getState().universeOwnerFocus).toBeNull();
	});
});

describe("owner toolkit keys", () => {
	it("O is the one owner key and no default tool claims it", () => {
		expect(OWNER_TOOLKIT_HOTKEY).toBe("O");
		expect(createOwnerToolkitTool().hotkey).toBe("O");
		expect(createDefaultTools().map((t) => t.hotkey)).not.toContain("O");
	});

	it("digits pick rows 1-9 that exist", () => {
		expect(digitPick("1", 3)).toBe(0);
		expect(digitPick("3", 3)).toBe(2);
		expect(digitPick("4", 3)).toBeNull();
		expect(digitPick("0", 3)).toBeNull();
		expect(digitPick("a", 3)).toBeNull();
	});

	it("arrows wrap at both ends", () => {
		expect(stepPick(0, -1, 3)).toBe(2);
		expect(stepPick(2, 1, 3)).toBe(0);
		expect(stepPick(1, 1, 3)).toBe(2);
		expect(stepPick(0, 1, 0)).toBe(0);
	});
});

describe("owner toolkit open state", () => {
	it("opens only in world mode with nothing else modal, and entering a file closes it", () => {
		const store = createCabnStore();
		const tool = createOwnerToolkitTool();
		tool.onUse({ store, bus: undefined as never });
		expect(store.getState().ownerToolkitOpen).toBe(true);
		tool.onUse({ store, bus: undefined as never });
		expect(store.getState().ownerToolkitOpen).toBe(false);

		store.getState().setGuideOpen(true);
		store.getState().setOwnerToolkitOpen(true);
		expect(store.getState().ownerToolkitOpen).toBe(false);
		store.getState().setGuideOpen(false);

		store.getState().setOwnerToolkitOpen(true);
		store.getState().enterPortal("a.txt", "hi");
		expect(store.getState().ownerToolkitOpen).toBe(false);
		store.getState().setOwnerToolkitOpen(true);
		expect(store.getState().ownerToolkitOpen).toBe(false);
	});
});
