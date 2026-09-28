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
		"Same as pressing Enter: step into a cabin or portal, back out at the bonfire or a file's top arch, face a monster, talk to Wren.",
	spyglass:
		"Lists the files in the clearing you're standing in; click one to walk straight to it.",
	orb: "Searches the whole world by name, path or contents; inside a file it searches that file's lines. Ctrl/Cmd+F opens it too.",
	bag: "Inside a file: starts picking lines at your spot (Shift+Up/Down stretches the pick), and a second press tucks them into a bag slot (up to 5).",
	quill:
		"Inside a file: opens the spellbook (the editor) on the line nearest you.",
	wand: "Inside a file: runs it as a simulated trace, a spark walking the code line by line. The code itself never runs unless you started a local server with --allow-exec.",
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
				"Walk with WASD or the arrow keys. Or click the ground and you'll stroll there by yourself; any movement key stops a stroll.",
				"Press Enter to use whatever you're standing at. Clicking it works too: you walk over and use it when you arrive.",
				"The shelf holds one cabin per world. Inside a world, stone fountains mark folders and portal arches are files.",
				"Walk up to an arch to peek at its file, then press Enter to step inside. Esc, or the arch at the top of a file, takes you back out.",
				"This bonfire is the way home: press Enter beside it, or Esc nearby, to return to the shelf.",
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
				`Bag (${toolKey("bag")}): inside a file, starts picking lines. Shift+Up/Down stretches the pick; ${toolKey("bag")} again tucks it into your bag.`,
				`Quill (${toolKey("quill")}) opens the spellbook to edit a file. Wand (${toolKey("wand")}) runs it as a gentle, simulated trace.`,
				`The key tool (${toolKey("opener")}) is the same as pressing Enter, for when a click is handier.`,
			],
		},
		{
			id: "monsters",
			title: "Monsters",
			blurb: "What the bugs are, and how to beat them",
			pages: [
				"Bugs in the files take the shape of monsters. They hover by their file's arch, and stand beside their line inside the file.",
				...monsterPages,
				"Inside the file, walk up to a monster and press Enter (or click it). The spellbook opens on its line: fix the bug, save, and it's defeated!",
			],
		},
		{
			id: "editing",
			title: "Editing",
			blurb: "The spellbook, saving, running",
			pages: [
				`Inside a file, press ${toolKey("quill")} to open the spellbook on the line nearest you.`,
				`Save with ${spellbookKey("save", style)}. Esc closes the book, and asks first if you have unsaved changes.`,
				`The book's toolbar has Find (${spellbookKey("find", style)}), Rename (${spellbookKey("rename", style)}), Format (${spellbookKey("format", style)}), Comment (${spellbookKey("comment", style)}) and more. Hover a tool to see its key.`,
				`While the book is open, bag slots become paste buttons, or press ${alt}+1 to 5.`,
				`Run a file with ${toolKey("wand")} (or ${spellbookKey("run", style)} in the book). Space plays or pauses, N steps, 1, 2 or 4 sets the speed, Esc stops.`,
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
				"Some arches hold a real web page. Click the page in the arch, or Open in browser, to visit it in a new tab. Only sites the world's author allowed can appear.",
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
