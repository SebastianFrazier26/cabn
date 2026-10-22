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

## Portal previews and `cabn.json`

`Portal.richPreview` (optional — absent on bundles built before this existed) carries a richer literal preview than `Portal.preview`'s 12-line/120-char compact panel text: syntax-coloured code, structured markdown (headings/paragraphs/lists/code — data, not HTML, so a preview renderer never needs `dangerouslySetInnerHTML`), a copied-in image asset, a short text blurb, a live-embeddable url, or `{ kind: "sealed" }` for binaries.

A world source's `cabn.json` (validated by `validateCabnConfig`) lets its author override any file's default preview:

```json
{
	"cabnConfigVersion": 1,
	"previews": {
		"README.md": { "kind": "image", "src": "assets/logo.png" },
		"docs/api.md": { "kind": "markdown", "src": "docs/api.long.md" },
		"index.html": { "kind": "url", "url": "https://example.com/demo" }
	},
	"allowedEmbedOrigins": ["https://example.com"]
}
```

`allowedEmbedOrigins` must be exact `https://` origins — no path, no wildcard subdomains — and a `url` preview's origin must appear in it, checked both at convert time (`@cabn/converter`) and again at render time by `@cabn/engine`'s `PortalEmbed` (`isAllowedEmbedOrigin`), which never trusts that `cabn.json` was already validated upstream.

`"guide": false` hides the guide NPC (Wren) in that world. The converter copies it into `world.json` as `WorldManifest.guide` only when the author set it, so bundles that don't mention it are unchanged. Left out, the engine shows the guide in the first world of a shelf (the first entry of `shelf.json`'s `worlds`) and in a world booted on its own.

### World info and site portals (`world`, `sites`)

Two optional keys turn a world into a showcase (a portfolio shelf of projects):

```json
{
	"cabnConfigVersion": 1,
	"allowedEmbedOrigins": ["https://demo.example.org"],
	"world": {
		"title": "Climbing risk",
		"description": "Route risk borrowed from characteristically similar climbs.",
		"links": [{ "label": "Repo", "url": "https://github.com/me/climb" }],
		"order": 1
	},
	"sites": [
		{ "id": "app", "title": "Live app", "url": "https://demo.example.org/", "hero": true },
		{ "id": "docs", "title": "Docs", "url": "https://demo.example.org/docs", "fallbackImage": "docs/shot.png" }
	]
}
```

- `world`: `title` (≤200 chars), `description` (≤500), `links` (≤8, `https://` only) and `order` (an integer shelf sort key).
- `sites` (≤8): web portals with no file behind them. Each `url` must be `https://` and its origin listed in `allowedEmbedOrigins`; ids are slugs (`a-z`, `0-9`, `-`); at most one site is the `hero`. `fallbackImage` names an image in the source, shown when the site can't be framed.

Neither key goes into `world.json`. Older engines parse `world.json` strictly, so the converter writes them to a separate, always-present `showcase.json` (`ShowcaseFileSchema`; read it with `parseShowcase`, which never throws). The site portals themselves are ordinary url portals in `world.json` with ids `@cabn-site/<id>` (`sitePortalId`), so any engine renders them.

`shelf.json` entries take the matching optional `description`, `links`, `heroUrl` and `order`. They are written only when set.

`collectEmbedOrigins(configsOrManifests)` returns the sorted union of their `allowedEmbedOrigins`. A host serving several worlds uses it as its CSP `frame-src` list.

## License

MIT — see [LICENSE](LICENSE).
