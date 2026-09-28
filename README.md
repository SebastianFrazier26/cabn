# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews), M4 (`FileScene`, enchanted markdown, the tool hotbar and orb search), M5 (the quill editor, bag paste, and save persistence), M6 (annotators, monster species, and fix-to-defeat battles), M7 (the wand tool's run parchment, a pluggable simulated/real execution provider, `cabn serve`, and a soft glow post-effect), and M8 (an authenticated converter backend, a manual npm release pipeline, and a headless-browser CI smoke test) have landed. M10's portal-preview overrides (`cabn.json`, richer default previews, and the `PortalPreview`/`PortalEmbed` components) have landed, and world portal arches are now twice the size with that literal preview painted inside each arch plus an expanded preview dock (and the live url embed) when you stand at one.

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index, error annotation -> monsters); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf/file scenes, a zustand+mitt React bridge (`CabnGame` and its HUD: `ToolHotbar`, `SpyglassPanel`, `OrbSearch`, `BagTray`, `EditorOverlay`, `SettingsCorner`, `FileOverlay`, `MonsterCounter`, `EncounterBanner`, `RunOverlay`), walkable world with lazy chunk loading, in-arch portal previews, a shelf hub listing every converted world, a parchment file view you edit in place with a real text caret (shared buffer, undo history and save path with the quill) and enchanted markdown, a CodeMirror-backed quill editor with bag paste, monster sprites (hovering near portals/paths in the world, standing beside their line in a file) with a click-or-`Alt`+`Enter` fix-to-defeat battle loop, localStorage-backed save persistence (file edits, player position, visited clusters, bag slots, defeated monsters), a pluggable `ExecutionProvider` (`TraceProvider` heuristic by default and always in a hosted build; `LocalRunProvider`, real execution, only reachable via `@cabn/engine/local-exec` from a `cabn serve --allow-exec` host page) driving the wand tool's run parchment, and a soft bloom+vignette glow post-effect (always on where WebGL is available) |
| `packages/cli` | `@cabn/cli` | `cabn build <dir\|zipfile>`, `cabn inspect <bundleDir>`, `cabn shelf <bundleDir...>`, and `cabn serve <dir> [--allow-exec] [--no-owner]` |
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

New to cabn? The player's guide, [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md), walks through moving, every tool and hotkey, the monsters, editing and previews, plus `cabn.json` for world authors. In the game, Wren (a guide standing by the first world's bonfire) gives the same tips: walk up to her and press `Enter`.

