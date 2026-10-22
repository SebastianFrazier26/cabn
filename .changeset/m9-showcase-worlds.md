---
"@cabn/world-schema": minor
"@cabn/converter": minor
"@cabn/engine": minor
"@cabn/cli": minor
---

Showcase worlds for a portfolio shelf. cabn.json gains optional `world` (title, description, links, order) and `sites` (file-less web portals, at most one hero), shipped in a new `showcase.json` sidecar. A host can inject a cabn.json from outside the source (`ConvertOptions.config`, `cabn build --config`), and the injected keys win. `cabn build --name` and `cabn shelf --name` set display names. `meta.source` is no longer an absolute path. Shelf entries carry description/links/heroUrl/order. The engine places the hero site's arch beside the spawn bonfire with a glow and shows a showcase card on cabin approach. `CabnGame` gains `assetBaseUrl` and `pets` props. `collectEmbedOrigins` and `collectWorldEmbedOrigins` give a host its CSP frame-src union.
