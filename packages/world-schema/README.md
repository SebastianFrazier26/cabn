# @cabn/world-schema

Zod schemas and inferred types for [cabn](https://github.com/SebastianFrazier26/cabn)'s world bundle format: `world.json` (the manifest), per-cluster chunk files, the minisearch index, and the assets file — plus a `validateManifest` helper and a `validateShelf` helper for the multi-world shelf manifest.

## Install

```sh
npm install @cabn/world-schema
```

## Usage

```ts
import { validateManifest, WorldManifestSchema } from "@cabn/world-schema";

const manifest = validateManifest(JSON.parse(worldJsonText)); // throws WorldManifestValidationError on failure, else a typed WorldManifest
```

Plain JSON Schema exports for every bundle file live under `schema/` for non-TypeScript tooling.

## License

MIT — see [LICENSE](LICENSE).
