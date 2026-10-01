# cabn

cabn turns a folder or a zip file into a small pixel-art world you can walk around. Folders become clearings with stone fountains, files become portal arches you step through, bugs in the code become monsters you beat by fixing them, and a git repository's branches become alternate universes. It runs in the browser: build a world once and host it anywhere as static files, or serve a folder on your own machine and edit it from inside the game.

It's meant for showing a project to someone (a portfolio piece they can explore instead of a file listing) and for poking around your own code in a way that is more fun than a file tree.

## Quick start

Requires Node 22 and pnpm (through corepack). From a checkout of this repository:

```sh
pnpm install
pnpm build
alias cabn="node $PWD/packages/cli/dist/main.js"
```

Then:

```sh
cabn serve ./my-project            # play a folder locally at http://127.0.0.1:5178/
cabn build ./my-project            # write a static world bundle to ./my-project-world/
```

| Command or flag | What it does |
| --- | --- |
| `cabn serve <dir>` | Converts `<dir>` in memory and serves it as a walkable game on `127.0.0.1` only (port 5178 unless `--port`). Open the URL it prints: the page needs that URL's `?token=`, and answers 404 without it. |
| `cabn serve <dir> --owner` | Owner mode: from inside the game you can place signs, commit your in-game edits, create and switch branches, and see hidden files in the shadow realm. Off unless you pass the flag. |
| `cabn serve <dir> --allow-exec` | The wand really runs `.py`, `.js`, `.mjs` and `.ts` files on your machine instead of simulating them. Only for code you trust. |
| `--offline` | Makes no network requests: skips the build-time check of whether web previews can be framed and the GitHub releases request. Works on `build` and `serve`. |
| `cabn build <dir\|zip> [-o outDir]` | Converts a folder or zip into a static bundle (default output `./<name>-world/`). |
| `--no-history`, `--git-dir <path>` | Leave out git history, or read it from another git directory. Without `--git-dir`, history comes only from a real `.git` folder in `<dir>`; a worktree's or submodule's `.git` pointer file, or a `.git` symlink, needs `--git-dir`. `build` and `serve`. |
| `--findings <file>` | Turn ESLint JSON or SARIF results into monsters. Repeatable. `build` only. |
| `--include-secrets` | Read the contents of secret-named files (`*.pem`, `*credentials*`, ...) instead of leaving them as sealed chests. `build` only. |
| `--timeout <ms>` | Time limit for one real run under `--allow-exec` (default 10 seconds). |
| `cabn shelf <bundleDir...> [-o outDir]` | Writes a `shelf.json` that lists several worlds, so they appear as cabins around one hub. |
| `cabn inspect <bundleDir>` | Validates a bundle and prints a summary. |

A built bundle is a folder of static files. To show it on a website, render it with the `CabnGame` React component from `@cabn/engine`; `apps/demo` is a complete example. See [`packages/engine/README.md`](packages/engine/README.md).

To try the demo instead, run `pnpm -F @cabn/demo dev` and open the printed URL. It converts two sample projects into a shelf of two worlds.

## A tour

The player's guide, [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md), explains every control. In the game, Wren, who stands by the first world's bonfire, gives the same tips: walk up to her and press `Enter`.

- **The shelf and worlds.** The shelf is a hub with one cabin per world. A world starts at its bonfire, with a clearing and a stone fountain for each folder, joined by paths. Walk with `WASD` or the arrow keys, or click the ground. `Enter` (or a click) uses whatever you're at.
- **Loading screen.** A load that takes longer than half a second (starting up, walking into a world or back to the shelf, rift travel, the shadow realm, a slow panel or PDF) shows a pixel panel with a swirl, what is loading, a progress bar when cabn knows how far along it is, and one of Wren's tips. Once shown it stays at least a quarter of a second, so it never blinks. If a world or shelf can't be loaded, the panel says so: "The path to this world has washed out" when the file couldn't be fetched, "The map of this world is torn" when it arrived but this version of cabn can't read it, with **Try again** and, when you came from a shelf, **Back to shelf**.
- **Arches and previews.** Each file is a portal arch showing a live peek of the file in its opening: coloured code, rendered markdown, pictures, a waveform for audio, the first page of a PDF, a table for CSV. Stand at an arch and a larger preview opens at the side. A world's author can point an arch at a real web page, which then plays inside the arch. Scenery and the world's colours come from the project's file tree and name, so a world looks the same every time you rebuild it until files are added or removed.
- **Editing.** Step into a text file and you write on the page directly, with a real caret, undo and save. `Alt+Q` (`Option+Q` on macOS) opens the spellbook, a full editor with find and replace, rename, format, go to line and more, on the same buffer. Edits are saved in the browser, one save per world.
- **Monsters.** When cabn builds a world it looks for problems in the code: broken imports, invalid JSON, unbalanced brackets, import cycles, parse errors, leaked secrets, dead code, code smells and TODO notes. Each becomes one of eleven monster species that circles its file's arch and stands beside its line inside the file. Click one (or `Alt+Enter` beside it), fix the code and save to defeat it. External linters and scanners can add more with `--findings`.
- **Running code.** The wand (`Alt+R` in a file) walks through the file line by line. Everywhere except `cabn serve --allow-exec` this is a simulated trace that never executes anything.
- **Signs.** A `.seyn` file is a short note that stands in the world as a wooden signpost beside the file or folder it describes, with links to other files, signs and web pages. See [`docs/SEYN.md`](docs/SEYN.md).
- **Git multiverse.** A world built from a git repository carries its recent history as a real, read-only git repository that the browser reads with isomorphic-git. The rift near the bonfire lists branches as universes: travel to one and the browser converts that branch into a world on the spot. `H` at an arch opens the pensieve, the file's commit history with diffs and old versions. The big map (`M`) has a timeline slider over the branch's commits.
- **AI pets.** Bring your own key for Claude, OpenAI, Gemini, Qwen or DeepSeek (or use a local Ollama) and a pixel pet follows you and answers questions about the world's files. It can propose edits, which you review as a diff in the spellbook before anything changes.
- **Owner's toolkit.** On your own `cabn serve --owner` page, `O` opens the owner's toolkit: place a sign, open the shadow realm (Sudo), commit, switch branch, create branch.
- **The shadow realm.** Normal worlds leave out hidden files, like `ls` without `-a`. In owner mode, Sudo turns the world into a crimson nether, always in daylight, where only the hidden files show. Folders with nothing hidden shrink to a small patch of ground so the realm stays walkable. Hidden files can be read and edited there, and saves go straight to disk.

