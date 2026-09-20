# Changelog

## 2026-09-20

- M1: world data contract, converter core, and CLI build/inspect.
  - `@cabn/world-schema`: zod schemas + inferred types for the world bundle (`world.json` manifest, per-cluster chunks, minisearch index, assets file), a `validateManifest` helper, and committed JSON Schema exports (`pnpm -F @cabn/world-schema gen:jsonschema`).
  - `@cabn/converter`: `convert(source, opts)` turns a `DirSource` or `ZipSource` into a validated world bundle — directory walk with ignores/caps, file classification, preview extraction, deterministic seeded-jitter radial layout, cluster/annex splitting, and a minisearch index. Ships a browser-safe `./browser` entry (no `DirSource`) and the M1 annotation extension point (`Annotator` type + error-code-to-species taxonomy) with no implementations yet.
  - `@cabn/cli`: `cabn build <dir|zipfile>` and `cabn inspect <bundleDir>`.
- Repo rebooted as a TypeScript pnpm monorepo (M0 scaffold): workspaces for `packages/*`, `apps/*`, `tools/*`; TypeScript strict ESM, Biome, Vitest, Node 22, CI workflow.
- Rust prototype parked on the `rust-prototype` branch and removed from this branch.
- Icons moved to `assets/source/icons/`.
