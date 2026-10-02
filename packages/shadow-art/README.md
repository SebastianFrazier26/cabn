# @cabn/shadow-art

The shadow realm's art for [cabn](https://github.com/SebastianFrazier26/cabn): the nether tiles, lava paths, braziers, redrawn props and scenery, nether-recoloured monsters and crimson HUD icons that `cabn serve --owner` shows when you raise your project's hidden files.

It's an optional add-on to `@cabn/cli` (about 14MB of PNGs that only owner mode ever loads), so a default CLI install leaves it out. Install it beside the CLI:

```sh
npm install -g @cabn/cli @cabn/shadow-art
# or, in a project:
npm install --save-dev @cabn/cli @cabn/shadow-art
```

`cabn serve --owner` finds it automatically. Without it the shadow realm still works with a tint-only look, and serve prints a one-line hint at startup. The art is never served without `--owner`.

## API

```js
import { shadowAssetsDir } from "@cabn/shadow-art";
// absolute path of the directory holding the PNGs
```

## License

MIT — see [LICENSE](LICENSE).
