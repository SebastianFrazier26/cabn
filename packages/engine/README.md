# @cabn/engine

The [cabn](https://github.com/SebastianFrazier26/cabn) game engine: a Phaser 3 + zustand + mitt walkable renderer for a converted world bundle, plus a React bridge (`CabnGame`) and its HUD components (tool hotbar, spyglass, orb search, bag, quill editor, run parchment, and more).

## Install

```sh
npm install @cabn/engine react react-dom
```

## Usage

```tsx
import { CabnGame } from "@cabn/engine";

function App() {
	return <CabnGame worldUrl="/worlds/my-world/world.json" />;
}
```

Real code execution (`LocalRunProvider`) is not part of the main entry point — it lives behind `@cabn/engine/local-exec`, meant only for a `cabn serve --allow-exec` host page. Every other consumer, including this package's main export, only ever simulates a run (`TraceProvider`).

## License

MIT — see [LICENSE](LICENSE).