- **Move**: WASD or arrow keys on the shelf and in a world — or click the ground to walk there (a small gold sparkle marks the spot). Any movement key cancels a click-walk.
- **Interact**: `Enter` — at a shelf cabin -> that world, at a world portal -> the file, at the bonfire -> back to the shelf. Clicking any of those (the cursor turns into a pointer over them) walks you there and interacts on arrival.
- **Inside a text file you write on the page directly.** Click puts a real text caret at that character (the pointer is an I-beam over the text); arrows move it by character and line, `Home`/`End` to the line's indent/start and end, `Alt`+arrows (`Ctrl`+arrows off macOS) by word, `Cmd`+arrows (`Ctrl`+`Home`/`End`) to line/document ends, `Shift` with any of them (or a drag, or a double click on a word) selects. Typing, `Backspace`/`Delete`, `Tab`/`Shift`+`Tab`, paste and cut edit the file in place; `Enter` inserts a newline (keeping the indent). `Cmd`/`Ctrl`-`Z` undoes, `Cmd`/`Ctrl`-`Shift`-`Z` (or `Ctrl`-`Y`) redoes, `Cmd`/`Ctrl`-`S` saves — the same save as the quill's (it persists in the browser and re-checks the file's monsters). The status line at the top shows the path, `Ln`/`Col` and saved/unsaved. Because letters and `Enter` now type, the file view's tool shortcuts are `Alt` chords: `Alt`+`Enter` fights the monster within two lines of the caret, `Alt`+`Q` quill, `Alt`+`B` bag, `Alt`+`R` wand, `Alt`+`F` orb, `Alt`+`L` spyglass (`Alt`+`1`-`5` pastes a bag slot). Clicking a monster or the top arch acts on it at once. Binary/media files and sealed chests aren't editable.
- **Esc**: leave a world at the bonfire (back to the shelf), close a file (back to the world at the portal you entered — with unsaved edits it first asks Save & leave / Discard / Keep writing; with a selection, the first Esc just clears it), back out of an encounter banner before the quill opens, or close an open panel.
- While a text field has focus (the orb's search box, the quill editor, the file view's caret) every key goes to it, never to the game — `Enter` in the orb's search box picks the top result.
- **Tool hotbar** (bottom of screen, click a slot or use its hotkey):
  - **Opener** (`Enter`; `Alt`+`Enter` inside a file) — the interact behavior above, also reachable as a tool.
  - **Spyglass** (`L`) — lists the portals in whatever cluster you're standing in (name, kind, size); click one to auto-walk there.
  - **Orb** (`F`, or `Cmd`/`Ctrl`-`F` which also blocks the browser's own find) — fuzzy search the whole world by name/path/content while walking around, or search just the open file's lines while inside one; picking a result auto-walks to it (world) or jumps/highlights the line (file).
  - **Bag** (`Alt`+`B` inside a file) — grabs the caret's selection, or its whole line if nothing is selected, into a bag slot (shown bottom-left, capped at 5).
  - **Quill** (`Alt`+`Q` inside a file) — opens the spellbook, the full-tools editor, on the same document the page shows: same caret, same unsaved edits, same undo history. `Ctrl`/`Cmd`-`S` saves; `Esc` goes back to the page with any unsaved edits kept (leaving the file is what asks about them). While it's open, the bag tray's slots become paste buttons (or use `Alt`+`1`-`5`) that insert that slot's text at the cursor.
  - **Wand** (`Alt`+`R` inside a file) — starts a *run* of the page as it currently reads, unsaved edits included: a parchment scroll unfurls over the bottom-right of the screen and a spark travels the file line by line, the camera easing along with it. By default this is always a simulated trace (`TraceProvider`, a heuristic that never executes a single line of your code); it's only ever a *real* run of a file's code when you're pointed at a `cabn serve --allow-exec` instance (see below).

Inside a world, a portal arch shows a live preview in its opening as you approach. A file opens as a parchment page you write on (line-numbered, the camera follows the caret; the mouse wheel scrolls freely until the caret moves again); markdown files render "enchanted" — gold glowing headings, tinted bold/italic, pale-blue underlined links, boxed code spans, and leaf-dot list bullets — except on the caret's (or selection's) lines, which show their raw source while you edit them.

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

#### Media (images, audio, PDF, CSV)

PNG/JPEG/GIF/WebP images, MP3/WAV/OGG audio and PDFs ship their bytes in the bundle as `media/<content hash>.<ext>`, fetched lazily by the engine (never inlined in `world.json` or chunks). Each file's type is checked by its magic bytes, not its extension; a mismatch stays a sealed chest. Caps: 5 MB per file and 50 MB per world by default, raisable in `cabn.json` up to 25 MB / 250 MB:

```json
{ "cabnConfigVersion": 1, "media": { "maxFileBytes": 10485760, "maxTotalBytes": 104857600 } }
```

A host can set lower ceilings that `cabn.json` can't exceed (`convert()`'s `mediaMaxFileBytes`/`mediaMaxTotalBytes`; the backend pins them to its own zip-entry and upload limits). Anything over a cap, over the world budget, secret-patterned, or SVG/xlsx (not previewed: SVG is a script-capable document) stays a sealed chest that shows its name, size and the reason. Audio gets a waveform decoded in the browser plus play/pause/seek; PDFs render page 1 in the arch and a paged viewer in the dock and file view via `pdfjs-dist` (lazy-loaded; the host serves the worker itself — pass `pdfWorkerUrl` to `CabnGame`); CSV/TSV files show as a table. Audio/PDF metadata lives in an optional `media.json` beside `world.json`, so engines from before it simply show those files sealed.

A `url` override renders as a live sandboxed iframe (`PortalEmbed`) — see `packages/world-schema/README.md` for the override format and `packages/engine/README.md` for the component API and, importantly, the `Content-Security-Policy: frame-src` a hosting page must set for the embed to actually load (the sandbox attribute alone isn't enough; CSP is the browser's, not this app's, to relax).

In the world, walking up to a url arch lays that live page over the arch's opening (one at a time, unmounted when you walk away); clicking the page in the arch, or the side panel's "Open in browser" button, opens it in a new tab. Only origins in `allowedEmbedOrigins` are framed or opened. The demo's `docs/website.md` is such a web portal, pointed at `https://example.com/`.

Walk right up to a url arch (the side panel's range) and that same live page moves out of the arch into the side panel at a readable size (laid out 640px wide), where you can scroll it and click links inside it; it's one iframe throughout, moved with CSS rather than re-mounted, so the page isn't loaded twice. Clicking into the page gives it your keyboard (a chip says so); click anywhere outside it to walk again — Esc can't work there, because a cross-origin page's keys never reach cabn. Step back and it returns to the arch.

Many sites refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), and a browser gives the embedding page no reliable signal when that happens. So `cabn build` and `cabn serve` check each url once at build time (HEAD, falling back to GET; https-only redirects, at most 5; 5s budget; only headers are read) and record the verdict in `embeds.json` beside `world.json`. A blocked site never gets an iframe: its arch shows the title card and the side panel an "Open in browser" button. `--offline` (or `"embedCheck": false` in `cabn.json`) skips the check and assumes every url is framable; `convert()` itself never touches the network unless the host passes `embedNetwork`, and the backend never does (it converts untrusted uploads, so fetching their urls would be an SSRF vector). Engines from before `embeds.json` never request it and behave as before. The demo's `docs/threejs.md` (framable) and `docs/code-host.md` (github.com, blocked) show both cases.

### Running a file

Press `Alt`+`R` (the wand) inside a file to start a run. The parchment shows the current line, that line's source text, and a running log; controls work both on-screen and by keyboard:

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
cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms] [--offline] [--no-owner]
```

The host page is sent with `Content-Security-Policy: frame-src <the world's allowedEmbedOrigins>` (`frame-src 'none'` when it has none) and no other directive, so the only thing the browser will ever frame is what `cabn.json` allowlisted; scripts, styles and workers are left unrestricted because the page runs an inline token script and a bundled app a broader policy would have to enumerate. `--offline` skips the build-time framability check (see above).

