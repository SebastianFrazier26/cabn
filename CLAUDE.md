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
- `pnpm -F @cabn/demo build && pnpm -F @cabn/demo e2e` — Playwright browser smoke test against a `vite preview` of the production build (see README's "Browser smoke test")
- `cabn build <dir> [--offline]` — `--offline` skips the build-time url-preview framability check (the only network request cabn makes; the backend never makes it)
- `cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms] [--offline]` — convert `<dir>` in memory and serve it as a walkable game on `127.0.0.1` only; `--allow-exec` enables REAL code execution of files run with the wand tool (only use on code you trust — see README's `cabn serve` section)
- `pnpm -F @cabn/backend dev` / `test` / `build` / `start` — the Fastify converter backend; `pnpm -F @cabn/backend keygen` generates a new API key (prints plaintext once + its SHA-256 for `CABN_API_KEY_SHA256`) — see README's "Backend API" section
- `pnpm changeset` — record a version bump for one of the four publishable packages (`world-schema`/`converter`/`engine`/`cli`); publishing itself is a manual `workflow_dispatch` only, see README's "Releasing" section

## Layout

- `packages/world-schema` — `@cabn/world-schema`, world data model; other packages depend on it via `workspace:*`
- `packages/converter` — `@cabn/converter`, directory/zip → world conversion
- `packages/engine` — `@cabn/engine`, Phaser 3 + zustand + mitt game engine (scenes, React bridge — `CabnGame`/`FileOverlay`). Main entry (`.`) is always execution-safe (`TraceProvider` only); real execution (`LocalRunProvider`) lives behind a separate `./local-exec` subpath export that only a `cabn serve --allow-exec` host page ever imports
- `packages/cli` — `@cabn/cli`, `cabn` bin (`build`/`inspect`/`shelf`/`serve`)
- `apps/backend` — private, `@cabn/backend`, an authenticated Fastify service wrapping `@cabn/converter` (`POST /v1/worlds`, `GET /healthz`)
- `apps/demo` — private, Vite + React app that converts `sample-project/` and renders it via `@cabn/engine`; `e2e/` holds the Playwright browser smoke test
- `tools/asset-pipeline` — private, `@cabn/asset-pipeline`; palette extraction, sprite recovery, placeholder generation, preview page (see its scripts: `palette`, `recover`, `placeholders`, `preview`, `generate`)
- `assets/source/icons` — source art PNGs
- Rust prototype lives on the `rust-prototype` branch, not in this tree

## Conventions

- TS strict ESM everywhere; package builds emit to `dist/`, tests live in `tests/` (outside tsc `include`)
- Add runtime deps only in the milestone that uses them — stubs stay dep-free
- Comments load-bearing only: explain why, never narrate what the code says
- Branch per feature off `main`; never commit to `main` directly; never push without explicit user authorization
- User-visible changes get a dated `CHANGELOG.md` entry
