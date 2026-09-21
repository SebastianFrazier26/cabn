import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest, type WorldManifest } from "@cabn/world-schema";

export function formatSummary(manifest: WorldManifest): string {
	const kindCounts = new Map<string, number>();
	for (const portal of manifest.portals) {
		kindCounts.set(
			portal.file.kind,
			(kindCounts.get(portal.file.kind) ?? 0) + 1,
		);
	}
	const topKinds = [...kindCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([kind, count]) => `${kind}:${count}`)
		.join(", ");

	const clusterLines = manifest.clusters.map((cluster) => {
		const depth = cluster.path === "." ? 0 : cluster.path.split("/").length;
		const annex = cluster.annexOf ? ` (annex of ${cluster.annexOf})` : "";
		return `${"  ".repeat(depth)}- ${cluster.label} [${cluster.biome}] (${cluster.portalIds.length} portals)${annex}`;
	});

	const truncatedLine = manifest.meta.truncated
		? [
				`Warning: partial world — ${manifest.meta.skippedFiles} file(s) were dropped by the converter's caps.`,
			]
		: [];

	return [
		`${manifest.meta.name} (cabn v${manifest.cabnVersion})`,
		`${manifest.clusters.length} clusters, ${manifest.portals.length} portals, ${manifest.meta.totalBytes} bytes`,
		`Top file kinds: ${topKinds || "none"}`,
		...truncatedLine,
		"",
		...clusterLines,
	].join("\n");
}

export async function runInspect(bundleDir: string): Promise<WorldManifest> {
	const raw = await readFile(join(bundleDir, "world.json"), "utf8");
	return validateManifest(JSON.parse(raw));
}
