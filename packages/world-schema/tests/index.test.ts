import { describe, expect, test } from "vitest";
import {
	CABN_VERSION,
	validateManifest,
	WorldChunkSchema,
	WorldManifestValidationError,
} from "../src/index.js";

function baseCluster() {
	return {
		id: "root",
		path: ".",
		label: "home",
		pos: { x: 0, y: 0 },
		biome: "meadow",
		portalIds: ["p1"],
		chunk: "chunks/root.json",
	};
}

function basePortal() {
	return {
		id: "p1",
		clusterId: "root",
		file: {
			path: "README.md",
			name: "README.md",
			kind: "markdown",
			bytes: 42,
			lines: 3,
			binary: false,
		},
		preview: { lines: ["# home"], truncated: false },
		spawns: [],
	};
}

function validManifest() {
	return {
		cabnVersion: CABN_VERSION,
		meta: {
			name: "home",
			source: "/tmp/home",
			generatedAt: new Date().toISOString(),
			fileCount: 1,
			totalBytes: 42,
			truncated: false,
			skippedFiles: 0,
		},
		clusters: [baseCluster()],
		paths: [],
		portals: [basePortal()],
		monsters: [],
	};
}

describe("validateManifest", () => {
	test("accepts a well-formed manifest and returns it typed", () => {
		const manifest = validateManifest(validManifest());
		expect(manifest.cabnVersion).toBe(1);
		expect(manifest.clusters[0]?.id).toBe("root");
	});

	test("rejects a manifest with the wrong cabnVersion literal", () => {
		const bad = { ...validManifest(), cabnVersion: 2 };
		expect(() => validateManifest(bad)).toThrow(WorldManifestValidationError);
	});

	test("rejects unknown biome values", () => {
		const bad = validManifest();
		bad.clusters[0].biome = "swamp";
		expect(() => validateManifest(bad)).toThrow(/biome/i);
	});

	test("rejects a preview line over 120 chars", () => {
		const bad = validManifest();
		bad.portals[0].preview.lines = ["x".repeat(121)];
		expect(() => validateManifest(bad)).toThrow();
	});

	test("rejects an unknown top-level key (strict object)", () => {
		const bad = { ...validManifest(), somethingExtra: true };
		expect(() => validateManifest(bad)).toThrow();
	});

	test("rejects an unknown key on a nested object (strict object)", () => {
		const bad = validManifest();
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input for the test
		(bad.clusters[0] as any).extra = "nope";
		expect(() => validateManifest(bad)).toThrow();
	});

	test("aggregates multiple issues into one readable message", () => {
		const bad = {
			...validManifest(),
			cabnVersion: 2,
			clusters: "not-an-array",
		};
		try {
			validateManifest(bad);
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(WorldManifestValidationError);
			const message = (err as WorldManifestValidationError).issues;
			expect(message).toContain("cabnVersion");
			expect(message).toContain("clusters");
		}
	});

	test("annexOf links a split cluster to its parent", () => {
		const manifest = validManifest();
		manifest.clusters.push({
			id: "root__2",
			path: ".",
			label: "home (2)",
			pos: { x: 10, y: 0 },
			biome: "grove",
			portalIds: [],
			chunk: "chunks/root__2.json",
			annexOf: "root",
		});
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	test("rejects duplicate cluster ids", () => {
		const manifest = validManifest();
		manifest.clusters.push({ ...baseCluster(), portalIds: [] });
		expect(() => validateManifest(manifest)).toThrow(/duplicate cluster id/);
	});

	test("rejects duplicate portal ids", () => {
		const manifest = validManifest();
		manifest.portals.push(basePortal());
		expect(() => validateManifest(manifest)).toThrow(/duplicate portal id/);
	});

	test("rejects a portal referencing an unknown clusterId", () => {
		const manifest = validManifest();
		manifest.portals = [{ ...basePortal(), clusterId: "does-not-exist" }];
		expect(() => validateManifest(manifest)).toThrow(/unknown clusterId/);
	});

	test("rejects a path referencing an unknown cluster", () => {
		const manifest = validManifest();
		manifest.paths.push({ from: "root", to: "nowhere", kind: "vine" });
		expect(() => validateManifest(manifest)).toThrow(/unknown cluster/);
	});

	test("rejects a cluster referencing an unknown portal", () => {
		const manifest = validManifest();
		manifest.clusters = [
			{
				...baseCluster(),
				portalIds: [...baseCluster().portalIds, "no-such-portal"],
			},
		];
		expect(() => validateManifest(manifest)).toThrow(/unknown portal/);
	});
});

describe("WorldChunkSchema", () => {
	test("parses a chunk keyed by portal id", () => {
		const chunk = WorldChunkSchema.parse({
			clusterId: "root",
			files: {
				p1: { content: "# home", encoding: "utf8" },
			},
		});
		expect(chunk.files.p1?.content).toBe("# home");
	});

	test("rejects an unknown key (strict object)", () => {
		expect(() =>
			WorldChunkSchema.parse({
				clusterId: "root",
				files: {},
				extra: true,
			}),
		).toThrow();
	});
});
