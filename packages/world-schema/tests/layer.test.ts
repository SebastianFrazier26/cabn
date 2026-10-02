import { describe, expect, test } from "vitest";
import {
	assertWorldLayerFits,
	CABN_VERSION,
	type WorldLayerDelta,
	WorldLayerDeltaSchema,
	WorldLayerManifestSchema,
	WorldLayerMismatchError,
	type WorldManifest,
	worldLayerIssues,
} from "../src/index.js";

const AT = "2026-01-01T00:00:00.000Z";

const base: WorldManifest = {
	cabnVersion: CABN_VERSION,
	meta: {
		name: "w",
		source: "w",
		generatedAt: AT,
		fileCount: 1,
		totalBytes: 1,
		truncated: false,
		skippedFiles: 0,
	},
	clusters: [
		{
			id: "root",
			path: ".",
			label: "root",
			pos: { x: 0, y: 0 },
			biome: "meadow",
			portalIds: ["a.ts"],
			chunk: "chunks/root.json",
		},
	],
	paths: [],
	portals: [
		{
			id: "a.ts",
			clusterId: "root",
			file: {
				path: "a.ts",
				name: "a.ts",
				kind: "code",
				bytes: 1,
				binary: false,
			},
			preview: { lines: [], truncated: false },
			spawns: [],
		},
	],
	monsters: [],
	allowedEmbedOrigins: [],
};

function layer(): WorldLayerDelta {
	return {
		layerVersion: 1,
		baseGeneratedAt: AT,
		generatedAt: AT,
		stats: { fileCount: 1, totalBytes: 3, truncated: false, skippedFiles: 0 },
		clusters: [
			{
				id: "root#layer",
				path: ".",
				label: "root",
				pos: { x: 600, y: 0 },
				biome: "meadow",
				portalIds: [".env"],
				chunk: "chunks/root#layer.json",
				annexOf: "root",
			},
		],
		paths: [{ from: "root", to: "root#layer", kind: "trail" }],
		portals: [
			{
				id: ".env",
				clusterId: "root#layer",
				file: {
					path: ".env",
					name: ".env",
					kind: "config",
					bytes: 3,
					binary: false,
				},
				preview: { lines: ["A=1"], truncated: false },
				spawns: [],
			},
		],
		monsters: [],
		extendedMonsters: [],
		signs: [],
		textSha256: { ".env": "a".repeat(64) },
		chunks: {
			"root#layer": {
				clusterId: "root#layer",
				files: { ".env": { content: "A=1", encoding: "utf8" } },
			},
		},
		searchIndex: { engine: "minisearch", version: "7.2.0", index: {} },
	};
}

describe("world layer delta", () => {
	test("a well-formed layer parses and fits its base", () => {
		expect(() => WorldLayerDeltaSchema.parse(layer())).not.toThrow();
		expect(worldLayerIssues(base, layer())).toEqual([]);
		const { chunks: _c, searchIndex: _s, ...manifest } = layer();
		expect(() => WorldLayerManifestSchema.parse(manifest)).not.toThrow();
		expect(() => WorldLayerManifestSchema.parse(layer())).toThrow();
	});

	test("a stale layer is refused", () => {
		const stale = { ...layer(), baseGeneratedAt: "2025-01-01T00:00:00.000Z" };
		expect(() => assertWorldLayerFits(base, stale)).toThrow(
			WorldLayerMismatchError,
		);
		expect(worldLayerIssues(base, stale)).toEqual([
			"stale: computed for a different base world",
		]);
	});

	test("collisions, dangling references and base-only paths are issues", () => {
		const bad = layer();
		const baseRoot = base.clusters[0];
		if (baseRoot) bad.clusters.push({ ...baseRoot, portalIds: [] });
		bad.paths.push({ from: "root", to: "nowhere", kind: "vine" });
		bad.extendedMonsters.push({
			id: "m1",
			portalId: "a.ts",
			species: "magpie",
			error: { code: "LeakedSecret", rule: "r", message: "m" },
			tier: 3,
		});
		bad.textSha256["a.ts"] = "b".repeat(64);
		const issues = worldLayerIssues(base, bad);
		expect(issues).toContain('cluster "root" collides');
		expect(issues).toContain("path root::nowhere dangles");
		const baseOnly = layer();
		baseOnly.paths.push({ from: "root", to: "root", kind: "vine" });
		expect(worldLayerIssues(base, baseOnly)).toEqual([
			"path root::root joins two base clusters",
		]);
		expect(issues).toContain('monster "m1" is not on a layer portal or path');
		expect(issues).toContain('hash for "a.ts" names no layer portal');
	});

	test("hashes must be lowercase sha256 hex", () => {
		const bad = layer();
		bad.textSha256[".env"] = "XYZ";
		expect(() => WorldLayerDeltaSchema.parse(bad)).toThrow();
	});
});
