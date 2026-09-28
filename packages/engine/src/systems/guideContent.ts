/**
 * Everything the guide NPC (Wren) says, and the parts of docs/USER_GUIDE.md
 * that must agree with it, from one typed source.
 *
 * Why this direction (code -> doc) rather than parsing the doc at runtime:
 * the tips quote real keybinds, and those live in code — the tool registry
 * (tools.ts) and the spellbook's bindings (spellbookTools.ts). Building the
 * tips from those tables means a rebind can't leave Wren or the guide saying
 * the old key. The guide keeps its hand-written prose; only the marked
 * blocks (tool/spellbook/monster tables and Wren's tips) are rendered from
 * here, and packages/engine/tests/guideDoc.test.ts fails when the doc's copy
 * drifts (CABN_UPDATE_GUIDE=1 rewrites the blocks). Shipping markdown inside
 * the engine bundle was the rejected alternative: it would also need a
 * markdown renderer in the dialogue box, for a handful of sentences.
 */
import type { Species } from "@cabn/world-schema";
import {
	SPELLBOOK_TOOLS,
	type SpellbookToolId,
	shortcutLabel,
} from "./spellbookTools.js";
import { createDefaultTools } from "./tools.js";

export const GUIDE_NPC_NAME = "Wren";

export type GuideTopicId =
	| "moving"
	| "tools"
	| "monsters"
	| "editing"
	| "previews";

export interface GuideTopic {
	id: GuideTopicId;
	title: string;
	/** One line under the title in the topics menu. */
	blurb: string;
	/** One dialogue page each; "\n" breaks a line inside a page. */
	pages: readonly string[];
}

/** How a key chord is spelled: in the game, for the player's own platform; in the doc, both. */
export type KeyStyle = "mac" | "other" | "both";

export function formatBinding(binding: string, style: KeyStyle): string {
	if (style !== "both") return shortcutLabel(binding, style === "mac");
	const other = shortcutLabel(binding, false);
	const mac = shortcutLabel(binding, true);
	return other === mac ? other : `${other} / ${mac}`;
}

function spellbookKey(id: SpellbookToolId, style: KeyStyle): string {
	const tool = SPELLBOOK_TOOLS.find((t) => t.id === id);
	const binding = tool?.keys[0];
	if (!binding) throw new Error(`guide: no spellbook binding for "${id}"`);
	return formatBinding(binding, style);
}

function modKey(style: KeyStyle): string {
	if (style === "mac") return "Cmd";
	if (style === "other") return "Ctrl";
	return "Ctrl/Cmd";
}

function altKey(style: KeyStyle): string {
	if (style === "mac") return "Option";
	if (style === "other") return "Alt";
	return "Alt/Option";
}

/** What each hotbar tool does, keyed by its registry id — guideDoc.test.ts checks every registered tool has one. */
export const TOOL_GUIDE: Readonly<Record<string, string>> = {
	opener:
		"Enter uses cabins, portals, the bonfire and Wren. Inside a text file, Alt/Option+Enter faces a nearby monster; click the top arch or press Esc to leave.",
	spyglass:
		"Lists the files in the clearing you're standing in; click one to walk straight to it. Inside a text file, use Alt/Option+L.",
	orb: "Searches the whole world by name, path or contents; inside a file it searches that file's lines. Ctrl/Cmd+F opens it too; Alt/Option+F works on the page.",
	bag: "Inside a text file: Alt/Option+B copies the caret's selection, or its whole line, into a bag slot (up to 5).",
	quill:
		"Inside a text file: Alt/Option+Q opens the spellbook on the same caret, edits and undo history as the page.",
	wand: "Inside a text file: Alt/Option+R runs the current buffer, including unsaved edits, as a simulated trace. Code never runs unless the local server has --allow-exec.",
};

export interface MonsterGuideEntry {
	name: string;
	/** The error code the converter's taxonomy pairs with this species. */
	code: string;
	bug: string;
}

/**
 * One entry per species in @cabn/world-schema's SpeciesSchema —
 * guideDoc.test.ts fails naming any species that's missing, so a new
 * species can't ship without Wren being able to explain it.
 */
export const MONSTER_GUIDE: Readonly<
	Partial<Record<Species, MonsterGuideEntry>>
