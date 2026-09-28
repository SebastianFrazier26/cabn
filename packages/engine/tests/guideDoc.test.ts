import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SpeciesSchema } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import {
	GUIDE_DOC_BLOCK_IDS,
	GUIDE_GREETING,
	guideDocMarkers,
	guideTopics,
	MONSTER_GUIDE,
	renderGuideDocBlock,
	syncGuideDoc,
	TOOL_GUIDE,
} from "../src/systems/guideContent.js";
import { SPELLBOOK_TOOLS } from "../src/systems/spellbookTools.js";
import { createDefaultTools } from "../src/systems/tools.js";

const DOC_PATH = fileURLToPath(
	new URL("../../../docs/USER_GUIDE.md", import.meta.url),
);

// Run with CABN_UPDATE_GUIDE=1 to rewrite the generated blocks in place
// after changing guideContent.ts (or a keybind it reads).
if (process.env.CABN_UPDATE_GUIDE === "1") {
	writeFileSync(DOC_PATH, syncGuideDoc(readFileSync(DOC_PATH, "utf8")));
}

describe("docs/USER_GUIDE.md", () => {
	const doc = readFileSync(DOC_PATH, "utf8");

	it.each(GUIDE_DOC_BLOCK_IDS)(
		"block %s matches guideContent.ts (CABN_UPDATE_GUIDE=1 to regenerate)",
		(id) => {
			const { begin, end } = guideDocMarkers(id);
			const start = doc.indexOf(begin);
			const stop = doc.indexOf(end);
			expect(start, `missing ${begin}`).toBeGreaterThanOrEqual(0);
			expect(stop).toBeGreaterThan(start);
			expect(doc.slice(start + begin.length, stop).trim()).toBe(
				renderGuideDocBlock(id),
			);
		},
	);

	it("carries every one of Wren's pages verbatim", () => {
		expect(doc).toContain(GUIDE_GREETING);
		for (const topic of guideTopics("both")) {
			for (const page of topic.pages) {
				expect(doc).toContain(page.replaceAll("\n", " "));
			}
		}
	});
});

describe("guide content coverage", () => {
	it("explains every hotbar tool", () => {
		for (const tool of createDefaultTools()) {
			expect(TOOL_GUIDE[tool.id], tool.id).toBeTruthy();
		}
	});

	it("explains every monster species", () => {
		const missing = SpeciesSchema.options.filter((s) => !MONSTER_GUIDE[s]);
		expect(missing).toEqual([]);
	});

	it("quotes the hotkeys the tool registry and spellbook actually bind", () => {
		const tools = renderGuideDocBlock("tools");
		for (const tool of createDefaultTools()) {
			expect(tools).toContain(`| ${tool.name} | \`${tool.hotkey}\` |`);
		}
		const spellbook = renderGuideDocBlock("spellbook");
		expect(spellbook).toContain("`Ctrl+S` / `Cmd+S`");
		expect(spellbook).toContain("`F2`");
		expect(SPELLBOOK_TOOLS.every((t) => spellbook.includes(t.label))).toBe(
			true,
		);
	});

	it("uses the player's platform in game and both in the doc", () => {
		const page = (style: "mac" | "other" | "both") =>
			guideTopics(style)
				.find((t) => t.id === "editing")
				?.pages.find((p) => p.startsWith("Save with"));
		expect(page("mac")).toContain("Cmd+S");
		expect(page("mac")).not.toContain("Ctrl+S");
		expect(page("other")).toContain("Ctrl+S");
		expect(page("both")).toContain("Ctrl+S / Cmd+S");
	});

	it("keeps every page short enough for the dialogue box", () => {
		for (const topic of guideTopics("both")) {
			expect(topic.pages.length).toBeGreaterThan(0);
			for (const page of topic.pages) {
				expect(page.length, page).toBeLessThanOrEqual(260);
			}
		}
		expect(guideTopics().map((t) => t.id)).toEqual([
			"moving",
			"tools",
			"monsters",
			"editing",
			"previews",
		]);
	});
});
