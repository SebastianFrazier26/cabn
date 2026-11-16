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
cabn serve <dir> [--allow-exec] [--owner]  # convert in memory, serve as a walkable game on 127.0.0.1
```

`cabn build` also takes:

- `--name <name>`: the world's display name. It beats any `cabn.json` `world.title`. Without it, the title (the injected config's when `--config` is given) names the world, else the input's basename. It also names the default output dir and becomes `meta.source`, which never holds an absolute path.
- `--config <file>`: a `cabn.json` kept outside the source. The injected config owns the embed allowlist and the showcase: the repo's `allowedEmbedOrigins`, `world` and `sites` are not used (see `@cabn/converter`'s `ConvertOptions.config`). Its other keys merge over the repo's.

`cabn shelf --name <name>` names the shelf. `runBuild(input, { name, config })` and `runShelf(dirs, { name })` take the same options, and `config` may be a path or a parsed object. `cabn shelf` reads each bundle's `showcase.json` for the entry's description, links, hero url and sort order. `collectWorldEmbedOrigins(bundleDirs, { excludeOrigin })` returns the sorted union of every built world's `allowedEmbedOrigins`, which a host serving those worlds needs in its CSP `frame-src`. Build it from the built worlds, not the `cabn.json` inputs, because injection changes the list. It throws on any entry that isn't an exact https origin. The pure `collectEmbedOrigins` is re-exported too.

A git repository root also gets its recent history (branch universes, tags, GitHub releases, file history); `--no-history` skips it and `--git-dir <path>` reads another git directory. `--offline` skips every network request (the url-preview framing check and the GitHub releases request).

`cabn serve` binds to `127.0.0.1` only. `--allow-exec` turns on **real code execution** of whatever file you run with the wand tool — only use it on code you trust. `--owner` lets the page commit in-game edits and create/switch branches in the real repository (never push or fetch). See the [monorepo README](https://github.com/SebastianFrazier26/cabn#cabn-serve--running-a-file-for-real-locally-only) for the full safety model.

`--owner` also opens the shadow realm (your hidden files). Its nether art is a separate, optional package so the default install stays small; install it beside the CLI for the full look:

```sh
npm install -g @cabn/shadow-art
```

Without it the realm still works, tinted rather than textured, and `cabn serve --owner` says so once at startup.

## License

MIT — see [LICENSE](LICENSE).