> = {
	ghost: {
		name: "Ghost",
		code: "NullTypeError",
		bug: "An import or markdown link that points at a file that isn't in this world.",
	},
	"rot-sprite": {
		name: "Rot-sprite",
		code: "Corrupted",
		bug: "Invalid JSON, or markdown frontmatter that's opened but never closed.",
	},
	"warded-mimic": {
		name: "Warded Mimic",
		code: "InvalidMode",
		bug: "An undecodable byte in the text (it shows up as the replacement character, U+FFFD).",
	},
	gremlin: {
		name: "Gremlin",
		code: "IoError",
		bug: "A bracket left open, mismatched or stray, or a string that never ends.",
	},
	ouroboros: {
		name: "Ouroboros",
		code: "OuroborosError",
		bug: "Two or more files importing each other in a circle.",
	},
	"will-o-wisp": {
		name: "Will-o'-Wisp",
		code: "WispNote",
		bug: "A TODO, FIXME, XXX or HACK note in a comment. Harmless and never fights; remove the note and save, and it drifts away.",
	},
	imp: {
		name: "Hex Imp",
		code: "SyntaxError",
		bug: "A parse error in JavaScript, Python, CSS or HTML. TypeScript is excluded; bracket problems belong to gremlins.",
	},
	magpie: {
		name: "Magpie",
		code: "LeakedSecret",
		bug: "A password, API key or other secret left in the code. Remove it and rotate any real exposed credential.",
	},
	skeleton: {
		name: "Skeleton",
		code: "DeadCode",
		bug: "An unused import or unreachable code after an unconditional exit.",
	},
	bramble: {
		name: "Bramble",
		code: "CodeSmell",
		bug: "Tangled code: deep nesting, long functions, duplicated blocks or leftover debug logging.",
	},
	shade: {
		name: "Shade",
		code: "UnknownBug",
		bug: "A finding from an external linter or scanner that has no more specific monster class.",
	},
};

function toolKey(id: string): string {
	const tool = createDefaultTools().find((t) => t.id === id);
	if (!tool) throw new Error(`guide: no hotbar tool "${id}"`);
	return tool.hotkey;
}

export const GUIDE_GREETING =
	"Well met, traveler! I'm Wren, keeper of this bonfire. Every file here is a portal and every folder a fountain. What shall I tell you about?";

export function guideTopics(style: KeyStyle = "both"): GuideTopic[] {
	const mod = modKey(style);
	const alt = altKey(style);
	const monsterLines = Object.values(MONSTER_GUIDE).map(
		(m) => `${m?.name}: ${m?.bug}`,
	);
	const monsterPages: string[] = [];
	for (let i = 0; i < monsterLines.length; i += 2) {
		monsterPages.push(monsterLines.slice(i, i + 2).join("\n"));
	}
	return [
		{
			id: "moving",
			title: "Moving",
			blurb: "Walking, going in, coming home",
			pages: [
				"On the shelf and in a world, walk with WASD or the arrow keys. Or click the ground to stroll there. Inside a text file, click to place the caret; arrows move it and letters type.",
				"Press Enter to use whatever you're standing at. Clicking it works too: you walk over and use it when you arrive.",
				"The shelf holds one cabin per world. Inside a world, stone fountains mark folders and portal arches are files.",
				"Walk up to an arch to peek at its file, then press Enter to step inside. Esc, or the arch at the top of a file, takes you back out.",
				"This bonfire is the way home: press Enter beside it, or Esc nearby, to return to the shelf.",
				"The map in the top-right shows folders, paths, files, you and undefeated monsters. Bright clearings are places you've visited. Press M for a larger map, select a file to walk there, and press Esc to close. Map keys stay out of text boxes.",
			],
		},
		{
			id: "tools",
			title: "Tools",
			blurb: "The hotbar and its keys",
			pages: [
				"The hotbar at the bottom of the screen holds your tools. Click a slot or press its key.",
				`Spyglass (${toolKey("spyglass")}): ${TOOL_GUIDE.spyglass}`,
				`Crystal orb (${toolKey("orb")}): searches the whole world by name, path or contents. Inside a file it searches just that file. ${mod}+F opens it too.`,
				`Bag (${alt}+${toolKey("bag")}): copies the caret's selection, or its whole line, into your bag. Shift+arrows or dragging selects text.`,
				`Quill (${alt}+${toolKey("quill")}) opens the spellbook on the page's caret and edits. Wand (${alt}+${toolKey("wand")}) runs the current buffer as a gentle, simulated trace.`,
				`Inside a text file, use ${alt}+${toolKey("spyglass")} for the spyglass and ${alt}+${toolKey("orb")} for the orb. ${alt}+${toolKey("opener")} faces a nearby monster; plain Enter inserts a newline.`,
			],
		},
		{
			id: "monsters",
			title: "Monsters",
			blurb: "What the bugs are, and how to beat them",
			pages: [
				"Bugs in the files take the shape of monsters. They hover by their file's arch, and stand beside their line inside the file.",
				...monsterPages,
				`Inside the file, click a monster or press ${alt}+Enter with the caret within two lines of it. The spellbook opens on its line: fix the bug, save, and it's defeated!`,
			],
		},
		{
			id: "editing",
			title: "Editing",
			blurb: "The spellbook, saving, running",
			pages: [
				`Write directly on the page, or press ${alt}+${toolKey("quill")} to open the spellbook. Both share the caret, unsaved edits and undo history.`,
				`Save with ${spellbookKey("save", style)}. Esc closes the book and keeps your edits on the page. Leaving the file asks Save & leave, Discard or Keep writing if edits are unsaved.`,
				`The book's toolbar has Find (${spellbookKey("find", style)}), Rename (${spellbookKey("rename", style)}), Format (${spellbookKey("format", style)}), Comment (${spellbookKey("comment", style)}) and more. Hover a tool to see its key.`,
				`While the book is open, bag slots become paste buttons, or press ${alt}+1 to 5.`,
				`Run a file with ${alt}+${toolKey("wand")} (or ${spellbookKey("run", style)} in the book). Space plays or pauses, N steps, 1, 2 or 4 sets the speed, Esc stops.`,
				"Edits are kept in this browser, one save per world. The spyglass can reset a single file, or the whole world.",
			],
		},
		{
			id: "previews",
			title: "Previews",
			blurb: "Peeks, pictures, web pages",
			pages: [
				"Each arch shows a live peek of its file in the opening: code, notes, pictures, even a table for CSV files.",
				"Stand right at an arch and a bigger preview opens at the side of the screen.",
				"Pictures, audio and PDFs travel with the world. Audio gets a waveform to play; PDFs page through in the bigger preview and inside the file.",
				"Some arches hold a real web page. Approach to move it into the side preview and interact there. Sites that refuse framing show a title card and Open in browser instead. Only allowed sites can appear.",
				"A file that's too big, looks secret or isn't safe to show stays a sealed chest that says why.",
				"The switch in the top-left corner sets the time of day: Auto follows your clock, or pin Day or Night.",
			],
		},
	];
}

