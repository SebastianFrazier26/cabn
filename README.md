# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews), M4 (`FileScene`, enchanted markdown, the tool hotbar and orb search), M5 (the quill editor, bag paste, and save persistence), M6 (annotators, monster species, and fix-to-defeat battles), M7 (the wand tool's run parchment, a pluggable simulated/real execution provider, `cabn serve`, and a soft glow post-effect), and M8 (an authenticated converter backend, a manual npm release pipeline, and a headless-browser CI smoke test) have landed. M10's portal-preview overrides (`cabn.json`, richer default previews, and the `PortalPreview`/`PortalEmbed` components) have landed, and world portal arches are now twice the size with that literal preview painted inside each arch plus an expanded preview dock (and the live url embed) when you stand at one.

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index, error annotation -> monsters); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf/file scenes, a zustand+mitt React bridge (`CabnGame` and its HUD: `ToolHotbar`, `SpyglassPanel`, `OrbSearch`, `BagTray`, `EditorOverlay`, `SettingsCorner`, `FileOverlay`, `MonsterCounter`, `EncounterBanner`, `RunOverlay`), walkable world with lazy chunk loading, in-arch portal previews, a shelf hub listing every converted world, a walkable parchment-scroll file view with enchanted markdown, a CodeMirror-backed quill editor with bag paste, monster sprites (hovering near portals/paths in the world, standing beside their line in a file) with a walk-into-and-`Enter` fix-to-defeat battle loop, localStorage-backed save persistence (file edits, player position, visited clusters, bag slots, defeated monsters), a pluggable `ExecutionProvider` (`TraceProvider` heuristic by default and always in a hosted build; `LocalRunProvider`, real execution, only reachable via `@cabn/engine/local-exec` from a `cabn serve --allow-exec` host page) driving the wand tool's run parchment, and a soft bloom+vignette glow post-effect (always on where WebGL is available) |
| `packages/cli` | `@cabn/cli` | `cabn build <dir\|zipfile>`, `cabn inspect <bundleDir>`, `cabn shelf <bundleDir...>`, and `cabn serve <dir> [--allow-exec]` |
| `apps/backend` | `@cabn/backend` | Authenticated Fastify upload/convert API — `POST /v1/worlds` (zip in, world bundle zip out) and `GET /healthz` |
| `apps/demo` | `@cabn/demo` | Vite + React demo app — converts `sample-project/` and `notes-vault/` into two worlds, builds a shelf listing both, and renders it as a walkable `CabnGame` shelf; also home to the Playwright browser smoke test (`e2e/`) |
| `tools/asset-pipeline` | `@cabn/asset-pipeline` | Sprite/asset build tooling |
| `assets/source` | — | Source art (icons, sprites) |
| `assets/generated` | — | Palette, soft-rendered originals, and placeholder sprites consumed by `@cabn/engine`/`@cabn/demo` |

