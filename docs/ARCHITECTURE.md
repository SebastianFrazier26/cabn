# cabn architecture

A short map of how the pieces fit. Commands and file-level detail are in [`CLAUDE.md`](../CLAUDE.md); player-facing behaviour is in the [README](../README.md) and the [player's guide](USER_GUIDE.md).

## Packages

```
@cabn/world-schema   the data format (zod schemas, types, the .seyn parser)
        ▲
@cabn/converter      folder or zip -> world bundle
        ▲
@cabn/engine         the game: Phaser 3 scenes + React HUD, reads a bundle in the browser
        ▲
@cabn/cli            cabn build / inspect / shelf / serve
        ┆ optional peer
@cabn/shadow-art     the shadow realm's art, for cabn serve --owner only
```

- **`@cabn/world-schema`** defines everything that crosses a boundary: `world.json`, cluster chunks, the search index, the sidecar files, `cabn.json`, shelf manifests and world layers. The converter validates what it writes and the engine validates what it reads, because a bundle is untrusted input to the engine.
- **`@cabn/converter`** walks a source (a folder or a zip), classifies files, lays out clusters, runs the annotators that turn problems into monsters, builds the search index and, for a repository root, writes the git pack. It has three entry points: `.` for Node (including `convertShadow`, the shadow realm's converter), `./browser` for converting a branch into a universe inside the browser, and `./core` for the pieces the engine needs at startup (annotators for re-checking a save, media sniffing, the clearing-fit formula).
- **`@cabn/engine`** is the game. Phaser scenes (`BootScene`, `PreloadScene`, `ShelfScene`, `WorldScene`, `FileScene`) draw and run the world; React components draw the HUD, panels, spellbook and pets. `CabnGame` is the one component a host page renders.
- **`@cabn/cli`** wraps the converter for the command line and runs `cabn serve`, a small Node HTTP server that converts a folder in memory and serves it with a host page. It bundles the sprites a normal world uses in `dist/assets`.
- **`@cabn/shadow-art`** is only the shadow realm's PNGs (about 14MB) and an entry exporting their directory. It's an optional peer of `@cabn/cli`, so a default install leaves it out. With `--owner`, `cabn serve` reads `/assets/shadow/*` from it, else from the monorepo's `assets/generated/shadow/`, else serves none and prints a hint; the realm then keeps its tint-only skin, because `resolveSkin` drops any texture group that fails to load.
- **`apps/backend`** is an authenticated Fastify service that converts uploaded zips. **`apps/demo`** is the hosted demo and the home of the Playwright tests. **`tools/asset-pipeline`** generates every sprite deterministically.

## Bundle compatibility: a strict `world.json` and optional sidecars

`world.json` is parsed with strict schemas by every engine ever shipped, so an unknown field makes an older engine reject the whole world. New data therefore never goes into `world.json`. It goes into an optional sidecar file beside it:

| Sidecar | Holds |
| --- | --- |
| `media.json` | Audio and PDF metadata for media files |
| `embeds.json` | The build-time verdict on whether each web preview can be framed |
| `monsters.json` | The five newer monster species (imp, magpie, skeleton, bramble, shade) |
| `signs.json` | `.seyn` signs |
| `git/`, `git/files.json`, `git/meta.json`, `releases.json` | Git history and GitHub releases |

An older engine never requests a sidecar it doesn't know, so it shows the world without that feature instead of failing. A newer engine treats a missing sidecar as "no data". Because of this, `CABN_VERSION` has stayed at 1. Some sidecars are read entry by entry (`signs.json`, for one), so a bad entry drops only that entry.

## The React ↔ Phaser bridge

Phaser owns the canvas and React owns the DOM on top of it. They talk through two objects created per game in `src/bridge/`:

- **A zustand store** (`store.ts`, vanilla `createStore`) holds state that must survive a render or be read later: the current mode (world, file, editor), the open panels, the focused preview, the time of day, the active world layer, pet state. Scenes write to it and React subscribes with `useCabnStore`.
- **A mitt event bus** (`events.ts`) carries facts that matter only at the moment they happen: `portal:enter`, `portal:web-rect`, `encounter:continue`, `layer:toggle` and so on.

The rule, written at the top of `events.ts`: a value goes in the store or on the bus, never both. Pure logic that both sides need lives in `src/systems/` with no Phaser or React imports, which is where most of the unit tests point.

## Owner mode and its boundaries

Everything that can write to disk or run code is opt-in, local and kept out of the hosted bundle.

- **Server side.** `cabn serve` binds only to `127.0.0.1`. The page itself (`GET /`) is served only for the `?token=` in the URL it prints, compared in constant time; without it, `/` is a plain 404, so another local process can't read the session or owner token out of the page. Assets, `/app.js` and `/world/*` carry no token and stay ungated beyond Host/Origin. Owner routes (`/owner/signs/*`, `/owner/git/*`, `/owner/shadow/*`) exist only with `--owner` and answer 404 otherwise. All of them go through one gate, `packages/cli/src/serve/ownerAuth.ts`: a per-session token written only into the page, an exact loopback `Host`, a same-server `Origin` on writes, JSON bodies validated with zod, and writes confined to the served folder (no traversal, no symlink hops, nothing under `.git`). Git actions never push or fetch. Real code execution (`--allow-exec`) has its own token and the same loopback checks.
- **Client side.** The main engine entry (`@cabn/engine`) contains no owner client and no real execution. The owner sign and git clients and the shadow realm live behind `@cabn/engine/owner`; `LocalRunProvider` lives behind `@cabn/engine/local-exec`. Only `cabn serve`'s host page imports them, and only with the matching flag. `CabnGame` takes an optional `owner` capability (`{ signs, git, layers }`); without it there is no toolkit slot and `O` does nothing.
- **Checks.** `packages/engine/tests/importGraph.test.ts` proves the main entry never reaches `src/shadow/`. The converter's import-graph test proves `./browser` never reaches the shadow converter. The demo's three `postbuild` scripts fail the build if execution or owner code, key-shaped strings, or shadow code, art or hidden paths reach the hosted bundle.
- **Other boundaries.** Hidden files never enter a normal world's portals, chunks or search index; the shadow layer is computed by the serve process on request and never written to the bundle. AI pet keys stay in the browser, and pets never see hidden files. A published world ships its real git history, author emails included, and that `git/` pack does keep hidden files that aren't secret-named (`.gitignore`, `.github/`), exactly as git has them. Left out of the pack, from every commit: secret-named blobs (`DEFAULT_SECRET_PATTERNS` in `walk.ts`, one list for worlds, the shadow realm and history), text blobs in which the leaked-secret detector finds a key, blobs over the cap and ignored folders; their hashes stay in the trees.
- **Where history comes from.** Only a real `<root>/.git` directory, checked with `lstat`: a `.git` symlink or `gitdir:` pointer file (linked worktrees, submodules) could name any repository on the machine, so the world ships no history and the note says why, without absolute paths. `--git-dir` is the explicit opt-in for those layouts; owner git (`ownerGit.ts`) follows the same rule through `openGitRepo`.

## The world-layer seam

The shadow realm is built as a generic *world layer* so the main engine never names it. A layer adds clusters, portals, paths, monsters and signs around a base world without moving anything in it.

- `systems/worldLayer.ts` defines `WorldLayerProvider` (fetches the layer's manifest, chunks and search index, saves files, and lists its toolkit tools), `WorldSkin` (textures, tints, palettes and particle settings a layer may swap in) and `mergeLayer`, which merges a base manifest with a layer delta. `DEFAULT_SKIN` sets every skin field to null, which takes the normal code path.
- `scenes/worldLayerSeam.ts` holds what `WorldScene` does differently while a layer shows: the rise and sink transition, routing layer paths through gaps in the base arch rings, and routing saves to the provider.
- A layer marked `exclusive` hides the base world's portals, monsters and signs while keeping its clearings and paths as a walkable skeleton; base clearings with nothing left to show draw a smaller patch of ground.
- The shadow realm (`src/shadow/`, owner entry only) is one provider plus a nether skin and a crimson HUD palette, plugged in through `owner.layers`. The format is `WorldLayerDeltaSchema` in `@cabn/world-schema`, produced by `convertShadow` in the converter's Node entry.

To add a skinnable thing, add a nullable field to `WorldSkin`, give it `null` in `DEFAULT_SKIN`, and branch on it in the engine; shadow-specific values go in `src/shadow/skin.ts`.
