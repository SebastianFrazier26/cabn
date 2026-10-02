import { describe, expect, test } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	commitSubject,
	shortOid,
	universeSlug,
	universeTint,
} from "../src/systems/gitHistory.js";
import {
	clearStash,
	readStash,
	stashKey,
	writeStash,
} from "../src/systems/gitStash.js";
import {
	parseInline,
	parseMarkdownLite,
	safeHref,
} from "../src/systems/markdownLite.js";

const meta = {
	gitVersion: 1 as const,
	head: { branch: "main", oid: "a".repeat(40) },
	branches: [],
	tags: [],
	pack: { bytes: 0, objects: 0, commitsPerBranch: 200, halvings: 0 },
	omitted: {},
	truncated: { branches: false, tags: false },
};

describe("git helpers", () => {
	test("universe slugs and tints are deterministic; the main world has no tint", () => {
		expect(universeSlug("feature/lanterns")).toMatch(
			/^feature-lanterns-[0-9a-f]{6}$/,
		);
		expect(universeSlug("feature/lanterns")).toBe(
			universeSlug("feature/lanterns"),
		);
		expect(universeTint(null)).toBeNull();
		expect(universeTint("a-1")).toBe(universeTint("a-1"));
		expect(universeTint("a-1")).not.toBe(universeTint("b-2"));
		expect(commitSubject("Plant\n\nbody")).toBe("Plant");
		expect(shortOid("abcdef0123")).toBe("abcdef0");
	});
});

describe("markdown-lite", () => {
	test("keeps only http(s) links", () => {
		expect(safeHref("https://github.com/x")).toBe("https://github.com/x");
		expect(safeHref("javascript:alert(1)")).toBeNull();
		expect(safeHref("data:text/html,hi")).toBeNull();
		expect(safeHref("/relative")).toBeNull();
		expect(parseInline("[click](javascript:void0)")).toEqual([
			{ kind: "text", text: "click" },
		]);
	});

	test("raw HTML stays text", () => {
		expect(parseMarkdownLite("<img src=x onerror=alert(1)>")).toEqual([
			{
				kind: "paragraph",
				inline: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }],
			},
		]);
	});

	test("headings, lists, code and inline marks", () => {
		const blocks = parseMarkdownLite(
			"## What's new\n- **bold** and `code`\n- see https://github.com/wren\n\n```\nx < y\n```\n1. first",
		);
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"list",
			"code",
			"list",
		]);
		const list = blocks[1];
		if (list?.kind !== "list") throw new Error("expected a list");
		expect(list.items[0]?.[0]).toEqual({
			kind: "strong",
			children: [{ kind: "text", text: "bold" }],
		});
		expect(list.items[1]?.[1]).toEqual({
			kind: "link",
			text: "https://github.com/wren",
			href: "https://github.com/wren",
		});
	});
});

describe("browser stash", () => {
	function memoryStorage() {
		const data = new Map<string, string>();
		return {
			data,
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			removeItem: (k: string) => void data.delete(k),
		};
	}

	test("round-trips per repository and branch", () => {
		const storage = memoryStorage();
		writeStash(storage, "/repo", {
			branch: "main",
			savedAt: "2026-09-28T00:00:00.000Z",
			files: { "a.md": "edited\n" },
		});
		expect(readStash(storage, "/repo", "main")?.files).toEqual({
			"a.md": "edited\n",
		});
		expect(readStash(storage, "/repo", "other")).toBeNull();
		expect(readStash(storage, "/other-repo", "main")).toBeNull();
		clearStash(storage, "/repo", "main");
		expect(readStash(storage, "/repo", "main")).toBeNull();
	});

	test("garbage and mismatched entries read as no stash", () => {
		const storage = memoryStorage();
		storage.setItem(stashKey("/repo", "main"), "{not json");
		expect(readStash(storage, "/repo", "main")).toBeNull();
		storage.setItem(
			stashKey("/repo", "main"),
			JSON.stringify({ branch: "evil", savedAt: "x", files: {} }),
		);
		expect(readStash(storage, "/repo", "main")).toBeNull();
	});
});

describe("store git state", () => {
	const ctx = {
		meta,
		generatedAt: "2026-09-28T00:00:00.000Z",
		historyBase: "/w/",
		branch: "main",
		universe: null,
		worldId: "abc",
		rootSource: "/repo",
	};

	test("the universe picker opens only in the world, with history, nothing else modal", () => {
		const store = createCabnStore();
		store.getState().setUniverseOpen(true);
		expect(store.getState().universeOpen).toBe(false);
		store.getState().setGit(ctx);
		store.getState().setGuideOpen(true);
		store.getState().setUniverseOpen(true);
		expect(store.getState().universeOpen).toBe(false);
		store.getState().setGuideOpen(false);
		store.getState().setUniverseOpen(true);
		expect(store.getState().universeOpen).toBe(true);
	});

	test("leaving for the shelf clears git state", () => {
		const store = createCabnStore();
		store.getState().setGit(ctx);
		store.getState().setPensievePortalId("a.md");
		store.getState().clearWorldContext();
		expect(store.getState().git).toBeNull();
		expect(store.getState().pensievePortalId).toBeNull();
	});
});
