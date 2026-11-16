# @cabn/converter

Turns a directory or zipfile into a validated [cabn](https://github.com/SebastianFrazier26/cabn) world bundle: a directory walk with ignores/caps, file classification, a deterministic radial layout, cluster/annex splitting, a minisearch index, and error annotation into monster spawns.

## Install

```sh
npm install @cabn/converter
```

## Usage

```ts
import { convert, DirSource } from "@cabn/converter";

const bundle = await convert(new DirSource("./my-project"), {
	name: "my-project",
	source: "./my-project",
});
// bundle: Map<string, Uint8Array | string> — "world.json", "chunks/<id>.json", "search-index.json", "assets.json"
```

A browser-safe entry point (`@cabn/converter/browser`) exports everything except `DirSource`, which is the only export that touches `node:*` — use `ZipSource` there instead.

## Portal previews and `cabn.json`

Every portal gets a `richPreview` by default: the first lines of a code/config/text file (with a language id for syntax colouring), a structured breakdown of a markdown file's headings/paragraphs/lists/fenced code, a copied-in image (with best-effort pixel dimensions sniffed from the file header — see `imageDimensions.ts`), or `{ kind: "sealed" }` for anything binary.

A `cabn.json` at the source root overrides specific files' previews (image/markdown/text/url) and declares which `https://` origins a url preview may point at. It's read the same way from both `DirSource` and `ZipSource`, validated with `@cabn/world-schema`'s `validateCabnConfig`, and never itself becomes a portal. Overridden image/markdown sources are capped at the same per-file byte limit (`maxFileBytes`) as every other file in the conversion, and any path that doesn't resolve to a real, in-bounds source entry — including a deliberate `../` escape attempt — is a converter error, not a silent skip.

`ConvertOptions.config` injects a `cabn.json` kept outside the source, for example a portfolio's per-project config. **The injected config owns the allowlist and the showcase:**

- The effective `allowedEmbedOrigins` is the injected list, or empty if the host sets none. The repo's list never widens it, so a repo url preview whose origin the host didn't allow fails the build.
- `world` and `sites` come only from the injected config. A repo's own are dropped, with an `onWarning`.
- Every other key (previews, media, guide, annotate, embedCheck, history) merges one top-level key at a time, the injected value replacing the repo's wholesale.

The repo's `cabn.json` must still be valid on its own (the same errors as without injection), and the merged result is validated again as a whole. Paths inside the injected config still name files in the source. Without injection nothing changes.

The world's display name (`meta.name`) is, first that is set: `nameOverride` (the host's explicit name), then `world.title` (the injected config's under injection), then `name`. `buildShelf` uses that same name, so `world.json` and `shelf.json` agree. `meta.source` never holds an absolute path: `convert()` cuts one to its last segment (`safeSource`).

`cabn.json` `sites` become url portals (`@cabn-site/<id>`) at the front of the root cluster. They have no file behind them, so they never count toward `meta.fileCount`, never get a chunk entry or search doc, and never spawn monsters. They go through the same build-time framability check as url previews. A real file at `@cabn-site/<id>` is an error, not a collision. When one site is the `hero`, the root clearing is sized so the hero's arch fits between the bonfire and the arch ring. Every bundle also carries `showcase.json` (world info plus which site is the hero), and `buildShelf` copies that info into shelf entries. Shelf `order` sorts the entries (lowest first, then by name, unordered worlds last). With no `order` anywhere, input order is kept.

**No image downscaling here on purpose:** this package must stay pure TypeScript and browser-safe (it ships a `./browser` entry point with no Node dependency), so image previews copy the original bytes rather than a resized thumbnail — resizing needs a native decoder like `sharp`, which belongs in a CLI/build-time step (see `tools/asset-pipeline`, which already depends on `sharp` for the game's own art), not in the converter itself.

## License

MIT — see [LICENSE](LICENSE).
