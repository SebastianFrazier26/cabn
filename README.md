# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews), M4 (`FileScene`, enchanted markdown, the tool hotbar and orb search), and M5 (the quill editor, bag paste, and save persistence) have landed; monsters are still ahead (M6+).

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf/file scenes, a zustand+mitt React bridge (`CabnGame` and its HUD: `ToolHotbar`, `SpyglassPanel`, `OrbSearch`, `BagTray`, `EditorOverlay`, `SettingsCorner`, `FileOverlay`), walkable world with lazy chunk loading, in-arch portal previews, a shelf hub listing every converted world, a walkable parchment-scroll file view with enchanted markdown, a CodeMirror-backed quill editor with bag paste, and localStorage-backed save persistence (file edits, player position, visited clusters, bag slots) |
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
- **Enter**: walk into a cabin/portal/file-exit arch and press `E` (or Enter) — same key everywhere: shelf cabin -> world, world portal -> file, file's top arch -> back to the world.
- **Esc**: leave a world at the bonfire (back to the shelf), close a file (back to the world at the portal you entered), or cancel a bag selection in progress.
- **Tool hotbar** (bottom of screen, click a slot or use its hotkey):
  - **Opener** (`E`) — the enter behavior above, also reachable as a tool.
  - **Spyglass** (`L`) — lists the portals in whatever cluster you're standing in (name, kind, size); click one to auto-walk there.
  - **Orb** (`F`, or `Cmd`/`Ctrl`-`F` which also blocks the browser's own find) — fuzzy search the whole world by name/path/content while walking around, or search just the open file's lines while inside one; picking a result auto-walks to it (world) or jumps/highlights the line (file).
  - **Bag** (`B`) — inside a file, starts a line selection at your current line (shift + up/down to extend), and a second `B` grabs it into a bag slot (shown bottom-left, capped at 5).
  - **Quill** (`Q`) — inside a file, opens the editor overlay with the caret on the line nearest you. `Ctrl`/`Cmd`-`S` saves; `Esc` closes (asks first if there are unsaved changes). While it's open, the bag tray's slots become paste buttons (or use `Alt`+`1`-`5`) that insert that slot's text at the cursor.

Inside a world, a portal arch shows a live preview in its opening as you approach. A file opens as a walkable parchment scroll (line-numbered, camera follows you down it); markdown files render "enchanted" — gold glowing headings, tinted bold/italic, pale-blue underlined links, boxed code spans, and leaf-dot list bullets.

### Saving

Edits, your position in the world, which clusters you've visited, and your bag slots persist to `localStorage` per converted world (keyed by its source + conversion time, so reconverting the same source starts a fresh save). An edited file gets a small ✎ marker on its portal arch in the world and in the spyglass panel, which also offers a "reset" action per edited file; a settings button in the top-left corner (hidden while the editor is open) resets everything for the current world. A corrupt or incompatible save is ignored (logged to the console) rather than breaking the game.

## License

MIT — see [LICENSE](LICENSE).
