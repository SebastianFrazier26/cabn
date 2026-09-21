# Changelog

## 2026-09-20

- M1: world data contract, converter core, and CLI build/inspect.
  - `@cabn/world-schema`: zod schemas + inferred types for the world bundle (`world.json` manifest, per-cluster chunks, minisearch index, assets file), a `validateManifest` helper, and committed JSON Schema exports (`pnpm -F @cabn/world-schema gen:jsonschema`).
  - `@cabn/converter`: `convert(source, opts)` turns a `DirSource` or `ZipSource` into a validated world bundle — directory walk with ignores/caps, file classification, preview extraction, deterministic seeded-jitter radial layout, cluster/annex splitting, and a minisearch index. Ships a browser-safe `./browser` entry (no `DirSource`) and the M1 annotation extension point (`Annotator` type + error-code-to-species taxonomy) with no implementations yet.
  - `@cabn/cli`: `cabn build <dir|zipfile>` and `cabn inspect <bundleDir>`.
- M1 code review fixes: zip hardening, collision safety, secret exclusion.
  - `ZipSource` now sanitizes entry names (rejects zip-slip: `..`, absolute paths, backslash traversal) and enforces hard caps *during* extraction via fflate's streaming `Unzip` — entry count, per-entry decompressed bytes (oversized entries become metadata-only), and a new whole-archive decompressed-bytes cap (`maxTotalBytes`, default 256MB), rather than decompressing everything up front like the old `unzipSync` call.
  - `@cabn/converter` default ignore list gains secret-pattern files (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*credentials*`, `.npmrc`, `.netrc`): still listed as portals (name visible), content never read into a chunk or the search index. `convert({ includeSecrets: true })` / `cabn build --include-secrets` restore the old behavior.
  - Cluster id slug collisions (e.g. a nested `a/b` vs. a literal `a--b` directory, or a real `foo__2` vs. an annex) now get a short content-hash suffix instead of silently overwriting each other; `WorldManifestSchema` gained cross-reference checks (duplicate cluster/portal ids, dangling `clusterId`/path/`portalIds` references) so a corrupted manifest fails validation instead of loading broken.
  - Root's own annex clusters (root directory with >40 files) are re-attached to the radial layout instead of stacking at the origin.
  - `preview.ts` no longer splits an astral character's UTF-16 surrogate pair at the 120-char cut.
  - `convert.ts` builds chunk file maps via `Map`/`Object.fromEntries` instead of bracket-assigning into a plain object, so a file named `__proto__` no longer vanishes into the prototype setter instead of erroring.
  - `WorldMeta` gained `truncated`/`skippedFiles`; `cabn build`/`cabn inspect` print a warning when a world is partial.
  - All `world-schema` objects are now `z.strictObject` (unknown keys fail validation).
  - `minisearch` pinned to an exact version (no `^`) to match the hardcoded `MINISEARCH_VERSION` constant; `cli.ts`'s `parseArgs` calls moved inside their try/catch so a bad flag exits 1 with a message instead of crashing.
- Repo rebooted as a TypeScript pnpm monorepo (M0 scaffold): workspaces for `packages/*`, `apps/*`, `tools/*`; TypeScript strict ESM, Biome, Vitest, Node 22, CI workflow.
- Rust prototype parked on the `rust-prototype` branch and removed from this branch.
- Icons moved to `assets/source/icons/`.
