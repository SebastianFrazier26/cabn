# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect), M3 (walkable engine + demo), and the world-hierarchy redesign (shelf hub, per-world theming, bonfire spawn, in-arch previews) have landed; `FileScene`, search, and monsters are still ahead (M4+).

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index); `buildShelf()`: many worlds -> a shelf manifest |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world/shelf scenes, a zustand+mitt React bridge (`CabnGame`, `FileOverlay`), walkable world with lazy chunk loading, in-arch portal previews, and a shelf hub listing every converted world |
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

First run converts `apps/demo/sample-project/` and `apps/demo/notes-vault/` into two world bundles (`apps/demo/public/worlds/{sample,notes}/`), writes a `shelf.json` listing both, and copies sprites into `apps/demo/public/assets/` — all gitignored, regenerated on demand (`pnpm -F @cabn/demo build:world`, or add `-- --force` to rebuild worlds that already exist). Then open the printed local URL: you land on the shelf (a wizard tower with one cabin per world); walk around with WASD/arrow keys, walk into a cabin and press E to enter that world. Inside a world, walk into a portal arch and press E/Enter to open the file (preview shows in the arch opening as you approach); Esc closes a file, or — standing near the bonfire at spawn — returns you to the shelf.

## License

MIT — see [LICENSE](LICENSE).