Converts `<dir>` into a world and serves it as a walkable game at `http://127.0.0.1:<port>/?token=<...>` — bound to `127.0.0.1` only, never configurable to any other host. On its own (no `--allow-exec`), it behaves exactly like the hosted demo: the wand tool still works, still only ever simulates.

**`--allow-exec` turns on REAL code execution of whatever file you run with the wand tool.** Only ever use it on a directory whose code you trust — it will genuinely run `.py`/`.js`/`.mjs`/`.ts` files on your machine (`python3` / `node`, no shell, a 10-second default timeout, a 256KB output cap, and a directory-confined path check with no traversal or symlink-escape allowed). A per-process random token is required on every run request; the server checks it, the request's `Host`/`Origin` headers (defeats DNS rebinding and a stray cross-origin page), and refuses to even start with `--allow-exec` if asked to bind anywhere but `127.0.0.1`. Python runs get genuine per-line tracing (`sys.settrace`, restricted to the target file); JS/TS runs stream real stdout/stderr but fall back to the same heuristic trace for line structure (the parchment labels these "approximate lines"). None of this — the exec endpoint, the token check, `LocalRunProvider` itself — exists in a build without `--allow-exec`, nor in the hosted demo; see `CHANGELOG.md`'s M7 entry for exactly how that's guaranteed.

```sh
cabn serve ./my-project --allow-exec
```

will print a loud warning banner and the URL to open.

### Signs (`.seyn`)

A `.seyn` file is a short note that stands in the world as a wooden signpost beside the arch or fountain it describes, instead of becoming a portal: a title line, paragraphs, `- ` bullets, `*emphasis*`, and `[[links]]` to files, folders, other signs and `https://` pages. Walk up to one and a popup shows it; `Enter` or a click opens it in full. An internal link walks you to its target and highlights it; a web link opens in a new tab (`noopener noreferrer`). Keep signs next to the files they describe (`src/index.seyn` beside `src/index.ts`). The format is specified in [`docs/SEYN.md`](docs/SEYN.md); the converter lists signs in a `signs.json` beside `world.json` (older engines ignore it and show the world without signs), and sign text is searchable with the orb.

Everyone sees signs, hosted builds included. **Only the world owner can place, edit or delete them**, and only on a local `cabn serve` page: that page's hotbar has a sign item (`P`) no other page ever gets. Pick it, click where the sign should stand (the nearest arch or fountain becomes its target; `Enter` puts it beside you, `Esc` cancels), write it in the small editor with a live preview, and save. The file is written into `<dir>` and the sign appears at once, with no restart. A sign's reader also gets Edit and Delete buttons on that page.

Saves go through an owner API that exists only in `cabn serve`, not in the hosted demo or any other build. Each request needs a random per-session owner token that is put only into the page itself (never into the printed URL). The request's `Host` must be exactly `127.0.0.1:<port>` or `localhost:<port>`, and its `Origin` must be present and match. The body must be JSON (schema-checked, size-capped). The server writes only `.seyn` files (16 KiB max) inside the served folder: no absolute paths, `..`, hidden or ignored folders (`.git`, `node_modules`, `dist`…), symlinked folders pointing outside, or symlinks at the target. It never runs a shell. New files are created exclusively, so they never clobber an existing file; edits go to a temp file that is renamed over the old one. `--no-owner` serves the same page read-only: no sign item, and no owner routes at all.

### Monsters

Every error a world's files have gets annotated at conversion time and spawns a monster, one species per error code. Tier is severity, from 0 (cosmetic) to 3. When a file has two or more real bugs, each of them goes up one tier.

