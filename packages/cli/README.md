# @cabn/cli

The [cabn](https://github.com/SebastianFrazier26/cabn) CLI: convert a directory or zipfile into a world bundle, inspect one, build a shelf listing several, or serve one as a walkable game locally.

## Install

```sh
npm install -g @cabn/cli
# or, without installing:
npx @cabn/cli serve ./my-project
```

## Usage

```sh
cabn build <dir|zipfile>            # convert -> a world bundle on disk
cabn inspect <bundleDir>            # summarize a built bundle
cabn shelf <bundleDir...> [-o dir]  # build a shelf.json listing several worlds
cabn serve <dir> [--allow-exec]     # convert in memory, serve as a walkable game on 127.0.0.1
```

`cabn serve` binds to `127.0.0.1` only. `--allow-exec` turns on **real code execution** of whatever file you run with the wand tool — only use it on code you trust. See the [monorepo README](https://github.com/SebastianFrazier26/cabn#cabn-serve--running-a-file-for-real-locally-only) for the full safety model.

## License

MIT — see [LICENSE](LICENSE).
