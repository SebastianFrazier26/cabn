# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews), M4 (`FileScene`, enchanted markdown, the tool hotbar and orb search), M5 (the quill editor, bag paste, and save persistence), and M6 (annotators, monster species, and fix-to-defeat battles) have landed.

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index, error annotation -> monsters); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf/file scenes, a zustand+mitt React bridge (`CabnGame` and its HUD: `ToolHotbar`, `SpyglassPanel`, `OrbSearch`, `BagTray`, `EditorOverlay`, `SettingsCorner`, `FileOverlay`, `MonsterCounter`, `EncounterBanner`), walkable world with lazy chunk loading, in-arch portal previews, a shelf hub listing every converted world, a walkable parchment-scroll file view with enchanted markdown, a CodeMirror-backed quill editor with bag paste, monster sprites (hovering near portals/paths in the world, standing beside their line in a file) with a walk-into-and-`E` fix-to-defeat battle loop, and localStorage-backed save persistence (file edits, player position, visited clusters, bag slots, defeated monsters) |
| `packages/cli` | `@cabn/cli` | `cabn build <dir\|zipfile>`, `cabn inspect <bundleDir>`, and `cabn shelf <bundleDir...>` |
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

Inside a world, a portal arch shows a live preview in its opening as you approach. A file opens as a walkable parchment scroll (line-numbered, camera follows you down it); markdown files render "enchanted" — gold glowing headings, tinted bold/italic, pale-blue underlined links, boxed code spans, and leaf-dot list bullets.

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

## License

MIT — see [LICENSE](LICENSE).
