import { describe, expect, it } from "vitest";
import { createOwnerToolkitTool } from "../src/systems/ownerToolkit.js";
import {
	reduceToolCard,
	TOOL_CARD_IDLE,
	toolCardContent,
	visibleToolId,
} from "../src/systems/toolCard.js";
import { createDefaultTools } from "../src/systems/tools.js";

describe("tool card state", () => {
	it("shows the hovered slot and lingers after the pointer leaves", () => {
		let s = reduceToolCard(TOOL_CARD_IDLE, { type: "hover", id: "orb" });
		expect(visibleToolId(s)).toBe("orb");
		s = reduceToolCard(s, { type: "unhover", id: "orb" });
		expect(visibleToolId(s)).toBe("orb");
		s = reduceToolCard(s, { type: "expire" });
		expect(visibleToolId(s)).toBeNull();
	});

	it("keeps the focused slot's card when the mouse leaves another slot", () => {
		let s = reduceToolCard(TOOL_CARD_IDLE, { type: "focus", id: "bag" });
		s = reduceToolCard(s, { type: "hover", id: "wand" });
		expect(visibleToolId(s)).toBe("wand");
		s = reduceToolCard(s, { type: "unhover", id: "wand" });
		s = reduceToolCard(s, { type: "expire" });
		expect(visibleToolId(s)).toBe("bag");
	});

	it("ignores a stale leave or blur for a slot that is no longer current", () => {
		const s = reduceToolCard(TOOL_CARD_IDLE, { type: "hover", id: "wand" });
		expect(reduceToolCard(s, { type: "unhover", id: "orb" })).toBe(s);
		expect(reduceToolCard(s, { type: "blur", id: "orb" })).toBe(s);
	});

	it("hovering again cancels a pending linger", () => {
		let s = reduceToolCard(TOOL_CARD_IDLE, { type: "hover", id: "orb" });
		s = reduceToolCard(s, { type: "unhover", id: "orb" });
		s = reduceToolCard(s, { type: "hover", id: "bag" });
		expect(s.linger).toBeNull();
		expect(visibleToolId(s)).toBe("bag");
	});
});

describe("tool card content", () => {
	it("prefixes Alt while writing in a text file", () => {
		const spyglass = createDefaultTools().find((t) => t.id === "spyglass");
		if (!spyglass) throw new Error("no spyglass");
		expect(toolCardContent(spyglass, false).key).toBe("L");
		expect(toolCardContent(spyglass, true).key).toBe("Alt+L");
	});

	it("every hotbar tool, owner's included, has a short label and a one-line description", () => {
		for (const tool of [...createDefaultTools(), createOwnerToolkitTool()]) {
			expect(tool.label, tool.id).toBeTruthy();
			expect(tool.description, tool.id).toBeTruthy();
			expect(tool.description, tool.id).not.toMatch(/\n/);
		}
	});

	it("names the opener's label Enter", () => {
		expect(createDefaultTools()[0]?.label).toBe("Enter");
	});
});
