import { buildSearchIndex } from "@cabn/converter/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPetWorldAccess } from "../../src/pets/worldAccess.js";

afterEach(() => vi.unstubAllGlobals());

describe("pet world access", () => {
	it("never lists, reads or finds a hidden path, even if one reaches its source", async () => {
		const index = buildSearchIndex([
			{ id: "a.ts", path: "a.ts", name: "a.ts", content: "canary visible" },
			{ id: ".env", path: ".env", name: ".env", content: "canary SECRET=1" },
			{
				id: ".github/ci.yml",
				path: ".github/ci.yml",
				name: "ci.yml",
				content: "canary",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(index))),
		);
		const access = createPetWorldAccess({
			worldBase: "/w/",
			files: [
				{ path: "a.ts", bytes: 1, kind: "code" },
				{ path: ".env", bytes: 1, kind: "config" },
				{ path: ".github/ci.yml", bytes: 1, kind: "config" },
			],
			loadedText: (path) => `text of ${path}`,
			savedOverride: () => undefined,
			chunkFor: () => "chunks/x.json",
			withheld: () => null,
		});
		expect(access.files().map((f) => f.path)).toEqual(["a.ts"]);
		expect(await access.readText(".env")).toBeNull();
		expect(await access.readText(".github/ci.yml")).toBeNull();
		expect(await access.readText("a.ts")).toBe("text of a.ts");
		expect(await access.search("canary", 10)).toEqual([{ path: "a.ts" }]);
	});

	it("finds nothing when it is handed no files (a layer hiding the base world)", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const access = createPetWorldAccess({
			worldBase: "/w/",
			files: [],
			loadedText: () => undefined,
			savedOverride: () => undefined,
			chunkFor: () => undefined,
			withheld: () => null,
		});
		expect(access.files()).toEqual([]);
		expect(await access.search("canary", 10)).toEqual([]);
		expect(await access.readText("a.ts")).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