World layout (`convert()`'s cluster positions) is byte-stable across runs on a single JS engine; cross-engine reproduction isn't guaranteed since it relies on `Math.cos`/`Math.sin`, whose last-ulp rounding isn't spec-mandated to match between engines.

## Quickstart

Requires Node 22 and pnpm (via corepack).

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

### Run the demo

```sh
pnpm -F @cabn/demo dev
```

First run converts `apps/demo/sample-project/` and `apps/demo/notes-vault/` into two world bundles (`apps/demo/public/worlds/{sample,notes}/`), writes a `shelf.json` listing both, and copies sprites into `apps/demo/public/assets/` — all gitignored, regenerated on demand (`pnpm -F @cabn/demo build:world`, or add `-- --force` to rebuild worlds that already exist). Then open the printed local URL.

### Browser smoke test

`apps/demo/e2e/smoke.spec.ts` (Playwright) builds/serves the production bundle and checks it in a real browser: no console/page errors, the Phaser canvas actually renders (pixel-variance check, not just "canvas exists"), and walking into a cabin from the shelf loads a world. It's the CI job that's caught bugs the other tests never would — two, so far, that only showed up outside jsdom.

```sh
pnpm -F @cabn/demo build   # produces the dist/ the smoke test previews
pnpm -F @cabn/demo e2e
```

CI installs its own matching Chromium (`playwright install --with-deps chromium`) — never run that on this machine. Locally, if the Chromium `@playwright/test` expects doesn't match what's already cached at `~/Library/Caches/ms-playwright/`, point `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at a cached build instead of installing a new one.

CI also runs `pnpm audit --audit-level=high` (fails only on high/critical findings in the resolved tree) — see `pnpm audit` output for whatever's currently flagged; a low-severity, dev-tooling-only finding at the time of writing doesn't gate the build.

### Controls

- **Move**: WASD or arrow keys, everywhere (shelf, a world, inside a file) — or click the ground to walk there (a small gold sparkle marks the spot). Any movement key cancels a click-walk.
- **Interact**: `Enter` — same key everywhere: at a shelf cabin -> that world, at a world portal -> the file, at the bonfire -> back to the shelf, at a file's top arch -> back to the world, next to a monster inside a file -> an encounter (see Monsters below). Clicking any of those (the cursor turns into a pointer over them) walks you there and interacts on arrival.
- **Esc**: leave a world at the bonfire (back to the shelf), close a file (back to the world at the portal you entered), cancel a bag selection in progress, back out of an encounter banner before the quill opens, or close an open panel.
- While a text field has focus (the orb's search box, the quill editor) every key goes to it, never to the game — `Enter` in the orb's search box picks the top result.
- **Tool hotbar** (bottom of screen, click a slot or use its hotkey):
  - **Opener** (`Enter`) — the interact behavior above, also reachable as a tool.
  - **Spyglass** (`L`) — lists the portals in whatever cluster you're standing in (name, kind, size); click one to auto-walk there.
  - **Orb** (`F`, or `Cmd`/`Ctrl`-`F` which also blocks the browser's own find) — fuzzy search the whole world by name/path/content while walking around, or search just the open file's lines while inside one; picking a result auto-walks to it (world) or jumps/highlights the line (file).
  - **Bag** (`B`) — inside a file, starts a line selection at your current line (shift + up/down to extend), and a second `B` grabs it into a bag slot (shown bottom-left, capped at 5).
  - **Quill** (`Q`) — inside a file, opens the editor overlay with the caret on the line nearest you. `Ctrl`/`Cmd`-`S` saves; `Esc` closes (asks first if there are unsaved changes). While it's open, the bag tray's slots become paste buttons (or use `Alt`+`1`-`5`) that insert that slot's text at the cursor.
  - **Wand** (`R`) — inside a file, starts a *run*: a parchment scroll unfurls over the bottom-right of the screen and a spark travels the file line by line, the camera easing along with it. By default this is always a simulated trace (`TraceProvider`, a heuristic that never executes a single line of your code); it's only ever a *real* run of a file's code when you're pointed at a `cabn serve --allow-exec` instance (see below).

Inside a world, a portal arch shows a live preview in its opening as you approach. A file opens as a walkable parchment scroll (line-numbered, camera follows you down it); markdown files render "enchanted" — gold glowing headings, tinted bold/italic, pale-blue underlined links, boxed code spans, and leaf-dot list bullets.

### Portal previews and `cabn.json`

Every portal carries a richer default preview than the small in-arch panel: syntax-coloured code, a structured breakdown of a markdown file, a copied-in image, or a "sealed" notice for binaries (`@cabn/engine`'s `PortalPreview` component renders this, either as a compact overlay or an expanded view). A `cabn.json` at a world source's root can override specific files — point one at a different image/markdown file, a short text blurb, or a live embeddable webpage:

```json
{
	"cabnConfigVersion": 1,
	"previews": {
		"README.md": { "kind": "image", "src": "assets/logo.png" },
		"index.html": { "kind": "url", "url": "https://example.com/demo" }
	},
	"allowedEmbedOrigins": ["https://example.com"]
}
```

A `url` override renders as a live sandboxed iframe (`PortalEmbed`) — see `packages/world-schema/README.md` for the override format and `packages/engine/README.md` for the component API and, importantly, the `Content-Security-Policy: frame-src` a hosting page must set for the embed to actually load (the sandbox attribute alone isn't enough; CSP is the browser's, not this app's, to relax).

### Running a file

Press `R` (the wand) inside a file to start a run. The parchment shows the current line, that line's source text, and a running log; controls work both on-screen and by keyboard:

| Control | Keyboard | What it does |
| --- | --- | --- |
| Play/Pause | `Space` | Toggles auto-advance (700ms/step at 1x) |
| Step | `N` | Advances exactly one step, regardless of play state |
| Speed | `1` / `2` / `4` | Sets playback speed |
| Stop | `Esc` | Ends the run (a second `Esc` after that still exits the file) |

If a monster stands on a line the run reaches, playback pauses there ("A {species} blocks the way!", with a jiggle) — cosmetic, not a real obstacle; `Space`/`N` push past it same as any other pause.

By default — everywhere, including this repo's own hosted demo — a run is a **simulated trace**: a pure, heuristic top-to-bottom walk (imports, top-level statements, function definitions, and stepping into a locally-defined function's body when it's called) that never executes a single line of the file's actual code. That's the only execution capability a hosted build of cabn ever ships.

### `cabn serve` — running a file for real, locally only

```sh
cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms]
```

Converts `<dir>` into a world and serves it as a walkable game at `http://127.0.0.1:<port>/?token=<...>` — bound to `127.0.0.1` only, never configurable to any other host. On its own (no `--allow-exec`), it behaves exactly like the hosted demo: the wand tool still works, still only ever simulates.