// --- docs/USER_GUIDE.md blocks ----------------------------------------

export type GuideDocBlockId = "tools" | "spellbook" | "monsters" | "tips";

export const GUIDE_DOC_BLOCK_IDS: readonly GuideDocBlockId[] = [
	"tools",
	"spellbook",
	"monsters",
	"tips",
];

function escapeCell(text: string): string {
	return text.replaceAll("|", "\\|");
}

function keyCell(key: string): string {
	return key
		.split(" / ")
		.map((k) => `\`${k}\``)
		.join(" / ");
}

function renderToolsTable(): string {
	const rows = createDefaultTools().map(
		(tool) =>
			`| ${tool.name} | ${keyCell(tool.hotkey)} | ${escapeCell(TOOL_GUIDE[tool.id] ?? "")} |`,
	);
	return ["| Tool | Key | What it does |", "| --- | --- | --- |", ...rows].join(
		"\n",
	);
}

function renderSpellbookTable(): string {
	const rows = SPELLBOOK_TOOLS.map((tool) => {
		const keys = tool.keys.map((k) => keyCell(formatBinding(k, "both")));
		return `| ${tool.label} | ${keys.join(", ")} | ${escapeCell(tool.hint)} |`;
	});
	return [
		"| Tool | Shortcut (Windows/Linux / macOS) | What it does |",
		"| --- | --- | --- |",
		...rows,
	].join("\n");
}

function renderMonsterTable(): string {
	const rows = Object.values(MONSTER_GUIDE).map(
		(m) => `| ${m?.name} | \`${m?.code}\` | ${escapeCell(m?.bug ?? "")} |`,
	);
	return [
		"| Monster | Error code | The bug it stands for |",
		"| --- | --- | --- |",
		...rows,
	].join("\n");
}

function renderTips(): string {
	const sections = guideTopics("both").map((topic) => {
		const pages = topic.pages.map((p) => `- ${p.replaceAll("\n", " ")}`);
		return [`#### ${topic.title}`, "", ...pages].join("\n");
	});
	return [`> ${GUIDE_GREETING}`, "", ...sections.flatMap((s) => [s, ""])]
		.join("\n")
		.trimEnd();
}

export function renderGuideDocBlock(id: GuideDocBlockId): string {
	switch (id) {
		case "tools":
			return renderToolsTable();
		case "spellbook":
			return renderSpellbookTable();
		case "monsters":
			return renderMonsterTable();
		case "tips":
			return renderTips();
	}
}

export function guideDocMarkers(id: GuideDocBlockId): {
	begin: string;
	end: string;
} {
	return {
		begin: `<!-- BEGIN GENERATED guide:${id} (packages/engine/src/systems/guideContent.ts) -->`,
		end: `<!-- END GENERATED guide:${id} -->`,
	};
}

/** Replaces every marked block in `doc` with its current rendering; throws if a marker pair is missing. */
export function syncGuideDoc(doc: string): string {
	let out = doc;
	for (const id of GUIDE_DOC_BLOCK_IDS) {
		const { begin, end } = guideDocMarkers(id);
		const start = out.indexOf(begin);
		const stop = out.indexOf(end);
		if (start < 0 || stop < start) {
			throw new Error(`guide doc: missing markers for block "${id}"`);
		}
		out = `${out.slice(0, start + begin.length)}\n${renderGuideDocBlock(id)}\n${out.slice(stop)}`;
	}
	return out;
}
