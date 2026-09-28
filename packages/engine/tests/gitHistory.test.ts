import { diffText } from "@cabn/converter/browser";
import type { HistoryCommit, HistoryIndexFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	branchCommits,
	bundleUrl,
	changedPaths,
	currentBranchName,
	fileTimeline,
	rebuildVersion,
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

const oid = (n: number) => n.toString(16).padStart(40, "0");

function commit(n: number, paths: string[], time = n): HistoryCommit {
	return {
		oid: oid(n),
		parents: n > 1 ? [oid(n - 1)] : [],
		author: "Wren",
		time,
		message: `commit ${n}`,
		changes: paths.map((path) => ({
			path,
			status: "modified",
			diff: "included",
		})),
	};
}

const history: HistoryIndexFile = {
	historyVersion: 1,
	head: { branch: "main", oid: oid(3) },
	commits: [
		commit(3, ["a.md"]),
		commit(2, ["b.md"]),
		commit(1, ["a.md", "b.md"]),
		commit(9, ["c.md"]),
	],
	branches: [
		{
			name: "main",
			head: oid(3),
			current: true,
			remote: false,
			commits: [oid(3), oid(2), oid(1)],
			truncated: false,
		},
		{
			name: "side",
			head: oid(9),
			current: false,
			remote: false,
			commits: [oid(9), oid(1)],
			truncated: false,
		},
	],
	tags: [],
	releases: { source: "none", items: [], packages: [] },
	dirtyPaths: [],
	truncated: { branches: false, tags: false, omittedDiffs: 0 },
};

describe("history reads", () => {
	test("branch commits and file timelines follow the branch, newest first", () => {
		expect(currentBranchName(history)).toBe("main");
		expect(branchCommits(history, "main").map((c) => c.message)).toEqual([
			"commit 3",
			"commit 2",
			"commit 1",
		]);
		expect(
			fileTimeline(history, "main", "a.md").map((e) => e.commit.oid),
		).toEqual([oid(3), oid(1)]);
		expect(
			fileTimeline(history, "side", "a.md").map((e) => e.commit.oid),
		).toEqual([oid(1)]);
		expect(fileTimeline(history, "nope", "a.md")).toEqual([]);
		expect([...changedPaths(history.commits[2])]).toEqual(["a.md", "b.md"]);
	});

	test("bundle urls only resolve converter-shaped paths", () => {
		expect(bundleUrl("/w/", `history/commits/${oid(1)}.json`, "diff")).toBe(
			`/w/history/commits/${oid(1)}.json`,
		);
		expect(bundleUrl("/w/", "//evil.example/x.json", "diff")).toBeNull();
		expect(bundleUrl("/w/", "../x/world.json", "universe")).toBeNull();
		expect(
			bundleUrl("/w/", "universes/side-abc123/world.json", "universe"),
		).toBe("/w/universes/side-abc123/world.json");
	});

	test("universe tints are deterministic and absent for the main world", () => {
		expect(universeTint(null)).toBeNull();
		expect(universeTint("side-abc123")).toBe(universeTint("side-abc123"));
		expect(universeTint("side-abc123")).not.toBe(universeTint("other-def456"));
	});

	test("rebuildVersion undoes newer diffs, and refuses a missing step", () => {
		const v1 = "one\ntwo\n";
		const v2 = "one\n2\n";
		const v3 = "zero\none\n2\n";
		const d2 = diffText(v1, v2)?.hunks ?? [];
		const d3 = diffText(v2, v3)?.hunks ?? [];
		expect(rebuildVersion(v3, [])).toBe(v3);
		expect(rebuildVersion(v3, [d3])).toBe(v2);
		expect(rebuildVersion(v3, [d3, d2])).toBe(v1);
		expect(rebuildVersion(v3, [d3, null])).toBeNull();
		expect(rebuildVersion("unrelated\n", [d3])).toBeNull();
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
		history,
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