**`--allow-exec` turns on REAL code execution of whatever file you run with the wand tool.** Only ever use it on a directory whose code you trust — it will genuinely run `.py`/`.js`/`.mjs`/`.ts` files on your machine (`python3` / `node`, no shell, a 10-second default timeout, a 256KB output cap, and a directory-confined path check with no traversal or symlink-escape allowed). A per-process random token is required on every run request; the server checks it, the request's `Host`/`Origin` headers (defeats DNS rebinding and a stray cross-origin page), and refuses to even start with `--allow-exec` if asked to bind anywhere but `127.0.0.1`. Python runs get genuine per-line tracing (`sys.settrace`, restricted to the target file); JS/TS runs stream real stdout/stderr but fall back to the same heuristic trace for line structure (the parchment labels these "approximate lines"). None of this — the exec endpoint, the token check, `LocalRunProvider` itself — exists in a build without `--allow-exec`, nor in the hosted demo; see `CHANGELOG.md`'s M7 entry for exactly how that's guaranteed.

```sh
cabn serve ./my-project --allow-exec
```

will print a loud warning banner and the URL to open.

### Monsters

Every error a world's files have gets annotated at conversion time and spawns a monster, one species per error code:

| Species | Error code | What it means |
| --- | --- | --- |
| Ghost | `NullTypeError` | A relative import or markdown link that doesn't resolve to any file in this world |
| Rot-sprite | `Corrupted` | Invalid JSON, or a markdown frontmatter block that opens with `---` and never closes |
| Warded Mimic | `InvalidMode` | The file contains an invalid/undecodable byte (shows up as the Unicode replacement character, U+FFFD) |
| Gremlin | `IoError` | An unclosed, mismatched, or unexpected bracket, or an unterminated string literal |
| Ouroboros | `OuroborosError` | A circular import between two or more files |
| Will-o'-Wisp | `WispNote` | A `TODO`/`FIXME`/`XXX`/`HACK` left in a comment — cosmetic, tier 0, never an encounter |

A monster hovers near its file's portal arch in the world (or, for an ouroboros whose cycle crosses clusters, at the midpoint of the path between them — cosmetic only, not fightable there) and stands beside its line inside the file. Walking into one and pressing `Enter` (or clicking it) starts an encounter: a short banner names the monster and shows the error, then the quill opens on the offending line. Saving re-checks every monster still open in that file, not just the one you're fighting — fix the underlying problem and it dies (a fade, a few sparkles, and "Fixed!"); the fix doesn't take and it shrugs off the hit with a shake and a hint, editor still open so you can try again. A wisp never triggers an encounter at all — removing its `TODO` and saving is enough to make it vanish. The HUD's bottom-left counter tracks how many bugs remain in the world you're in.

### Saving

Edits, your position in the world, which clusters you've visited, your bag slots, and which monsters you've defeated persist to `localStorage` per converted world (keyed by its source + conversion time, so reconverting the same source starts a fresh save). An edited file gets a small ✎ marker on its portal arch in the world and in the spyglass panel, which also offers a "reset" action per edited file; the spyglass panel's "reset world…" button resets everything for the current world, monsters included. A corrupt or incompatible save is ignored (logged to the console) rather than breaking the game; a save from before M6 (no monster data at all) upgrades in place instead of being discarded.

The top-left corner holds the one setting: time of day — `Auto` (follows your clock), `Day` or `Night`, persisted separately from any one world's save. The soft bloom+vignette glow on the world/shelf/file cameras is always on, and silently absent only where WebGL isn't available; a reduced-motion preference turns off ambient animation, not the (static) glow.

## Backend API

`apps/backend` (`@cabn/backend`) is a Fastify service wrapping `@cabn/converter`: `POST /v1/worlds` takes a single-file multipart zip upload and returns the converted world bundle as a zip (`world.json`, `chunks/*.json`, `search-index.json`, `assets.json`); `GET /healthz` returns `{ok: true, version}` unauthenticated. Nothing is persisted — the upload is converted in memory and discarded once the response is sent.

```sh
pnpm -F @cabn/backend dev     # tsx watch src/server.ts
pnpm -F @cabn/backend test    # vitest run
pnpm -F @cabn/backend build   # tsc -> dist/
pnpm -F @cabn/backend start   # node dist/server.js
```

