import { describe, expect, test } from "vitest";
import { buildClusters } from "../src/cluster.js";
import { buildClusterTree, buildDirTree } from "../src/tree.js";
import type { WalkedFile } from "../src/walk.js";

function file(path: string): WalkedFile {
	return { path, bytes: 10 };
}

describe("buildClusterTree", () => {
	test("collapses directories with no direct files", () => {
		const files = [file("a/b/c/deep.py"), file("top.py")];
		const tree = buildClusterTree(buildDirTree(files));
		expect(tree.path).toBe("");
		expect(tree.depth).toBe(0);
		// a/ and a/b/ have no direct files, so a/b/c should attach straight to root.
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.path).toBe("a/b/c");
		expect(tree.children[0]?.depth).toBe(1);
	});

	test("keeps the root cluster even with zero direct files", () => {
		const tree = buildClusterTree(buildDirTree([file("only/nested/file.py")]));
		expect(tree.path).toBe("");
		expect(tree.files).toHaveLength(0);
	});
});

describe("buildClusters", () => {
	test("one cluster per file-bearing directory, wired by vine paths", () => {
		const files = [
			file("README.md"),
			file("src/a.ts"),
			file("src/b.ts"),
			file("src/lib/c.ts"),
		];
		const tree = buildClusterTree(buildDirTree(files));
		const { clusters, paths } = buildClusters(tree);

		const ids = clusters.map((c) => c.id).sort();
		expect(ids).toEqual(["root", "src", "src--lib"]);
		expect(paths).toContainEqual({ from: "root", to: "src", kind: "vine" });
		expect(paths).toContainEqual({ from: "src", to: "src--lib", kind: "vine" });
	});

	test("biome rotates meadow/grove/glade by depth", () => {
		const files = [file("root.ts"), file("a/one.ts"), file("a/b/two.ts")];
		const tree = buildClusterTree(buildDirTree(files));
		const { clusters } = buildClusters(tree);
		const byId = Object.fromEntries(clusters.map((c) => [c.id, c.biome]));
		expect(byId.root).toBe("meadow");
		expect(byId.a).toBe("grove");
		expect(byId["a--b"]).toBe("glade");
	});

	test("splits a directory over the cap into annexes linked by trail paths", () => {
		const files = Array.from({ length: 45 }, (_, i) =>
			file(`many/file${i}.ts`),
		);
		const tree = buildClusterTree(buildDirTree(files));
		const { clusters, paths, fileClusterId } = buildClusters(tree, {
			maxFilesPerCluster: 40,
		});

		const many = clusters.find((c) => c.id === "many");
		const annex = clusters.find((c) => c.id === "many__2");
		expect(many?.portalIds).toHaveLength(40);
		expect(annex?.portalIds).toHaveLength(5);
		expect(annex?.annexOf).toBe("many");
		expect(paths).toContainEqual({
			from: "many",
			to: "many__2",
			kind: "trail",
		});

		// Every file lands in exactly one shard.
		const allAssigned = files.every((f) => fileClusterId.has(f.path));
		expect(allAssigned).toBe(true);
	});

	test("annex shares its main shard's biome (same real directory, same depth)", () => {
		const files = Array.from({ length: 41 }, (_, i) =>
			file(`a/many/file${i}.ts`),
		);
		const tree = buildClusterTree(buildDirTree(files));
		const { clusters } = buildClusters(tree, { maxFilesPerCluster: 40 });
		const main = clusters.find((c) => c.id === "a--many");
		const annex = clusters.find((c) => c.id === "a--many__2");
		expect(main?.biome).toBe(annex?.biome);
	});
});