## Security model

cabn shows other people's code in a browser and, on your own machine, can write files and run code. These are the rules it keeps:

- **The `cabn serve` page needs the printed URL.** The page carries the session token (and, with `--owner`, the owner token), so `GET /` answers 404 unless the URL's `?token=` matches; another program on your machine can't fetch the page and read them.
- **Owner mode is local, token-gated and off by default.** Nothing can write to your files unless you start `cabn serve --owner`. The server binds to `127.0.0.1` only. Every owner request needs a random per-session token that is written only into the page (never into the printed URL), an exact `127.0.0.1` or `localhost` `Host`, a matching `Origin` on writes, and a schema-checked JSON body. Writes stay inside the served folder, never follow symlinks out of it, never touch `.git`, and git actions never push or fetch. Without `--owner` every `/owner/` route answers 404 and the page contains no owner code at all.
- **Hosted builds never execute code.** A hosted world only ever simulates a run. The code that really runs files exists only in a separate `@cabn/engine/local-exec` entry that only a `cabn serve --allow-exec` page imports, and the demo's build fails if it ever reaches the hosted bundle. `--allow-exec` itself refuses to bind anywhere but `127.0.0.1` and needs its own token on every run.
- **AI keys stay in the browser.** A pet's key is kept in that browser tab (session storage) unless you choose **Remember on this device** (local storage). Requests go straight from the browser to the provider. cabn's backend, the site hosting the world and `cabn serve` never see, relay or store the key. Secrets that a magpie flagged in a file are replaced with `«redacted secret»` before that file is sent to the provider.
- **Publishing a world publishes its git history, author emails included.** A repository's world ships real commits, byte for byte: names and email addresses of authors and committers, signatures, and every old version of ordinary files, hidden ones included. Left out of every commit: files with secret-looking names (`.env`, `*.pem`, `*credentials*`, `.npmrc`, `.pypirc`, `.docker/config.json`, `.kube/config`, ...), any text file version in which cabn's leaked-secret check finds a key, very large files and ignored folders. The check is heuristic: a key it doesn't recognise still ships, so a key that was ever committed should be rotated. Build with `--no-history` or set `"history": { "enabled": false }` if you don't want that.
- **Hidden files appear only in the owner's shadow realm.** Paths with any segment starting with `.` (`.env`, `.github/`, `.vscode/`) are left out of every normal world: `cabn build`, `cabn serve`, the backend, hosted bundles and universes converted in the browser. The shadow realm is computed by the `cabn serve --owner` process on request and never written into the bundle, so no hidden file can be fetched from a world's files. Pets never see hidden files.
- **Web previews are opt-in.** An arch shows a live page only for origins the world's author listed in `allowedEmbedOrigins`, inside a sandboxed iframe. The build-time framing check reads headers only, and the backend never fetches uploaded worlds' URLs.

## `cabn.json` reference

A `cabn.json` at the root of a project changes how its world is built. It is validated strictly (`packages/world-schema/src/cabnConfig.ts`): an unknown key or an out-of-range value fails the build with a message naming it.

```json
{
	"cabnConfigVersion": 1,
	"previews": {
		"README.md": { "kind": "image", "src": "assets/logo.png" },
		"NOTES.txt": { "kind": "text", "text": "A short blurb shown in the arch." },
		"docs/site.md": { "kind": "url", "url": "https://example.com/", "title": "Project website" }
	},
	"allowedEmbedOrigins": ["https://example.com"],
	"media": { "maxFileBytes": 10485760, "maxTotalBytes": 104857600 },
	"annotate": { "maxFunctionLines": 120, "maxNestingDepth": 5 },
	"history": { "maxCommitsPerBranch": 50, "releases": false },
	"embedCheck": true,
	"guide": false
}
```

