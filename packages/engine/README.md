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

The same split applies to repository writes: `CabnGame`'s optional `owner` prop takes an `OwnerCapability`, and the HTTP client that implements it (`createOwnerGitClient`) lives behind `@cabn/engine/owner`, imported only by a `cabn serve --owner` host page. Git history (the rift, universe picker, pensieve and map timeline) needs no capability: it reads the bundle's `history.json` and works in any host.

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
