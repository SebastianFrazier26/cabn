---
"@cabn/world-schema": minor
"@cabn/converter": minor
"@cabn/engine": minor
"@cabn/cli": minor
---

Showcase worlds for a portfolio shelf. cabn.json gains optional `world` (title, description, links, order) and `sites` (file-less web portals, at most one hero), shipped in a new `showcase.json` sidecar. A host can inject a cabn.json from outside the source (`ConvertOptions.config`, `cabn build --config`). The injected config owns the embed allowlist and the showcase (fail closed), and the repo's own `allowedEmbedOrigins`, `world` and `sites` are not used. `cabn build --name` and `cabn shelf --name` set display names. `--name` beats `world.title`, which beats the basename, and world.json and shelf.json agree. `convert()` never writes an absolute `meta.source`. Shelf entries carry description/links/heroUrl/order. The engine places the hero site's arch beside the spawn bonfire with a glow and shows a showcase card on cabin approach. `CabnGame` gains `assetBaseUrl` and `pets` props. `collectEmbedOrigins` and `collectWorldEmbedOrigins` give a host its CSP frame-src union and fail closed on non-origins. New shelf.json fields need @cabn/engine ≥ 0.2.0.
