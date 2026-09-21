import { describe, expect, it, vi } from "vitest";
import { createCabnBus } from "../src/bridge/events.js";
import { createCabnStore } from "../src/bridge/store.js";
import {
	createDefaultToolRegistry,
	createDefaultTools,
	type Tool,
	ToolRegistry,
} from "../src/systems/tools.js";

function makeCtx() {
	return { store: createCabnStore(), bus: createCabnBus() };
}

describe("ToolRegistry", () => {
	it("registers a tool and finds it by id and hotkey", () => {
		const registry = new ToolRegistry();
		const tool: Tool = {
			id: "t1",
			name: "Test",
			icon: "x.png",
			hotkey: "X",
			onUse: vi.fn(),
		};
		registry.register(tool);
		expect(registry.get("t1")).toBe(tool);
		expect(registry.getByHotkey("X")).toBe(tool);
	});

	it("lists tools in registration order", () => {
		const registry = new ToolRegistry();
		const a: Tool = {
			id: "a",
			name: "A",
			icon: "a.png",
			hotkey: "A",
			onUse: vi.fn(),
		};
		const b: Tool = {
			id: "b",
			name: "B",
			icon: "b.png",
			hotkey: "B",
			onUse: vi.fn(),
		};
		registry.register(a);
		registry.register(b);
		expect(registry.list()).toEqual([a, b]);
	});

	it("throws on a duplicate id", () => {
		const registry = new ToolRegistry();
		registry.register({
			id: "a",
			name: "A",
			icon: "a.png",
			hotkey: "A",
			onUse: vi.fn(),
		});
		expect(() =>
			registry.register({
				id: "a",
				name: "A2",
				icon: "a2.png",
				hotkey: "Z",
				onUse: vi.fn(),
			}),
		).toThrow();
	});

	it("throws on a duplicate hotkey", () => {
		const registry = new ToolRegistry();
		registry.register({
			id: "a",
			name: "A",
			icon: "a.png",
			hotkey: "A",
			onUse: vi.fn(),
		});
		expect(() =>
			registry.register({
				id: "b",
				name: "B",
				icon: "b.png",
				hotkey: "A",
				onUse: vi.fn(),
			}),
		).toThrow();
	});

	it("dispatch calls the tool's onUse with the given context and returns true", () => {
		const registry = new ToolRegistry();
		const onUse = vi.fn();
		registry.register({
			id: "a",
			name: "A",
			icon: "a.png",
			hotkey: "A",
			onUse,
		});
		const ctx = makeCtx();
		expect(registry.dispatch("a", ctx)).toBe(true);
		expect(onUse).toHaveBeenCalledWith(ctx);
	});

	it("dispatch returns false for an unknown id without throwing", () => {
		const registry = new ToolRegistry();
		expect(registry.dispatch("missing", makeCtx())).toBe(false);
	});

	it("dispatchHotkey resolves by hotkey", () => {
		const registry = new ToolRegistry();
		const onUse = vi.fn();
		registry.register({
			id: "a",
			name: "A",
			icon: "a.png",
			hotkey: "L",
			onUse,
		});
		expect(registry.dispatchHotkey("L", makeCtx())).toBe(true);
		expect(onUse).toHaveBeenCalledOnce();
	});

	it("dispatchHotkey returns false for an unbound hotkey", () => {
		const registry = new ToolRegistry();
		expect(registry.dispatchHotkey("Q", makeCtx())).toBe(false);
	});
});

describe("createDefaultTools / createDefaultToolRegistry", () => {
	it("ships opener (E), spyglass (L), orb (F), and bag (B)", () => {
		const tools = createDefaultTools();
		expect(tools.map((t) => t.id)).toEqual([
			"opener",
			"spyglass",
			"orb",
			"bag",
		]);
		expect(tools.map((t) => t.hotkey)).toEqual(["E", "L", "F", "B"]);
	});

	it("builds a registry where every default tool is dispatchable", () => {
		const registry = createDefaultToolRegistry();
		const ctx = makeCtx();
		for (const tool of createDefaultTools()) {
			expect(registry.dispatch(tool.id, ctx)).toBe(true);
		}
	});

	it("spyglass sets spyglassOpen and orb sets searchOpen on the store", () => {
		const registry = createDefaultToolRegistry();
		const ctx = makeCtx();
		registry.dispatch("spyglass", ctx);
		expect(ctx.store.getState().spyglassOpen).toBe(true);
		registry.dispatch("orb", ctx);
		expect(ctx.store.getState().searchOpen).toBe(true);
	});

	it("bag emits a tool:bag-use bus event", () => {
		const registry = createDefaultToolRegistry();
		const ctx = makeCtx();
		const handler = vi.fn();
		ctx.bus.on("tool:bag-use", handler);
		registry.dispatch("bag", ctx);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("opener emits a tool:opener-use bus event", () => {
		const registry = createDefaultToolRegistry();
		const ctx = makeCtx();
		const handler = vi.fn();
		ctx.bus.on("tool:opener-use", handler);
		registry.dispatch("opener", ctx);
		expect(handler).toHaveBeenCalledOnce();
	});
});
