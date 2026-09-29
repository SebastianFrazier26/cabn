import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

// The main entry carries only the neutral world-layer seam: the shadow
// realm's client, skin and tokens must be reachable from ./owner alone.
const SRC = join(import.meta.dirname, "..", "src");

function resolveSpec(from: string, spec: string): string | null {
	const stem = join(dirname(from), spec.replace(/\.js$/, ""));
	for (const candidate of [`${stem}.ts`, `${stem}.tsx`])
		if (existsSync(candidate)) return candidate;
	return null;
}

async function reachable(entry: string): Promise<Set<string>> {
	const seen = new Set<string>();
	const visit = async (file: string): Promise<void> => {
		const rel = relative(SRC, file);
		if (seen.has(rel)) return;
		seen.add(rel);
		const source = await readFile(file, "utf8");
		for (const m of source.matchAll(
			/(?:import|export)[^"';]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g,
		)) {
			const spec = m[1] ?? m[2];
			if (!spec) continue;
			const next = resolveSpec(file, spec);
			if (!next) throw new Error(`unresolved import ${spec} in ${rel}`);
			await visit(next);
		}
	};
	await visit(join(SRC, entry));
	return seen;
}

describe("engine import graph", () => {
	test("index.ts never reaches src/shadow/", async () => {
		const files = await reachable("index.ts");
		expect(files.has("scenes/WorldScene.ts")).toBe(true);
		expect(files.has("systems/worldLayer.ts")).toBe(true);
		expect([...files].filter((f) => f.startsWith("shadow/"))).toEqual([]);
	});

	test("owner.ts does reach the shadow realm", async () => {
		const files = await reachable("owner.ts");
		expect(files.has("shadow/provider.ts")).toBe(true);
		expect(files.has("shadow/client.ts")).toBe(true);
	});
});
