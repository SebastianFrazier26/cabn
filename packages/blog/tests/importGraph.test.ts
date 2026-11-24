import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

/** Specifiers of imports that exist at run time; `import type` is erased. */
function runtimeImports(file: string): string[] {
	const text = readFileSync(file, "utf8");
	const found: string[] = [];
	const pattern =
		/(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
	for (const match of text.matchAll(pattern)) found.push(match[1] as string);
	return found;
}

function resolveLocal(from: string, specifier: string): string {
	const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
	for (const ext of [".ts", ".tsx"]) {
		if (sourceFiles(src).includes(base + ext)) return base + ext;
	}
	throw new Error(`${specifier} from ${from} resolves to no source file`);
}

describe("import graph", () => {
	it("never reaches the engine or its heavy dependencies", () => {
		const offenders = sourceFiles(src).flatMap((file) =>
			runtimeImports(file)
				.filter((s) => /^(@cabn\/|phaser|@codemirror\/)/.test(s))
				.map((s) => `${relative(src, file)} -> ${s}`),
		);
		expect(offenders).toEqual([]);
	});

	it("has no runtime dependency other than react", () => {
		const external = new Set(
			sourceFiles(src)
				.flatMap(runtimeImports)
				.filter((s) => !s.startsWith(".") && !s.startsWith("node:")),
		);
		expect([...external]).toEqual(["react"]);
	});

	it("keeps the build entry loadable in plain Node: no react, no .tsx", () => {
		const seen = new Set<string>();
		const externals = new Set<string>();
		const queue = [join(src, "build/index.ts")];
		while (queue.length > 0) {
			const file = queue.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			for (const specifier of runtimeImports(file)) {
				if (specifier.startsWith("."))
					queue.push(resolveLocal(file, specifier));
				else externals.add(specifier);
			}
		}
		expect([...seen].filter((file) => file.endsWith(".tsx"))).toEqual([]);
		expect([...externals].filter((s) => !s.startsWith("node:"))).toEqual([]);
		expect(seen.size).toBeGreaterThan(5);
	});
});
