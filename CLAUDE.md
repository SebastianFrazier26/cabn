# cabn — agent guide

TypeScript pnpm monorepo. Node 22, ESM only, TypeScript strict, Biome for lint + format, Vitest for tests, Playwright for browser tests. Architecture overview: `docs/ARCHITECTURE.md`. Player-facing docs: `README.md`, `docs/USER_GUIDE.md`, `docs/SEYN.md`.

## Commands (run from repo root)

- `pnpm install` — install workspace deps
- `pnpm build` — `pnpm -r build` (tsc per package, topological order)
- `pnpm test` — `pnpm -r test` (Vitest per package)
- `pnpm lint` — `biome check .`
- `pnpm format` — `biome format --write .`
- Full check before a commit: `pnpm -r build && pnpm -r test && pnpm lint` (CI runs the same, plus `pnpm audit --audit-level=high` and the Playwright suite)
- `pnpm -F @cabn/demo dev` — run the walkable demo. `predev` runs `scripts/build-world.mjs`, which rebuilds each demo world (`sample`, `notes`) only when its fingerprint changed
- `pnpm -F @cabn/demo build:world` — the same world check on its own; `-- --force` rebuilds every world regardless
- `pnpm -F @cabn/demo build` — production build; type-checks `src/` and then `e2e/` first, and `postbuild` runs the four bundle checks (below)
- `pnpm -F @cabn/demo typecheck:e2e` — `tsc --noEmit` over the Playwright specs (`e2e/tsconfig.json`). The specs import `packages/*/dist`, so the engine and world-schema must be built first; that's why it runs inside `build` (topological order) rather than `pnpm lint`
- `pnpm -F @cabn/demo e2e` — Playwright against `vite preview` of the production build (build first)
- `pnpm -F @cabn/backend dev` / `test` / `build` / `start` — the Fastify converter backend; `pnpm -F @cabn/backend keygen` prints a new API key once plus its SHA-256 for `CABN_API_KEY_SHA256`
- `pnpm -F @cabn/asset-pipeline generate` — regenerate all art (deterministic: a no-op on unchanged inputs); it chains the sub-scripts in `tools/asset-pipeline/package.json` (`palette`, `recover`, `placeholders`, `soften`, `world-art`, `signpost`, `pets`, `shadow`, `preview`, ...), each runnable alone
- `railway up --service cabn-backend` / `--service cabn-demo` — redeploy to the Railway project `cabn` (README's "Deploying (Railway)"). The demo image (`apps/demo/Dockerfile`) is Caddy with the CSP header rendered from `csp-policy.mjs` into `apps/demo/Caddyfile`; `.railwayignore` keeps the upload small enough to go through
- `pnpm changeset` — record a version bump for one of the five publishable packages (`world-schema`/`converter`/`engine`/`cli`/`shadow-art`); publishing is a manual `workflow_dispatch` only (README's "Releasing")
- `pnpm check:packs` — after a build, runs `pnpm pack --dry-run --json` in each publishable package and fails on `.map` files, `src/`/`tests/`, or shadow art in `@cabn/cli` (`scripts/check-packs.mjs`; CI and the release workflow run it). Published packages build with `sourceMap`/`declarationMap` off in their own `tsconfig.json`; `tsconfig.base.json` keeps them on for the private apps and tools

### The CLI (`node packages/cli/dist/main.js`, bin name `cabn`)

- `cabn build <dir|zip> [-o outDir] [--include-secrets] [--offline] [--findings file]... [--no-history] [--git-dir path]` — default output `./<name>-world/`. `--offline` skips the build-time url-preview framability check and the GitHub releases request (the only network requests cabn makes; the backend never makes them). A repo root (a real `<dir>/.git` directory, checked with lstat) also ships a read-only `git/` directory and `releases.json`. A `.git` symlink or pointer file (worktrees, submodules) gets no history and a path-free note; `--git-dir` is the explicit opt-in (linked worktrees still fail: isomorphic-git doesn't follow `commondir`)
- `cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms] [--offline] [--owner] [--no-history] [--git-dir path]` — converts in memory, serves on `127.0.0.1` only. The page (`GET /`) answers 404 unless `?token=` matches the session token in the printed URL; e2e specs navigate to that printed URL. `--allow-exec` enables REAL execution of wand runs (trusted code only). `--owner` (off by default, the one owner flag) enables owner mode: the owner's toolkit (`O`), sign writes, git writes (commit/branch/switch, never push/fetch) and the shadow realm. `?e2e=1` on a serve page exposes `window.__cabnStore`/`__cabnBus` for tests
- `cabn shelf <bundleDir...> [-o outDir]`, `cabn inspect <bundleDir>`

### Test and debug switches

- `CABN_UPDATE_GUIDE=1` — `CABN_UPDATE_GUIDE=1 pnpm -F @cabn/engine exec vitest run tests/guideDoc.test.ts` rewrites the generated blocks in `docs/USER_GUIDE.md` from `packages/engine/src/systems/guideContent.ts`. Without it, `guideDoc.test.ts` fails when the doc drifts. Edit Wren's tips in `guideContent.ts`, never inside the generated blocks
- `CABN_E2E_PORT` — `vite preview` port for the Playwright suite (default 4173); set a distinct one per worktree
- `CABN_OWNER_E2E_PORT` — `cabn serve --owner` port for `signs-owner.spec.ts` (default 5042)
- `CABN_OWNER_KEY_E2E_PORT` — `owner-key.spec.ts` (default `CABN_OWNER_E2E_PORT` + 3, so 5045)
- `CABN_SHADOW_E2E_PORT` — `shadow-owner.spec.ts` (default 5043)
- `loading-screen-owner.spec.ts` serves on `CABN_OWNER_E2E_PORT` + 6 (default 5048); it has no variable of its own
- `CABN_SPELLBOOK_E2E_PORT` — `spellbook-serve.spec.ts` (default 5044). The serve-spawning specs' defaults (5042-5045, 5048) and the preview port are all distinct, so parallel workers don't collide; override them all per worktree
- `CABN_REVIEW_SHOTS=1` — specs that support it write review screenshots under `assets/generated/review/<topic>/`; `CABN_REVIEW_PREFIX` (default `after`) and `CABN_SHOT_SUFFIX` name them in the specs that read them
- `CABN_E2E_LIVE_WEB=1` — `embeds.spec.ts` loads the real sites instead of stubs
- `CABN_PERF=1` — `monsters.spec.ts` logs frame-time stats
- `CABN_LARGE_WORLD=1` — opts into `large-world.spec.ts`, skipped otherwise: generates a synthetic ~150-folder, ~2,000-file project on disk, runs it through a real `cabn build` then `cabn serve --offline`, and asserts enter-to-walkable time, long-task-free walking and a bounded live RenderTexture count. Too slow for every `pnpm -F @cabn/demo e2e` run. `CABN_LARGE_WORLD_PORT` picks its `cabn serve` port (default 5539); `CABN_LARGE_WORLD_MAX_MS` overrides its enter-to-walkable threshold (default 6000) for a slower machine
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — point at a cached Chrome for Testing build; never run `playwright install` locally
- e2e worker cap: `apps/demo/playwright.config.ts` defaults `workers` to a quarter of the CPU cores (minimum 1), because each worker's Chrome spends real CPU in world bakes. `--workers=N` overrides it
- `?perf=1` — the engine's `performance.mark`/`measure` phase marks (`systems/perfMarks.ts`: boot, preload, shelf, world entry with a per-bake breakdown, file view, spellbook). Off, each call site is one boolean check
- `node apps/demo/scripts/perf-measure.mjs [--base-url=http://127.0.0.1:5091] [--reps=5]` — times cold boot, world entry, file and spellbook open through those marks against an already running `vite preview` of the production build, with Chrome traces and a CPU-throttled pass; output in `apps/demo/out/perf/`

### The demo's world fingerprint

`apps/demo/scripts/build-world.mjs` hashes each world's source tree (paths and bytes, `cabn.json` included), findings file and build options, plus the `version`, built `dist/` (nested files included) and lockfile-resolved runtime dependency versions of `@cabn/world-schema`, `@cabn/converter` and `@cabn/cli` (without the cli's bundled sprites), `CABN_VERSION` and `gen-git-fixture.mjs`. The hash is stored in `apps/demo/node_modules/.cache/cabn-worlds/<name>.txt`. It follows `dist/`, not `src/`: `assertToolchainBuilt` compares each toolchain package's `src/` and `dist/` mtimes before every build and throws if `dist/` is stale or missing, because `pnpm -F @cabn/demo build` alone (unlike `pnpm -r build`'s topological order) never rebuilds its deps — run `pnpm -r build` first. Tests: `apps/demo/tests/build-world.test.mjs`.

## Layout

- `packages/world-schema` — `@cabn/world-schema`: zod schemas for `world.json` (strict), chunks, search index, the optional sidecars (`media.json`, `embeds.json`, `monsters.json`, `signs.json`, `git/`, `releases.json`), `cabn.json` (`src/cabnConfig.ts`), world layers (`src/layer.ts`) and the `.seyn` parser. `CABN_VERSION` is 1
- `packages/converter` — `@cabn/converter`: `.` (Node: `convert`, `buildShelf`, `convertShadow`), `./browser` (in-browser conversion for universes; must never reach `shadow.ts`/`shadowLayout.ts`, enforced by an import-graph test), `./core` (annotators, media sniffing, `clearingFit`, search-index shape; what the engine's first chunk may import). Tests live in `test/` (singular)
- `packages/engine` — `@cabn/engine`: Phaser 3 scenes (`src/scenes/`), rendering (`src/render/`), pure logic (`src/systems/`), React HUD (`src/react/`), pets (`src/pets/`), and the React↔Phaser bridge (`src/bridge/store.ts` zustand, `src/bridge/events.ts` mitt). Three entries:
  - `.` — always execution-safe (`TraceProvider` only) and owner-free
  - `./local-exec` — `LocalRunProvider`, imported only by a `cabn serve --allow-exec` page
  - `./owner` — owner sign and git clients and everything in `src/shadow/` (the shadow realm's provider, client, skin, palette, sudo tool), imported only by a `cabn serve --owner` page. `src/shadow/` is owner-only: `tests/importGraph.test.ts` fails if `index.ts` reaches it
- The world-layer seam: the main engine knows only a neutral "world layer" (`systems/worldLayer.ts`: `WorldLayerProvider`, `WorldSkin`, `mergeLayer`, `DEFAULT_SKIN`; `scenes/worldLayerSeam.ts`). The shadow realm is one provider plugged in through `owner.layers`. Never name shadow things in the main entry; add skin fields with a null default in `DEFAULT_SKIN` so normal worlds keep today's code path
- The loading screen: `systems/loadingScreen.ts` (`LoadingTracker`: per-load tokens, shown after `LOADING_SHOW_DELAY_MS` = 500, kept at least `LOADING_MIN_VISIBLE_MS` = 250; `loadingTips()` reuses Wren's single-line pages from `guideContent.ts`, minus the monsters topic), `systems/sceneLoading.ts` (`SceneLoadCoordinator`: scene switches announced on the bus, ended from game.ts on the world/shelf scene's CREATE, and the washed-out/torn boot errors from `BootScene`), `react/LoadingOverlay.tsx` (the panel, plus `LoadingFallback` for Suspense). A new slow load holds a token through the store's `beginLoading`/`endLoading` or `react/useLoadingWhile.ts` rather than drawing its own spinner
- The owner's toolkit: `systems/ownerToolkit.ts` builds a generic entry list from `owner.signs`, `owner.git` and each `owner.layers[].tools`; `react/OwnerToolkit.tsx` renders it
- `packages/cli` — `@cabn/cli`: `build`/`inspect`/`shelf`/`serve`. `src/serve/ownerAuth.ts` is the one gate for `ownerSigns.ts`, `ownerGit.ts` and `ownerShadow.ts`; every `/owner/` route answers 404 without `--owner`. The shadow layer is computed lazily in the serve process and never written into the bundle. `scripts/copy-assets.mjs` bundles the engine's normal art into `dist/assets`; `tests/serve/bundled-assets.test.ts` checks coverage. Shadow art is not bundled: under `--owner`, `src/serve/shadowArt.ts` resolves it from `@cabn/shadow-art` (an optional peer, plus a `workspace:*` devDependency so the monorepo has it), else `assets/generated/shadow/`, else none (one startup hint, tint-only realm). `ServeOptions.shadowArtDir` overrides that in tests
- `packages/shadow-art` — `@cabn/shadow-art`: the shadow PNGs only. `scripts/copy-shadow.mjs` copies its `SHADOW` list from `assets/generated/shadow/` into `dist/shadow` (cleared first; a missing file fails the build); `index.js` exports `shadowAssetsDir`. `tests/shadowArt.test.ts` walks the engine's `shadow/skin.ts` so a skin texture missing from the list fails
- `apps/backend` — private, `@cabn/backend`: authenticated Fastify service (`POST /v1/worlds`, `GET /healthz`). Each conversion runs in a fresh worker (`converter-pool.ts` spawns `dist/converter-worker.js` with an empty env; `zip-limits.ts` is the pre-inflation size/ratio check). The worker always runs from `dist/`, so `test` compiles first; `tests/fixtures/*-worker.mjs` are injectable stand-ins (hang, crash, OOM, env dump)
- `apps/demo` — private, Vite + React app: converts `sample-project/` and `notes-vault/` into a shelf of two worlds. `e2e/` is the Playwright suite, `tests/` its Vitest tests, `scripts/` the world build, git fixture, perf harness and bundle checks. The four `postbuild` bundle checks, all over `dist/`:
  - `check-no-exec-in-bundle.mjs` — no real-execution or owner-client markers
  - `check-no-secrets-in-bundle.mjs` — no key-shaped strings (`sk-…`, Google, GitHub, AWS, private key blocks); world data excluded
  - `check-no-shadow-in-bundle.mjs` — no shadow wire strings or client names, no `/assets/shadow/` art, no hidden paths in world files
  - `check-csp-in-bundle.mjs` — `dist/index.html` carries exactly the policy in `apps/demo/csp-policy.mjs` (injected at build time only; `vite dev` needs an inline script it would block), ahead of every script and style. Specs that import `test` from `e2e/cspGuard.ts` fail on any CSP violation; a new external origin or inline construct means a policy edit there. `public/zod-jitless.js` keeps zod's eval probe from tripping it
- `tools/asset-pipeline` — private, `@cabn/asset-pipeline`: palette, sprite recovery, pixel-map art, soften pipeline. Shadow art goes to `assets/generated/shadow/`, packaged as `@cabn/shadow-art`, served by `cabn serve` only with `--owner` and never copied into the demo
- `assets/source` — source art; `assets/generated` — generated sprites; `assets/generated/review/` — review screenshots
- The Rust prototype lives on the `rust-prototype` branch, not in this tree

## Conventions

- TS strict ESM everywhere; package builds emit to `dist/`; tests live in `tests/` (`test/` in the converter), outside tsc `include`
- New bundle data goes in an optional sidecar file, never a new field in `world.json` (older engines parse it strictly and would reject the world); `CABN_VERSION` stays 1
- Add runtime deps only in the milestone that uses them
- Comments load-bearing only: explain why, never narrate what the code says
- Branch per feature off `main`; never commit to `main` directly; never push without explicit user authorization
- User-visible changes get a dated `CHANGELOG.md` entry. Don't delete old entries; mark a statement a later change overrides as superseded
- A change to a key, tool or tip: update `guideContent.ts`, regenerate with `CABN_UPDATE_GUIDE=1`, and keep `docs/USER_GUIDE.md`'s prose in step. Tips also rotate on the loading screen, which skips any page over 170 characters or with a line break
