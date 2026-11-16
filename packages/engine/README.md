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

Two optional props cover hosting:

- `assetBaseUrl` (default `"/assets"`): where the host serves cabn's sprite set (`originals/`, `placeholders/`, as copied from `assets/generated`), for example a CDN prefix. It is one setting per page: the last `CabnGame` mounted sets it for all. Changing it re-creates the game.
- `pets` (default `true`): `false` removes the AI pets entirely. No sprite, corner button, setup panel or chat.

`createCabnGame(container, target, { assetBaseUrl, pets })` takes the same options.

A world whose `showcase.json` names a hero site (cabn.json `sites[].hero`) stands that site's arch between the spawn bonfire and the arch ring, with a pulsing gold glow (static under reduced motion). A fresh visit spawns close enough that the site's live page is the first thing in view. On a shelf, walking up to a cabin whose entry has a description, links or a hero url shows them in a card (`ShelfWorldCard`). Up to 8 cabins keep the classic 480px ring, and more widen it so neighbours never overlap.

Real code execution (`LocalRunProvider`) is not part of the main entry point — it lives behind `@cabn/engine/local-exec`, meant only for a `cabn serve --allow-exec` host page. Every other consumer, including this package's main export, only ever simulates a run (`TraceProvider`).

The same split applies to repository writes: `CabnGame`'s optional `owner` prop takes an `OwnerCapability`, and the HTTP client that implements it (`createOwnerGitClient`) lives behind `@cabn/engine/owner`, imported only by a `cabn serve --owner` host page. Git history (the rift, universe picker, pensieve and map timeline) needs no capability: it reads the bundle's read-only `git/` directory with isomorphic-git (a lazy chunk, loaded on first use, with a `Buffer` polyfill) and converts other branches in the browser on demand. A host needs no configuration for it, but a bundler must be able to split dynamic imports for it to stay out of the first load.

## Portal previews

`PortalPreview` renders a portal's `richPreview` payload (code with syntax colours, rendered markdown from structured data, an image, or a text blurb) in the pixel UI style — usable as a small in-world overlay or a larger expanded view. `richPreview` is optional on `Portal` (absent on a bundle built before this feature); `PortalPreview` shows a "sealed" placeholder when it's missing, same as for a binary file.

```tsx
import { PortalPreview } from "@cabn/engine";

<PortalPreview
	preview={portal.richPreview}
	fileName={portal.file.name}
	worldBaseUrl={worldBaseUrl} // the directory world.json was fetched from
	variant="expanded"
/>;
```

`PortalEmbed` renders the live sandboxed iframe for a `richPreview.kind === "url"` override (a `cabn.json` author opted a file into showing a webpage instead of its own content). It re-checks the url's origin against the manifest's `allowedEmbedOrigins` at render time — never trusts that `cabn.json` was already validated at convert time — and falls back to a static title/link card if embedding isn't possible or times out.

```tsx
import { PortalEmbed } from "@cabn/engine";

<PortalEmbed
	url={preview.url}
	title={preview.title}
	fallbackImage={preview.fallbackImage}
	allowedEmbedOrigins={manifest.allowedEmbedOrigins}
	worldBaseUrl={worldBaseUrl}
	active={isApproachedOrOpen}
/>;
```

**Hosting requirement:** a page that renders `PortalEmbed` must set a `Content-Security-Policy` with a `frame-src` directive listing exactly the bundle's `allowedEmbedOrigins` — the iframe `sandbox` attribute alone doesn't stop the *host* page's own CSP from blocking the frame, and CSP is enforced by the browser regardless of what this component does. For example, if `cabn.json` allowlists `https://example.com`:

```
Content-Security-Policy: frame-src https://example.com
```

Do not use a wildcard here — list every allowlisted origin explicitly, same "no wildcards" rule `allowedEmbedOrigins` itself follows (see `@cabn/world-schema`'s `isHttpsOrigin`).

## License

MIT — see [LICENSE](LICENSE).

The `DotGothic16` pixel font is bundled (as a self-hosted, Latin-subset, base64-embedded woff2 — see `src/react/fonts/dotGothic16.ts`) under the SIL Open Font License 1.1: [third-party-licenses/DotGothic16-OFL.txt](third-party-licenses/DotGothic16-OFL.txt).
