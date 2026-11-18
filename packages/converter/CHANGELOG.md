# @cabn/converter

## 0.3.0

### Minor Changes

- ad0750a: Clearings sit much closer to their parents. The layout used to put every depth on one shared ring sized by the whole tree's leaf width and its biggest clearing, which left empty stretches of thousands of pixels between rings in big worlds. Each subtree now owns an angular wedge sized by what actually sits inside it, and each clearing sits as close to its parent as its wedge allows. Positions change, so worlds need rebuilding.

## 0.2.0

### Minor Changes

- 7a6dd0d: Showcase worlds for a portfolio shelf. cabn.json gains optional `world` (title, description, links, order) and `sites` (file-less web portals, at most one hero), shipped in a new `showcase.json` sidecar. A host can inject a cabn.json from outside the source (`ConvertOptions.config`, `cabn build --config`). The injected config owns the embed allowlist and the showcase (fail closed), and the repo's own `allowedEmbedOrigins`, `world` and `sites` are not used. `cabn build --name` and `cabn shelf --name` set display names. `--name` beats `world.title`, which beats the basename, and world.json and shelf.json agree. `convert()` never writes an absolute `meta.source`. Shelf entries carry description/links/heroUrl/order. The engine places the hero site's arch beside the spawn bonfire with a glow and shows a showcase card on cabin approach. `CabnGame` gains `assetBaseUrl` and `pets` props. `collectEmbedOrigins` and `collectWorldEmbedOrigins` give a host its CSP frame-src union and fail closed on non-origins. New shelf.json fields need @cabn/engine ≥ 0.2.0.

### Patch Changes

- 7a6dd0d: Raise the `zod` dependency floor to ^4.6.7, past GHSA-mrhx-c7xc-m3w5 (memory exhaustion while validating oversized constrained collections).
- Updated dependencies [7a6dd0d]
- Updated dependencies [7a6dd0d]
  - @cabn/world-schema@0.2.0

## 0.1.0

### Minor Changes

- First publishable release: world data model, the directory/zip -> world converter, the Phaser + React game engine, and the `cabn` CLI (build/inspect/shelf/serve).

### Patch Changes

- Updated dependencies
  - @cabn/world-schema@0.1.0
