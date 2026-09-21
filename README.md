# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. M1 (world schema, converter, CLI build/inspect) and M3 (walkable engine + demo) have landed; `FileScene`, search, and monsters are still ahead (M4+).

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | Zod schemas + types for the world bundle (`world.json`, chunks, search index, assets), plus `validateManifest` |
| `packages/converter` | `@cabn/converter` | `convert()`: directory/zipfile -> validated world bundle (walk, classify, layout, cluster/annex split, search index) |
| `packages/engine` | `@cabn/engine` | Phaser 3 game engine: boot/preload/world scenes, a zustand+mitt React bridge (`CabnGame`, `FileOverlay`), walkable world with lazy chunk loading and portal previews |
| `packages/cli` | `@cabn/cli` | `cabn build <dir\|zipfile>` and `cabn inspect <bundleDir>` |
| `apps/backend` | `@cabn/backend` | Upload/convert API service (Fastify planned) |
| `apps/demo` | `@cabn/demo` | Vite + React demo app — converts `sample-project/` and renders it as a walkable `CabnGame` world |
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

First run converts `apps/demo/sample-project/` into a world bundle (`apps/demo/public/worlds/sample/`) and copies sprites into `apps/demo/public/assets/` — both gitignored, regenerated on demand (`pnpm -F @cabn/demo build:world`, or add `-- --force` to rebuild the world even if one already exists). Then open the printed local URL and walk around with WASD/arrow keys; walk into a portal arch and press E/Enter to open the file, Esc to leave.

## License

MIT — see [LICENSE](LICENSE).
