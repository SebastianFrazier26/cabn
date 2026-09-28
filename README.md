# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews), M4 (`FileScene`, enchanted markdown, the tool hotbar and orb search), M5 (the quill editor, bag paste, and save persistence), M6 (annotators, monster species, and fix-to-defeat battles), and M7 (the wand tool's run parchment, a pluggable simulated/real execution provider, `cabn serve`, and a soft glow post-effect) have landed.

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index, error annotation -> monsters); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf/file scenes, a zustand+mitt React bridge (`CabnGame` and its HUD: `ToolHotbar`, `SpyglassPanel`, `OrbSearch`, `BagTray`, `EditorOverlay`, `SettingsCorner`, `FileOverlay`, `MonsterCounter`, `EncounterBanner`, `RunOverlay`), walkable world with lazy chunk loading, in-arch portal previews, a shelf hub listing every converted world, a walkable parchment-scroll file view with enchanted markdown, a CodeMirror-backed quill editor with bag paste, monster sprites (hovering near portals/paths in the world, standing beside their line in a file) with a walk-into-and-`E` fix-to-defeat battle loop, localStorage-backed save persistence (file edits, player position, visited clusters, bag slots, defeated monsters), a pluggable `ExecutionProvider` (`TraceProvider` heuristic by default and always in a hosted build; `LocalRunProvider`, real execution, only reachable via `@cabn/engine/local-exec` from a `cabn serve --allow-exec` host page) driving the wand tool's run parchment, and a soft bloom+vignette glow post-effect (toggleable, on by default) |
| `packages/cli` | `@cabn/cli` | `cabn build <dir\|zipfile>`, `cabn inspect <bundleDir>`, `cabn shelf <bundleDir...>`, and `cabn serve <dir> [--allow-exec]` |
| `apps/backend` | `@cabn/backend` | Upload/convert API service (Fastify planned) |
| `apps/demo` | `@cabn/demo` | Vite + React demo app — converts `sample-project/` and `notes-vault/` into two worlds, builds a shelf listing both, and renders it as a walkable `CabnGame` shelf |
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

### Controls

- **Move**: WASD or arrow keys, everywhere (shelf, a world, inside a file).
- **Enter**: walk into a cabin/portal/file-exit arch and press `E` (or Enter) — same key everywhere: shelf cabin -> world, world portal -> file, file's top arch -> back to the world. Walking up to a monster inside a file and pressing `E` starts an encounter instead (see Monsters below).
- **Esc**: leave a world at the bonfire (back to the shelf), close a file (back to the world at the portal you entered), cancel a bag selection in progress, or back out of an encounter banner before the quill opens.
- **Tool hotbar** (bottom of screen, click a slot or use its hotkey):
  - **Opener** (`E`) — the enter behavior above, also reachable as a tool.
  - **Spyglass** (`L`) — lists the portals in whatever cluster you're standing in (name, kind, size); click one to auto-walk there.
  - **Orb** (`F`, or `Cmd`/`Ctrl`-`F` which also blocks the browser's own find) — fuzzy search the whole world by name/path/content while walking around, or search just the open file's lines while inside one; picking a result auto-walks to it (world) or jumps/highlights the line (file).
  - **Bag** (`B`) — inside a file, starts a line selection at your current line (shift + up/down to extend), and a second `B` grabs it into a bag slot (shown bottom-left, capped at 5).
  - **Quill** (`Q`) — inside a file, opens the editor overlay with the caret on the line nearest you. `Ctrl`/`Cmd`-`S` saves; `Esc` closes (asks first if there are unsaved changes). While it's open, the bag tray's slots become paste buttons (or use `Alt`+`1`-`5`) that insert that slot's text at the cursor.
  - **Wand** (`R`) — inside a file, starts a *run*: a parchment scroll unfurls over the bottom-right of the screen and a spark travels the file line by line, the camera easing along with it. By default this is always a simulated trace (`TraceProvider`, a heuristic that never executes a single line of your code); it's only ever a *real* run of a file's code when you're pointed at a `cabn serve --allow-exec` instance (see below).

Inside a world, a portal arch shows a live preview in its opening as you approach. A file opens as a walkable parchment scroll (line-numbered, camera follows you down it); markdown files render "enchanted" — gold glowing headings, tinted bold/italic, pale-blue underlined links, boxed code spans, and leaf-dot list bullets.

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

A monster hovers near its file's portal arch in the world (or, for an ouroboros whose cycle crosses clusters, at the midpoint of the path between them — cosmetic only, not fightable there) and stands beside its line inside the file. Walking into one and pressing `E` starts an encounter: a short banner names the monster and shows the error, then the quill opens on the offending line. Saving re-checks every monster still open in that file, not just the one you're fighting — fix the underlying problem and it dies (a fade, a few sparkles, and "Fixed!"); the fix doesn't take and it shrugs off the hit with a shake and a hint, editor still open so you can try again. A wisp never triggers an encounter at all — removing its `TODO` and saving is enough to make it vanish. The HUD's bottom-left counter tracks how many bugs remain in the world you're in.

### Saving

Edits, your position in the world, which clusters you've visited, your bag slots, and which monsters you've defeated persist to `localStorage` per converted world (keyed by its source + conversion time, so reconverting the same source starts a fresh save). An edited file gets a small ✎ marker on its portal arch in the world and in the spyglass panel, which also offers a "reset" action per edited file; a settings button in the top-left corner (hidden while the editor is open) resets everything for the current world, monsters included. A corrupt or incompatible save is ignored (logged to the console) rather than breaking the game; a save from before M6 (no monster data at all) upgrades in place instead of being discarded.

The same top-left corner also has a "Glow: on/off" toggle for the soft bloom+vignette post-effect on the world/shelf/file cameras — on by default (off automatically if your platform requests reduced motion, or if WebGL isn't available), persisted separately from any one world's save.

## License

MIT — see [LICENSE](LICENSE).