| Key | Type | Default | Bounds and notes |
| --- | --- | --- | --- |
| `cabnConfigVersion` | `1` | required | Must be exactly `1`. |
| `previews` | object: path → override | `{}` | Keys and `src` paths are relative to the project root: no leading `/`, no `.` or `..` segments, no backslashes. A key naming a hidden file is skipped; a hidden `src` is refused. |
| `previews.*` `{ "kind": "image", "src" }` | | | Show another image from the project in the arch. |
| `previews.*` `{ "kind": "markdown", "src" }` | | | Show another markdown file from the project. |
| `previews.*` `{ "kind": "text", "text" }` | | | A short blurb, 1 to 2000 characters. |
| `previews.*` `{ "kind": "url", "url", "title"?, "fallbackImage"? }` | | | A live web page. `url` must be `https://` and its origin must be in `allowedEmbedOrigins`, or the build fails. `title` up to 200 characters. `fallbackImage` is an image path in the project. |
| `allowedEmbedOrigins` | array of origins | `[]` | Exact `https://host[:port]` origins: no path, query or wildcard. |
| `media.maxFileBytes` | integer | 5 MB (5242880) | 1 byte to 25 MB (26214400). Per picture, audio file or PDF shipped in the world. |
| `media.maxTotalBytes` | integer | 50 MB (52428800) | 0 to 250 MB (262144000). Whole-world media budget; 0 ships no media. A host (such as the backend) can set lower ceilings that `cabn.json` can't exceed. |
| `annotate.maxFunctionLines` | integer | 80 | 10 to 2000. A longer function is a bramble. |
| `annotate.maxNestingDepth` | integer | 4 | 2 to 20. Deeper control-flow nesting is a bramble. |
| `history.enabled` | boolean | `true` | `false` ships no git history and skips the releases request. |
| `history.maxCommitsPerBranch` | integer | 200 | 1 to 1000. The shallow boundary per branch. |
| `history.maxBranches` | integer | 20 | 1 to 100. |
| `history.maxTags` | integer | 50 | 0 to 500. |
| `history.maxReleases` | integer | 10 | 0 to 100. |
| `history.maxPackBytes` | integer | 20 MiB (20971520) | 1 MiB (1048576) to 200 MiB (209715200). Over it, commits per branch halve until the pack fits. |
| `history.maxBlobBytes` | integer | 2 MiB (2097152) | 16 KiB (16384) to 25 MiB (26214400). Larger file versions are "not shipped". |
| `history.releases` | boolean | `true` | `false` skips the build-time GitHub releases request. |
| `embedCheck` | boolean | `true` | `false` skips the build-time check of whether url previews can be framed; every one is then assumed framable. `--offline` does the same. |
| `guide` | boolean | shown in the first world of a shelf | `false` hides Wren. By default she appears in the first world listed in `shelf.json` and in a world opened on its own (such as `cabn serve`). |

`--findings` is deliberately a command-line flag, not a `cabn.json` key: findings come from a CI run rather than the source tree, and an uploaded zip can't inject monsters.

## Troubleshooting

**A pet using Ollama can't connect.** A world opened on your own machine (`cabn serve`, or the demo on localhost) reaches Ollama at `http://localhost:11434` without setup. A hosted `https://` page can only reach it if Ollama allows that page's origin, for example `OLLAMA_ORIGINS=https://your-site.example ollama serve`, and the browser allows the page to talk to your local network. Safari doesn't allow it.

**Pets fail on my own site with a CSP error.** If your host page sends a `Content-Security-Policy` with `connect-src`, it has to list the provider APIs the pets call: `https://api.anthropic.com`, `https://api.openai.com`, `https://generativelanguage.googleapis.com`, `https://api.deepseek.com`, the DashScope region you use for Qwen (`https://dashscope-intl.aliyuncs.com`, `https://dashscope-us.aliyuncs.com` or `https://dashscope.aliyuncs.com`) and, for Ollama, `http://localhost:11434`. The provider table is `packages/engine/src/pets/providers.ts`. `cabn serve`'s own page sends only a `frame-src` policy, so it isn't affected.

**A world built from a git worktree or submodule has no history.** cabn reads history only from a real `.git` folder in the directory you build, so a `.git` pointer file (linked worktrees, submodules) or a `.git` symlink is not followed: it could point at any repository on the machine. `cabn build` prints `Note: git history skipped: .git is a pointer file (a linked worktree or submodule), which cabn doesn't follow; pass --git-dir to read that repository`, and owner-mode git actions report no usable repository. Pass `--git-dir` to opt in: a submodule's real git directory (`<superproject>/.git/modules/<name>`) works; a linked worktree still doesn't, because isomorphic-git doesn't follow its `commondir`, so build or serve from the main checkout. Subfolders of a repository get no history either: cabn never searches upward for a `.git`.

**The demo shows an old world after I changed the converter.** The demo rebuilds a world when its fingerprint changes. The fingerprint hashes the source tree and the built `dist/` output of `@cabn/world-schema`, `@cabn/converter` and `@cabn/cli`, not their `src/`, so run `pnpm -r build` after changing converter code. `pnpm -F @cabn/demo build:world -- --force` rebuilds regardless. Fingerprints live in `apps/demo/node_modules/.cache/cabn-worlds/`; deleting that folder forces one rebuild of each world.

**A web page won't show in its arch.** Many sites refuse to be framed. `cabn build` and `cabn serve` check each url once at build time and give a refusing site a title card with **Open in browser** instead. A host page also needs `frame-src` in its CSP to allow the listed origins; see [`packages/engine/README.md`](packages/engine/README.md).

