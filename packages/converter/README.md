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

**No image downscaling here on purpose:** this package must stay pure TypeScript and browser-safe (it ships a `./browser` entry point with no Node dependency), so image previews copy the original bytes rather than a resized thumbnail — resizing needs a native decoder like `sharp`, which belongs in a CLI/build-time step (see `tools/asset-pipeline`, which already depends on `sharp` for the game's own art), not in the converter itself.

## License

MIT — see [LICENSE](LICENSE).
