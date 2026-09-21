#!/usr/bin/env node
// Maintenance script only — plain JS run against the built dist/ output.
// Uses zod's native v4 toJSONSchema rather than the zod-to-json-schema
// package: that package's published converter reads zod's legacy v3 `_def`
// shape and silently emits an empty schema against v4 schema instances
// (peerDependencies claim v4 support; the actual conversion doesn't hold).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	AssetsFileSchema,
	SearchIndexFileSchema,
	ShelfManifestSchema,
	WorldChunkSchema,
	WorldManifestSchema,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");

const schemas = {
	"world-manifest": WorldManifestSchema,
	"world-chunk": WorldChunkSchema,
	"search-index": SearchIndexFileSchema,
	assets: AssetsFileSchema,
	shelf: ShelfManifestSchema,
};

await mkdir(outDir, { recursive: true });

for (const [name, schema] of Object.entries(schemas)) {
	const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
	await writeFile(
		join(outDir, `${name}.schema.json`),
		`${JSON.stringify(jsonSchema, null, "\t")}\n`,
	);
}

console.log(
	`Wrote ${Object.keys(schemas).length} JSON Schema files to ${outDir}`,
);