**Auth.** Every request to `POST /v1/worlds` needs `Authorization: Bearer <key>`. The server only ever holds SHA-256 hashes of valid keys (`CABN_API_KEY_SHA256`, comma-separated hex), never plaintext — generate one with:

```sh
pnpm -F @cabn/backend keygen
```

This prints a new key once (`cabn_...`) and its SHA-256 hash; put the key wherever the uploading client reads its secret from, and the hash in `CABN_API_KEY_SHA256`. With `NODE_ENV=production` and no hashes configured, the server refuses to start at all (fail fast, not fail open); in development it starts, but `POST /v1/worlds` answers `503` for every request instead of accepting anything unauthenticated.

**Abuse limits.** Upload size is capped (`MAX_UPLOAD_BYTES`, default 25MB) and enforced by `@fastify/multipart`'s own streaming limit (413 on overflow, not after fully buffering); exactly one file is accepted (400 otherwise) and it must actually be a zip — checked by its `PK\x03\x04` magic bytes, not filename or declared content-type (415 otherwise). The converter's own caps (max files, max total/per-file bytes) are always applied, and secret-pattern files (`.env`, `*.pem`, ...) are never read, same defaults as everywhere else in cabn. `@fastify/rate-limit` enforces two independent limits — per IP and per (hashed) API key — so neither a key leak nor a single noisy IP alone can exhaust the other's budget. Requests time out after `REQUEST_TIMEOUT_MS` (default 30s). CORS is closed by default; set `CORS_ORIGINS` (comma-separated) to allow specific origins. The Fastify logger redacts `Authorization` headers unconditionally — a key is never written to a log.

See `.env.example` for every variable this service reads, and `apps/backend/Dockerfile` for the production container (multi-stage, `pnpm deploy --prod`, non-root, listens on `PORT`).

**Deploying behind a proxy** (Railway or similar): set `CABN_TRUST_PROXY=true` so `request.ip` (which both rate limits and CORS logic key off) reflects the real client via `X-Forwarded-For`, not the proxy's own address.

## Releasing

The four publishable packages (`@cabn/world-schema`, `@cabn/converter`, `@cabn/engine`, `@cabn/cli`) are versioned with [Changesets](https://github.com/changesets/changesets) (`.changeset/`); `apps/backend`, `apps/demo`, and `tools/asset-pipeline` are private and never published. Publishing is **always a manual, human-triggered action** — `.github/workflows/release.yml` only runs on `workflow_dispatch`, never on push.

Add a changeset for a user-facing change to any of the four packages:

```sh
pnpm changeset
```

Publishing uses npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — there is no `NPM_TOKEN` secret in this repo at all. One-time setup:

1. Create the `cabn` org on npmjs.com (name confirmed free at the time of writing — the npm CLI can't create orgs, this is a manual web step).
2. **First publish is manual (verified 2026-09-27).** npm's docs state *"The package you're configuring must already exist on the npm registry"* before a trusted publisher can be attached, so each package's first `0.1.0` goes out once from a maintainer's machine: `pnpm -r build && pnpm -r publish --access public` (npm will ask for a 2FA code).
3. Attach the trusted publisher per package — either on npmjs.com (package → Settings → Trusted Publisher: GitHub Actions, owner `SebastianFrazier26`, repo `cabn`, workflow `release.yml`), or from the CLI with npm ≥ 11.15: `npx npm@12.1.0 trust github <package> --repo SebastianFrazier26/cabn --file release.yml --allow-publish`. Trusted publishing itself needs npm ≥ 11.5.1 and Node ≥ 22.14 in the workflow.
4. Run the "Release" workflow from the Actions tab (`workflow_dispatch`). It installs, builds, tests, then runs `changeset publish` with npm provenance enabled.

## Deploying the backend

`.github/workflows/deploy-backend.yml` deploys `apps/backend` to [Railway](https://railway.app) via the Railway CLI. It runs on push to `main` (paths touching the backend or its dependencies) and via `workflow_dispatch`, but the deploy step itself is a no-op — it builds and tests, then skips the actual `railway up` — until a `RAILWAY_TOKEN` repository secret exists.

To wire it up: create a Railway project and service (e.g. `cabn-backend`), generate a Railway API token, add it as the `RAILWAY_TOKEN` secret in this repo's GitHub settings, and set the backend's env vars (see `.env.example` and the Backend API section above) on the Railway service itself — `CABN_API_KEY_SHA256` and `NODE_ENV=production` at minimum, plus `CABN_TRUST_PROXY=true`.

## License

MIT — see [LICENSE](LICENSE).
