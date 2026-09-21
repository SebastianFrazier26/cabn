// Browser-safe entry point (package.json "./browser" export) — everything
// here must avoid node:* imports. DirSource lives outside this barrel; only
// src/sources/dir.ts is allowed to import node:* (see test/node-imports.test.ts).
export * from "./annotate/index.js";
export * from "./classify.js";
export * from "./cluster.js";
export * from "./convert.js";
export * from "./layout.js";
export * from "./preview.js";
export * from "./search-index.js";
export * from "./shelf.js";
export * from "./sources/types.js";
export * from "./sources/zip.js";
export * from "./tree.js";
export * from "./walk.js";
