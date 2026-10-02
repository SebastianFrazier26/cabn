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

## License

MIT — see [LICENSE](LICENSE).
