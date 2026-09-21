# cabn — agent guide

TypeScript pnpm monorepo. Node 22, ESM only, TypeScript strict, Biome for lint + format, Vitest for tests.

## Commands (run from repo root)

- `pnpm install` — install workspace deps
- `pnpm build` — `pnpm -r build` (tsc per package, topological order)
- `pnpm test` — `pnpm -r test` (Vitest per package)
- `pnpm lint` — `biome check .`
- `pnpm format` — `biome format --write .`
- `pnpm -F @cabn/demo dev` — run the walkable demo (predev converts `apps/demo/sample-project/` into a world bundle if one isn't already built)
- `pnpm -F @cabn/demo build:world` — (re)convert the sample project and sync sprites into `apps/demo/public/`; append `-- --force` to rebuild an already-built world

## Layout

- `packages/world-schema` — `@cabn/world-schema`, world data model; other packages depend on it via `workspace:*`
- `packages/converter` — `@cabn/converter`, directory/zip → world conversion
- `packages/engine` — `@cabn/engine`, Phaser 3 + zustand + mitt game engine (scenes, React bridge — `CabnGame`/`FileOverlay`)
- `packages/cli` — `@cabn/cli`, `cabn` bin
- `apps/backend` — private, Fastify planned but not yet installed
- `apps/demo` — private, Vite + React app that converts `sample-project/` and renders it via `@cabn/engine`
- `tools/asset-pipeline` — private, `@cabn/asset-pipeline`; palette extraction, sprite recovery, placeholder generation, preview page (see its scripts: `palette`, `recover`, `placeholders`, `preview`, `generate`)
- `assets/source/icons` — source art PNGs
- Rust prototype lives on the `rust-prototype` branch, not in this tree

## Conventions

- TS strict ESM everywhere; package builds emit to `dist/`, tests live in `tests/` (outside tsc `include`)
- Add runtime deps only in the milestone that uses them — stubs stay dep-free
- Comments load-bearing only: explain why, never narrate what the code says
- Branch per feature off `main`; never commit to `main` directly; never push without explicit user authorization
- User-visible changes get a dated `CHANGELOG.md` entry
