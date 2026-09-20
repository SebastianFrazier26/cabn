# cabn

cabn turns any directory or zipfile into an explorable cottagecore game world — files are portals, directories are world clusters, errors are monsters, and your terminal commands are enchanted tools.

## Status

Under active reboot. The original Rust prototype is parked on the `rust-prototype` branch; this branch rebuilds cabn as a TypeScript pnpm monorepo. Most packages are stubs while the milestones land.

## Monorepo map

| Path | Package | What it is / will be |
| --- | --- | --- |
| `packages/world-schema` | `@cabn/world-schema` | World data model shared by everything else |
| `packages/converter` | `@cabn/converter` | Turns directories/zipfiles into world data |
| `packages/engine` | `@cabn/engine` | Game engine / rendering layer (deps deferred) |
| `packages/cli` | `@cabn/cli` | `cabn` command-line entry point |
| `apps/backend` | `@cabn/backend` | Upload/convert API service (Fastify planned) |
| `apps/demo` | `@cabn/demo` | Hosted demo app |
| `tools/asset-pipeline` | `@cabn/asset-pipeline` | Sprite/asset build tooling |
| `assets/source` | — | Source art (icons, sprites) |

## Quickstart

Requires Node 22 and pnpm (via corepack).

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## License

MIT — see [LICENSE](LICENSE).