## Developing

```sh
pnpm install
pnpm build    # tsc per package, in dependency order
pnpm test     # Vitest per package
pnpm lint     # Biome
```

Agent-facing notes, every script and env var, and the repository layout are in [`CLAUDE.md`](CLAUDE.md). How the packages fit together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Changes are logged in [`CHANGELOG.md`](CHANGELOG.md).

| Path | Package | What it is |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas and types for the world bundle, `cabn.json`, sidecars, world layers and the `.seyn` parser |
| `packages/converter` | `@cabn/converter` | `convert()`: folder or zip → validated world bundle (walk, classify, layout, annotate, search index, git history); `buildShelf()`; `convertShadow()` for the owner's shadow realm |
| `packages/engine` | `@cabn/engine` | Phaser 3 game and its React HUD (`CabnGame`), bridged with zustand and mitt; owner and real-execution clients behind separate entry points |
| `packages/cli` | `@cabn/cli` | The `cabn` command: `build`, `inspect`, `shelf`, `serve` |
| `apps/backend` | `@cabn/backend` | Authenticated Fastify service: zip in, world bundle out |
| `apps/demo` | `@cabn/demo` | Vite + React demo that builds two sample worlds into a shelf; home of the Playwright tests |
| `tools/asset-pipeline` | `@cabn/asset-pipeline` | Deterministic pixel-art generation for every sprite, including the owner-only shadow art |

World layout is byte-stable across runs on one JavaScript engine. Reproducing it across engines isn't guaranteed, because it uses `Math.cos`/`Math.sin`, whose last-bit rounding isn't required to match.

### Run the demo

```sh
pnpm -F @cabn/demo dev
```

The first run converts `apps/demo/sample-project/` and `apps/demo/notes-vault/` into two world bundles (`apps/demo/public/worlds/{sample,notes}/`), writes a `shelf.json` listing both, and copies sprites into `apps/demo/public/assets/`. All of it is gitignored and regenerated on demand (`pnpm -F @cabn/demo build:world`). The sample world's git history comes from a generated fixture repository (`apps/demo/scripts/gen-git-fixture.mjs`), so the demo works from a linked worktree too.

Every `dev`, `build` and `build:world` checks whether each world is stale and rebuilds only those that are. A world's fingerprint is a sha256 over:

