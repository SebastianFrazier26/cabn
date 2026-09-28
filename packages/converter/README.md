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

## License

MIT — see [LICENSE](LICENSE).