| Species | Error code | Tier | What it means |
| --- | --- | --- | --- |
| Ghost | `NullTypeError` | 1 | A relative import or markdown link that doesn't resolve to any file in this world |
| Rot-sprite | `Corrupted` | 1 | Invalid JSON, or a markdown frontmatter block that opens with `---` and never closes |
| Warded Mimic | `InvalidMode` | 1 | The file contains an invalid/undecodable byte (shows up as the Unicode replacement character, U+FFFD) |
| Gremlin | `IoError` | 1 | An unclosed, mismatched, or unexpected bracket, or an unterminated string literal |
| Ouroboros | `OuroborosError` | 1 | A circular import between two or more files |
| Will-o'-Wisp | `WispNote` | 0 | A `TODO`/`FIXME`/`XXX`/`HACK` left in a comment — cosmetic, never an encounter |
| Hex Imp | `SyntaxError` | 2 | A real parse error, from the same Lezer grammars the editor uses (JS/JSX, Python, CSS, HTML). TypeScript isn't covered, because that grammar flags too much valid TS; TS files still get gremlins. A file that has a gremlin gets no imps, so one mistake is one monster |
| Magpie | `LeakedSecret` | 3 | A hard-coded credential: an AWS/GitHub/Anthropic/OpenAI/Slack/Stripe/Google key, a PEM private key, a database URL with a password in it, or a random-looking string assigned to a secret-ish name. The message shows only the key's prefix and length, never the value |
| Skeleton | `DeadCode` | 1 | An unused import, an unused variable or function (JS/TS locals and module-private names, Python function locals), or code after `return`/`throw`/`raise`/`break`/`continue` |
| Bramble | `CodeSmell` | 1 | A function over 80 lines, control flow nested more than 4 deep, a copy-pasted block of 6+ lines, or a debug leftover (`debugger`, `breakpoint()`, and `console.log`/`print` outside scripts, tests and CLIs). Change the limits in `cabn.json`: `"annotate": { "maxFunctionLines": 120, "maxNestingDepth": 5 }` |
| Shade | `UnknownBug` | 1 | A finding from an external tool (`cabn build --findings`) that doesn't fit any built-in class |

A monster hovers near its file's portal arch in the world (or, for an ouroboros whose cycle crosses clusters, at the midpoint of the path between them — cosmetic only, not fightable there) and stands beside its line inside the file. Clicking one, or pressing `Alt`+`Enter` with the caret within two lines of it (plain `Enter` types a newline in the file view), starts an encounter: a short banner names the monster and shows the error, then the quill opens on the offending line. Saving re-checks every monster still open in that file, not just the one you're fighting — fix the underlying problem and it dies (a fade, a few sparkles, and "Fixed!"); the fix doesn't take and it shrugs off the hit with a shake and a hint, editor still open so you can try again. A wisp never triggers an encounter at all — removing its `TODO` and saving is enough to make it vanish. The HUD's bottom-left counter tracks how many bugs remain in the world you're in.

A false alarm costs more than a missed bug in a game about fixing real bugs, so the newer annotators hold back:

- The dead-code check counts a name as used if the word appears anywhere else in the file, comments and strings included. It never guesses at scopes.
- The imp ignores known gaps in the grammars (constructs that are valid but that the grammar still marks as errors). A test runs the imp and dead-code checks over this repo's own source and expects zero hits.
- The secret check skips placeholders (`your-key-here`, `example`, `xxxx`, `${VAR}`, strings with too little variety). Its generic "secret-ish name" pattern doesn't run in tests or in `.example`/`.sample` files.
- The debug-print check skips scripts, tests, CLIs and server entry points.

The five newer species (imp through shade) are stored in a separate `monsters.json` next to `world.json`. Older engines read `world.json` strictly and would reject an unknown species. With this split they load new worlds fine and just don't show these monsters. `world.json` itself is unchanged and `CABN_VERSION` stays 1.

#### External findings (`--findings`)

```sh
eslint . --format json > eslint.json
cabn build ./my-project --findings eslint.json --findings codeql.sarif
```

`--findings` can be given more than once. It takes `eslint --format json` output or any SARIF 2.1.0 file (CodeQL, Semgrep, Ruff, secret scanners, ...), and the file is validated before anything is used.

- **Mapping**: each finding becomes the closest built-in monster, going by rule id and tags. For example, `no-unused-vars`/`F401` becomes a skeleton, `complexity`/`no-console` a bramble, a parse error an imp, a secret-scanner or CWE-798 rule a magpie, and `import/no-unresolved` a ghost. Anything else becomes a shade.
- **Matching**: paths are matched relative to the directory being built. A finding for a path that isn't in the world is dropped. So is one on the same line and in the same class as a built-in monster.
- **Secrets**: a secret finding never copies the scanner's message, because scanners often quote the value.
- **Defeating**: the browser can't re-run the tool, so an external monster dies once the exact line it flagged changes.
- **Why a CLI flag**: findings come from a CI run, not from the source tree, so they aren't a `cabn.json` field. That also means an uploaded zip can't inject monsters.

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
