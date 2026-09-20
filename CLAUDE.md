# cabn — agent guide

TypeScript pnpm monorepo. Node 22, ESM only, TypeScript strict, Biome for lint + format, Vitest for tests.

## Commands (run from repo root)

- `pnpm install` — install workspace deps
- `pnpm build` — `pnpm -r build` (tsc per package, topological order)
- `pnpm test` — `pnpm -r test` (Vitest per package)
- `pnpm lint` — `biome check .`
- `pnpm format` — `biome format --write .`

## Layout

- `packages/world-schema` — `@cabn/world-schema`, world data model; other packages depend on it via `workspace:*`
- `packages/converter` — `@cabn/converter`, directory/zip → world conversion
- `packages/engine` — `@cabn/engine`, game engine (phaser/react deps deferred to a later milestone)
- `packages/cli` — `@cabn/cli`, `cabn` bin
- `apps/backend` — private, Fastify planned but not yet installed
- `apps/demo` — private, demo app stub
- `tools/asset-pipeline` — private, asset tooling stub
- `assets/source/icons` — source art PNGs
- Rust prototype lives on the `rust-prototype` branch, not in this tree

## Conventions

- TS strict ESM everywhere; package builds emit to `dist/`, tests live in `tests/` (outside tsc `include`)
- Add runtime deps only in the milestone that uses them — stubs stay dep-free
- Comments load-bearing only: explain why, never narrate what the code says
- Branch per feature off `master`; never commit to `master` directly; never push without explicit user authorization
- User-visible changes get a dated `CHANGELOG.md` entry