- its source tree (every file's path and bytes, `cabn.json` included), its findings file (`sample-findings.eslint.json`) and its build options;
- the toolchain: the `version` and built `dist/` contents of `@cabn/world-schema`, `@cabn/converter` and `@cabn/cli` (minus the cli's bundled sprites), the world-schema `CABN_VERSION`, and `scripts/gen-git-fixture.mjs`.

The fingerprint is written to `apps/demo/node_modules/.cache/cabn-worlds/<name>.txt` after a successful build, outside `public/`, so it never ships. A world is rebuilt (its output folder cleared first) when its `world.json` is missing, its fingerprint is missing or different, or you pass `-- --force`. Hashing contents rather than modification times means a `pnpm -r build` that rewrites identical `dist/` files doesn't trigger a rebuild.

### Browser tests

`apps/demo/e2e/` holds the Playwright suite. It runs against `vite preview` of the production build, so it tests what the hosted demo ships. `smoke.spec.ts` checks for console errors, that the canvas actually draws (a pixel-variance check) and that walking into a cabin loads a world; other specs cover editing, monsters, previews, git, pets, signs, the owner toolkit and the shadow realm (the last few start their own `cabn serve --owner`).

```sh
pnpm -F @cabn/demo build   # produces the dist/ the tests preview
pnpm -F @cabn/demo e2e
```

CI installs its own matching Chromium. Locally, if the Chromium that `@playwright/test` expects isn't cached in `~/Library/Caches/ms-playwright/`, point `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at a cached build instead of installing a new one. Ports and other test switches are listed in `CLAUDE.md`.

CI also runs `pnpm audit --audit-level=high`, which fails only on high or critical findings.

## How it works, in more detail

### Hidden files: `ls`, not `ls -a`

Since 2026-09-28 a world leaves out every hidden path, meaning any path with a segment that starts with `.`: dotfiles (`.env`, `.gitignore`, `src/.eslintrc.json`) and everything inside a dot-folder (`.github/`, `.vscode/`, `.husky/`). This applies to every normal world: `cabn build`, `cabn serve`, the backend, hosted bundles and universes converted in the browser. A `cabn.json` override naming a hidden file is skipped instead of failing as a typo; one whose `src` is a hidden file is refused. Ignored folders (`.git`, `.venv`, `.next`, `node_modules`, ...) stay out as before. The git history's `git/` pack keeps hidden files that aren't secret-named, as they are in git; secret-pattern files, and text blobs with a detected key, are never shipped from any commit. The walker's switch is `walk(source, { hidden: "exclude" | "only" })`, and `isHiddenPath(path)` is the rule.

### Previews and media

Every portal carries a richer default preview than the small in-arch panel: syntax-coloured code, a structured breakdown of a markdown file, a copied-in image, or a "sealed" notice for binaries (`@cabn/engine`'s `PortalPreview` component renders this, either compact or expanded).

PNG/JPEG/GIF/WebP images, MP3/WAV/OGG audio and PDFs ship their bytes in the bundle as `media/<content hash>.<ext>`, fetched lazily by the engine (never inlined in `world.json` or chunks). Each file's type is checked by its magic bytes, not its extension; a mismatch stays a sealed chest. Anything over a cap, over the world budget, secret-patterned, or SVG/xlsx (not previewed: SVG can carry scripts) stays a sealed chest that shows its name, size and the reason. Audio gets a waveform decoded in the browser plus play/pause/seek; PDFs render page 1 in the arch and a paged viewer in the dock and file view via `pdfjs-dist` (lazy-loaded; the host serves the worker itself, so pass `pdfWorkerUrl` to `CabnGame`); CSV/TSV files show as a table. Audio/PDF metadata lives in an optional `media.json` beside `world.json`, so engines from before it show those files sealed.

A `url` override renders as a live sandboxed iframe (`PortalEmbed`). See `packages/world-schema/README.md` for the override format and `packages/engine/README.md` for the component API and the `Content-Security-Policy: frame-src` a hosting page must set for the embed to load (the sandbox attribute alone isn't enough). Walking up to a url arch lays that live page over the arch's opening (one at a time, unmounted when you walk away). Walk right up and the same iframe moves into the side panel at a readable size, where you can scroll it and click links; click outside it to walk again. Only origins in `allowedEmbedOrigins` are framed or opened.

Monsters orbiting a web arch circle wide enough to stay visible around the page (`webPortalOrbitEllipse` in `systems/monsterOrbit.ts`). When the side panel would cover the arch or those monsters on a narrow screen, it narrows (down to 320px) or moves to the left edge (`systems/dockPlacement.ts`), and the minimap hides while it's open.

Many sites refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), and a browser gives the embedding page no reliable signal when that happens. So `cabn build` and `cabn serve` check each url once at build time (HEAD, falling back to GET; https-only redirects, at most 5; 5s budget; only headers are read) and record the verdict in `embeds.json` beside `world.json`. A blocked site never gets an iframe. `--offline` (or `"embedCheck": false`) skips the check; `convert()` itself never touches the network unless the host passes `embedNetwork`, and the backend never does (fetching uploaded worlds' urls would be an SSRF vector). The demo's `docs/threejs.md` (framable) and `docs/code-host.md` (github.com, blocked) show both cases.

### Monsters

Every problem a world's files have is found at conversion time and spawns a monster, one species per error code. Tier is severity, from 0 (cosmetic) to 3. When a file has two or more real bugs, each goes up one tier.

| Species | Error code | Tier | What it means |
| --- | --- | --- | --- |
| Ghost | `NullTypeError` | 1 | A relative import or markdown link that doesn't resolve to any file in this world |
| Rot-sprite | `Corrupted` | 1 | Invalid JSON, or a markdown frontmatter block that opens with `---` and never closes |
| Warded Mimic | `InvalidMode` | 1 | An invalid or undecodable byte (shows up as U+FFFD, the replacement character) |
| Gremlin | `IoError` | 1 | An unclosed, mismatched or unexpected bracket, or an unterminated string literal |
| Ouroboros | `OuroborosError` | 1 | A circular import between two or more files |
| Will-o'-Wisp | `WispNote` | 0 | A `TODO`/`FIXME`/`XXX`/`HACK` in a comment. Cosmetic, never an encounter |
| Hex Imp | `SyntaxError` | 2 | A real parse error, from the same Lezer grammars the editor uses (JS/JSX, Python, CSS, HTML). TypeScript isn't covered, because that grammar flags too much valid TS. A file that has a gremlin gets no imps, so one mistake is one monster |
| Magpie | `LeakedSecret` | 3 | A hard-coded credential: an AWS/GitHub/Anthropic/OpenAI/Slack/Stripe/Google key, a PEM private key, a database URL with a password, or a random-looking string assigned to a secret-ish name. The message shows only the key's prefix and length |
| Skeleton | `DeadCode` | 1 | An unused import, an unused variable or function, or code after `return`/`throw`/`raise`/`break`/`continue` |
| Bramble | `CodeSmell` | 1 | A function over 80 lines, nesting deeper than 4, a copy-pasted block of 6+ lines, or a debug leftover outside scripts, tests and CLIs (limits in `cabn.json`'s `annotate`) |
| Shade | `UnknownBug` | 1 | A finding from an external tool (`--findings`) that doesn't fit a built-in class |

Clicking a monster in a file, or pressing `Alt+Enter` with the caret within two lines of it, shows a card naming the bug. It waits for the player: `Esc` closes it, and anything else opens the spellbook on the offending line. Saving re-checks every monster still open in that file: a fixed bug's monster flashes and vanishes in a puff of smoke, and one that isn't fixed shrugs and gives a hint. A wisp dies as soon as its note is removed and saved. The HUD's bottom-left counter tracks the bugs left.

Monsters are identified by what they flag, not by line number: the rules for wisps, gremlins, ghosts, warded mimics and rot-sprites are keyed on the note text, the bracket and its line, the import specifier and so on. Adding lines above a monster moves it with its code (in the file view, the spellbook and after re-entering the file) and never counts as a fix. A single file can hold at most 20 built-in monsters and a world 2000.

False alarms cost more than missed bugs in a game about fixing real bugs, so the newer checks hold back: dead code counts a name as used if the word appears anywhere else in the file; the imp ignores known grammar gaps (a test runs the imp and dead-code checks over this repo's own source and expects zero hits); the secret check skips placeholders and doesn't run its generic pattern in tests or `.example` files; the debug-print check skips scripts, tests, CLIs and server entry points.

The five newer species (imp through shade) are stored in `monsters.json` next to `world.json`, so engines that read `world.json` strictly still load new worlds and just don't show them.

#### External findings (`--findings`)

```sh
eslint . --format json > eslint.json
cabn build ./my-project --findings eslint.json --findings codeql.sarif
```

`--findings` takes `eslint --format json` output or any SARIF 2.1.0 file (CodeQL, Semgrep, Ruff, secret scanners, ...), validated before use. Each finding becomes the closest built-in monster by rule id and tags (`no-unused-vars`/`F401` → skeleton, `complexity`/`no-console` → bramble, a secret-scanner or CWE-798 rule → magpie, `import/no-unresolved` → ghost), and anything else a shade. Paths are matched relative to the folder being built; findings for paths outside the world, or duplicating a built-in monster, are dropped. A secret finding never copies the scanner's message. The browser can't re-run the tool, so an external monster dies once the line it flagged changes.

### Running a file

`Alt+R` inside a file starts a run: a parchment shows the current line and a log while a spark walks the file.

| Control | Keyboard | What it does |
| --- | --- | --- |
| Play/Pause | `Space` | Toggles auto-advance (700ms per step at 1x) |
| Step | `N` | Advances exactly one step |
| Speed | `1` / `2` / `4` | Sets playback speed |
| Stop | `Esc` | Ends the run |

If a monster stands on a line the run reaches, playback pauses there. By default, everywhere including the hosted demo, a run is a **simulated trace**: a heuristic top-to-bottom walk (imports, top-level statements, function definitions, stepping into a locally defined function when it's called) that never executes the file's code.

### `cabn serve --allow-exec`: running a file for real

```sh
cabn serve ./my-project --allow-exec
```

This really runs `.py`/`.js`/`.mjs`/`.ts` files on your machine (`python3` / `node`, no shell, a 10-second default timeout, a 256 KB output cap, and a path check confined to the folder with no traversal or symlink escape). A per-process random token is required on every run request, the server checks the request's `Host` and `Origin` headers (against DNS rebinding and stray cross-origin pages), and it refuses to start if asked to bind anywhere but `127.0.0.1`. Python runs get genuine per-line tracing (`sys.settrace`, restricted to the target file); JS/TS runs stream real output but use the heuristic trace for line structure (the parchment labels these "approximate lines"). It prints a warning banner at start.

`cabn serve`'s page is sent with `Content-Security-Policy: frame-src <the world's allowedEmbedOrigins>` (`frame-src 'none'` when there are none) and no other directive.

### Signs (`.seyn`)

A `.seyn` file stands in the world as a wooden signpost beside the arch or fountain it describes, instead of becoming a portal: a title line, paragraphs, `- ` bullets, `*emphasis*`, and `[[links]]` to files, folders, other signs and `https://` pages. The format is specified in [`docs/SEYN.md`](docs/SEYN.md). The converter lists signs in `signs.json` beside `world.json` (older engines ignore it), and sign text is searchable with the orb.

Everyone sees signs. Only the owner can place, edit or delete them, on a `cabn serve --owner` page: `O`, then **Place sign**, click where it should stand, write it in the editor with a live preview, and save. The server writes only `.seyn` files (16 KiB max) inside the served folder: no absolute paths, `..`, hidden or ignored folders, symlinked folders pointing outside, or symlinks at the target. New files are created exclusively; edits go to a temp file renamed over the old one.

### Saving

Edits, your position, visited clusters, bag slots and defeated monsters persist to `localStorage` per world (keyed by its source and conversion time, so reconverting starts a fresh save). An edited file gets a ✎ marker on its arch and in the spyglass, which can reset one file or the whole world. A corrupt or incompatible save is ignored rather than breaking the game.

The top-left corner holds the time-of-day setting: `Auto` (follows your clock), `Day` or `Night`. The soft bloom and vignette are always on where WebGL is available.

### Git history: the multiverse

When the folder you build is a git repository root (it has its own `.git` directory, not a symlink or pointer file; `--git-dir` opts in to anything else), the world carries its recent history as a small, real git repository. The browser reads it with [isomorphic-git](https://isomorphic-git.org/) (MIT, pinned 1.42.2).

- **The rift** near the bonfire lists branches as universes. Travelling converts that branch's tree into a world in your browser, caches it for the visit, and reloads as that branch with a badge and a tint. An on-demand universe assumes its web previews can be framed and has no external findings. The second tab lists tags and GitHub releases (notes rendered as a safe markdown subset, never HTML).
- **The pensieve**: `H` at an arch (`Alt+H` in a file, or the dock's button) shows that file's commits on this branch, each diff (computed in the browser) and the whole file at any commit.
- **Map timeline**: the big map (`M`) has a slider over the branch's commits; files the selected commit changed are ringed in gold.

What ships: a read-only `git/` folder (`HEAD`, `config`, `packed-refs`, `shallow`, one pack and its index), `git/files.json` (the exact files there; the page never fetches anything else from `git/`), `git/meta.json` (branch and tag summaries) and `releases.json`. Per branch the last 200 commits, up to 20 branches and 50 tags, blobs up to 2 MB, a 20 MB pack (the boundary halves until it fits); `cabn.json`'s `history` adjusts each. Blobs of secret-named files, text blobs in which the leaked-secret check finds a key (once per blob, after the size cap), blobs over the cap and ignored folders are left out, though the trees still point at them; the pensieve says "not shipped". GitHub releases (and, with a `GITHUB_TOKEN`, packages) are fetched once at build time, only for a `github.com` remote; the token is only a request header. The backend never fetches and uploaded zips never get history.

The pack is written by cabn itself (whole objects, no deltas; `git verify-pack` accepts it) so `cabn serve` can build the same one in memory. isomorphic-git, a `Buffer` polyfill and the in-browser converter load in lazy chunks (about 79 KB gzipped) the first time the rift, pensieve or timeline opens.

### Owner mode: `cabn serve --owner`

```sh
cabn serve ./my-repo --owner
```

`--owner` is the one owner switch, off by default. Every owner action sits behind **one key, `O`**, and one hotbar slot: the owner's toolkit, a small menu listing Place sign, Sudo and, in a world with git history, Commit, Switch branch and Create branch. Arrow keys or `1`–`9` pick an entry, `Enter` uses it, `Esc` (or `O` again) closes it, and the mouse works too. While it's open it owns the keyboard. The entries come from the owner capability (`owner.signs`, `owner.git`, each `owner.layers[].tools`); the main engine only renders a generic list. Without `--owner` there's no slot and `O` does nothing.

All owner routes (`/owner/signs/*`, `/owner/git/*`, `/owner/shadow/*`) go through one gate, `packages/cli/src/serve/ownerAuth.ts`: a per-session token separate from the page token, an exact `127.0.0.1`/`localhost` Host, an Origin naming this server on every write (the read-only git status GET accepts `Sec-Fetch-Site: same-origin` instead; any cross-site `Sec-Fetch-Site` is refused), `Content-Type: application/json` on writes and a zod-validated body.

**Git.** The toolkit's git entries open the rift's **Owner** tab, which works on the real repository through isomorphic-git in the serve process: commit your saved in-game edits (pick the files, write a message), create a branch (optionally switching to it) and switch branches. Nothing is ever pushed or fetched; no remote operation exists in the code. The author comes from the repository's git config, or the page asks. Writes are confined to text files the world was converted from and refuse to overwrite a file that changed on disk, to commit when other changes are staged, or to switch with a dirty working tree. Each action reconverts the world and reloads the page, so edits not part of the action are first set aside in an in-browser stash keyed by repository and branch, and the Owner tab offers them back on that branch.

#### The shadow realm

With `--owner`, the serve process can show the owner the hidden files a normal world leaves out: dotfiles and dot-folders at any depth, but not `.git` internals or ignored folders. They arrive as a *world layer*: extra clusters, portals, paths, monsters and signs placed around the base world without moving any of it (`convertShadow` and `shadowLayout.ts` in `@cabn/converter`'s Node entry; the format is `WorldLayerDeltaSchema` in `@cabn/world-schema`). Dotfiles in a visible folder join that folder's annex `<clusterId>#shadow`; a dot-folder hangs off the nearest visible ancestor. Secret-named hidden files such as `.env` are readable here; a leaked key in one spawns a magpie only when git tracks the file. The layer is computed on the first request, kept in the serve process and dropped whenever the world reconverts. It is never put into the served bundle.

| Route | |
|---|---|
| `GET /owner/shadow/manifest` | The layer without file contents or search index (`WorldLayerManifestSchema`), including `baseGeneratedAt` (a layer for another base world is stale) and each text file's `textSha256`. |
| `GET /owner/shadow/chunk/<clusterId>` | One shadow cluster's file contents (URL-encode the id: `root%23shadow`). |
| `GET /owner/shadow/search-index` | A minisearch index of the hidden text files and shadow signs. |
| `POST /owner/shadow/save` | `{ path, content, baseSha256 }`: overwrites an existing hidden text file on disk only, never staged or committed. 409 when the file's SHA-256 isn't `baseSha256`. Refused for anything that isn't a hidden text file in the layer, is reached through a symlink or sits in the git directory. Body capped at 2 MB, content at 512 KB. The file keeps its permission bits. |

Every route answers `Cache-Control: no-store`, and 404 without `--owner`. `/owner/signs/save` and `/owner/signs/delete` take `realm: "shadow"` for a sign in a hidden folder; a shadow sign updates only the cached layer, never `signs.json`.

In the game, Sudo sinks the normal arches and raises the hidden clusters. The realm shows only hidden files: no normal arch, preview, embed, monster or sign, and the orb, spyglass, map and monster counter list only the realm's own. The world is redrawn as a nether (ember sky, lava paths, braziers, dead trees, nether-recoloured monsters) and the HUD, file view and spellbook go crimson. The realm is always in its day look, whatever the time-of-day setting. Base clearings, fountains and paths stay as the skeleton; a base clearing with nothing left to show draws only a small patch of ground around its fountain, with its paths still leading in. Nothing moves: every cluster keeps its position and scenery stays where it was. Hidden files save to disk (`POST /owner/shadow/save`), and on a conflict the game offers to reload from disk. Shadow edits are never written to browser storage; visits and defeated monsters in the realm go in a separate save slot, `cabn:save:<worldId>#shadow`. Pets never see any of it.

The engine's main entry has only a neutral world-layer seam; the shadow client, skin and art are in `@cabn/engine/owner` and `assets/generated/shadow/`, served only with `--owner`, and the demo's postbuild check fails the build if any of it reaches the hosted bundle.

### AI pets (bring your own key)

Click **Pet** in the top-left corner of a world, pick Claude, OpenAI, Gemini, Qwen, DeepSeek or a local Ollama, paste a key and summon a pixel pet that follows you and answers questions about the world's files. It lists files, reads raw text, searches and proposes edits, which are applied only after the player accepts a diff in the spellbook. Provider calls go straight from the browser with plain `fetch` (no SDKs); the key lives only in that browser (session storage by default, local storage only on opt-in). An undefeated magpie's secrets are redacted from any file sent to the provider, and the pet never sees hidden files. The demo's postbuild also fails if a key-shaped string (`sk-…`, Google, GitHub, AWS keys, private key blocks) lands in the bundle. The player's side is in [the guide](docs/USER_GUIDE.md#ai-pets-bring-your-own-key); the code is `packages/engine/src/pets/` (provider table in `providers.ts`, agent loop in `agentLoop.ts`).

## Backend API

`apps/backend` (`@cabn/backend`) is a Fastify service wrapping `@cabn/converter`: `POST /v1/worlds` takes a single-file multipart zip upload and returns the converted world bundle as a zip; `GET /healthz` returns `{ok: true, version}` unauthenticated. Nothing is persisted: the upload is converted in memory and discarded once the response is sent.

```sh
pnpm -F @cabn/backend dev     # tsx watch src/server.ts
pnpm -F @cabn/backend test    # vitest run
pnpm -F @cabn/backend build   # tsc -> dist/
pnpm -F @cabn/backend start   # node dist/server.js
```

**Auth.** Every request to `POST /v1/worlds` needs `Authorization: Bearer <key>`. The server only holds SHA-256 hashes of valid keys (`CABN_API_KEY_SHA256`, comma-separated hex). Generate one with:

```sh
pnpm -F @cabn/backend keygen
```

This prints a new key once (`cabn_...`) and its SHA-256 hash. With `NODE_ENV=production` and no hashes configured, the server refuses to start; in development it starts, but `POST /v1/worlds` answers `503`.

**Abuse limits.** Upload size is capped (`MAX_UPLOAD_BYTES`, default 25MB) by `@fastify/multipart`'s streaming limit (413 on overflow). Exactly one file is accepted (400 otherwise) and it must be a zip by its magic bytes (415 otherwise). The converter's own caps always apply, and secret-pattern files are never read. `@fastify/rate-limit` enforces independent per-IP and per-key limits. Requests time out after `REQUEST_TIMEOUT_MS` (default 30s). CORS is closed unless `CORS_ORIGINS` is set. The logger redacts `Authorization` headers.

See `.env.example` for every variable and `apps/backend/Dockerfile` for the production container. Behind a proxy, set `CABN_TRUST_PROXY` to the number of proxies in front of the app (Railway: `1`) so rate limits key off the real client IP; the client-written part of `X-Forwarded-For` is never trusted. The old value `true` still means one proxy.

## Releasing

The four publishable packages (`@cabn/world-schema`, `@cabn/converter`, `@cabn/engine`, `@cabn/cli`) are versioned with [Changesets](https://github.com/changesets/changesets) (`.changeset/`); `apps/backend`, `apps/demo` and `tools/asset-pipeline` are private. Publishing is **always a manual, human-triggered action**: `.github/workflows/release.yml` only runs on `workflow_dispatch`.

```sh
pnpm changeset
```

Publishing uses npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN` secret. One-time setup:

1. Create the `cabn` org on npmjs.com (a manual web step).
2. **First publish is manual (verified 2026-09-27).** npm requires a package to exist before a trusted publisher can be attached, so each package's first `0.1.0` goes out once from a maintainer's machine: `pnpm -r build && pnpm -r publish --access public`.
3. Attach the trusted publisher per package, on npmjs.com (GitHub Actions, owner `SebastianFrazier26`, repo `cabn`, workflow `release.yml`) or with npm ≥ 11.15: `npx npm@12.1.0 trust github <package> --repo SebastianFrazier26/cabn --file release.yml --allow-publish`. Trusted publishing needs npm ≥ 11.5.1 and Node ≥ 22.14 in the workflow.
4. Run the "Release" workflow from the Actions tab. It installs, builds, tests, then runs `changeset publish` with npm provenance.

## Deploying the backend

`.github/workflows/deploy-backend.yml` deploys `apps/backend` to [Railway](https://railway.app) with the Railway CLI. It runs on pushes to `main` that touch the backend or its dependencies, and on `workflow_dispatch`. The deploy step is a no-op until a `RAILWAY_TOKEN` repository secret exists. To wire it up: create a Railway project and service, add a Railway API token as the `RAILWAY_TOKEN` secret, and set the backend's env vars on the service (`CABN_API_KEY_SHA256`, `NODE_ENV=production` and `CABN_TRUST_PROXY=1` at minimum).

## License

MIT. See [LICENSE](LICENSE).
