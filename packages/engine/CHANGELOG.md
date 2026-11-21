# @cabn/engine

## 0.3.1

### Patch Changes

- 88452a6: Smoother walking: streamed ground chunks and the night layer no longer issue one framebuffer capture per tile or per light, which removes the 50-200 ms hitches while walking. Output is unchanged (night differs by at most 5/255 per channel where lights overlap).
- f8d401d: Faster world entry on spread-out worlds: planning the path ribbon (the cobble placement and chunk index) no longer stalls the first frames for about a second. The output is unchanged, stamp for stamp.

## 0.3.0

### Minor Changes

- 63fc264: Every hotbar slot now shows its short label in world mode too (the opener's is now "Enter", not "Use"), and hovering, focusing or tapping a slot shows a card at the top right with the tool's name, key and a one-line description. Tool definitions carry that `description`. The bar shrinks its slots to fit narrow games (down to 360px) and sits above the bug counter below ~960px.

### Patch Changes

- 137a85c: The player walks at the same speed regardless of frame rate. Phaser's time step was replacing any frame slower than 200 ms with a 16.7 ms stand-in, so machines under 5 fps walked in slow motion; frames up to 500 ms now count as real time and the camera follow eases at the same rate at any frame rate.
- 71cd71d: The live page over a url arch no longer loads while the world is still entering, and no longer reloads when you brush past an arch. The first mount waits for world entry plus an idle moment; once mounted it stays until you are well clear of the arch (1.6x the mount radius) for 4 seconds, so turning back keeps the loaded page.
- f9d56a6: Trees no longer look sliced at chunk edges. In larger worlds the lazily planned forest filler was baked only into the 512px chunk that owned each tree, so any part of a tree outside that chunk was clipped by a dead-straight cut. Each chunk now also draws the parts of its neighbours' trees that reach into it.
- f30ea7a: Smoother walking: no more multi-second stalls near large clearings; faster world entry. A big clearing's ground is now baked as 512px tiles that stream in and out like the rest of the world instead of as one texture up to 2752x2784px, streamed chunk textures are recycled through a pool instead of being created and destroyed, the first screen bakes across the loading card's frames instead of in one block, and the unused WebAudio context is no longer created at boot.
- Updated dependencies [ad0750a]
  - @cabn/converter@0.3.0

## 0.2.0

### Minor Changes

- 7a6dd0d: Showcase worlds for a portfolio shelf. cabn.json gains optional `world` (title, description, links, order) and `sites` (file-less web portals, at most one hero), shipped in a new `showcase.json` sidecar. A host can inject a cabn.json from outside the source (`ConvertOptions.config`, `cabn build --config`). The injected config owns the embed allowlist and the showcase (fail closed), and the repo's own `allowedEmbedOrigins`, `world` and `sites` are not used. `cabn build --name` and `cabn shelf --name` set display names. `--name` beats `world.title`, which beats the basename, and world.json and shelf.json agree. `convert()` never writes an absolute `meta.source`. Shelf entries carry description/links/heroUrl/order. The engine places the hero site's arch beside the spawn bonfire with a glow and shows a showcase card on cabin approach. `CabnGame` gains `assetBaseUrl` and `pets` props. `collectEmbedOrigins` and `collectWorldEmbedOrigins` give a host its CSP frame-src union and fail closed on non-origins. New shelf.json fields need @cabn/engine ≥ 0.2.0.

### Patch Changes

- 7a6dd0d: Raise the `zod` dependency floor to ^4.6.7, past GHSA-mrhx-c7xc-m3w5 (memory exhaustion while validating oversized constrained collections).
- Updated dependencies [7a6dd0d]
- Updated dependencies [7a6dd0d]
  - @cabn/world-schema@0.2.0
  - @cabn/converter@0.2.0

## 0.1.0

### Minor Changes

- First publishable release: world data model, the directory/zip -> world converter, the Phaser + React game engine, and the `cabn` CLI (build/inspect/shelf/serve).

### Patch Changes

- Updated dependencies
  - @cabn/world-schema@0.1.0
  - @cabn/converter@0.1.0
