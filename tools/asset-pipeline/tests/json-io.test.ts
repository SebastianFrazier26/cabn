import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { formatJson } from "../src/json-io.js";
import {
	generatedDir,
	manifestJsonPath,
	paletteJsonPath,
} from "../src/paths.js";

// Every JSON file `pnpm generate` (or the standalone `ui` script) writes.
const GENERATED_JSON = [
	paletteJsonPath,
	manifestJsonPath,
	path.join(generatedDir, "world-art", "tile-index.json"),
	path.join(generatedDir, "placeholders", "portal_arch_variants.json"),
	path.join(generatedDir, "ui", "manifest.json"),
];

describe("formatJson", () => {
	test("matches Biome: short primitive arrays collapse, objects stay expanded", () => {
		const out = formatJson(
			{ frames: [0, 1, 2, 3], nested: { name: "a" } },
			path.join(generatedDir, "world-art", "tile-index.json"),
		);
		expect(out).toBe(
			'{\n\t"frames": [0, 1, 2, 3],\n\t"nested": {\n\t\t"name": "a"\n\t}\n}\n',
		);
	});
});

describe("committed generated JSON is a fixed point of the pipeline", () => {
	test.each(GENERATED_JSON)("%s re-serializes byte-identically", (file) => {
		const committed = readFileSync(file, "utf8");
		expect(formatJson(JSON.parse(committed), file)).toBe(committed);
	});

	test.each(GENERATED_JSON)("%s carries no wall-clock timestamp", (file) => {
		expect(readFileSync(file, "utf8")).not.toMatch(
			/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
		);
	});
});
