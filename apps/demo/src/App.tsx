import { CabnGame, type CabnGameHandle } from "@cabn/engine";

// build:world (see scripts/build-world.mjs) converts both demo projects and
// writes a shelf.json listing them here, under public/, so it's served as a
// static file by both `vite` (dev) and the production build.
const SHELF_URL = "/worlds/shelf.json";

// Ships in every build (this file's code runs regardless), but only ever
// touches `window` when a page is explicitly loaded with ?e2e=1 — the CI
// browser smoke test's own trigger, never set by a real visitor. A build-time
// MODE check was the other option; this one needs no separate "test" build,
// so `vite preview` of the same production bundle the demo actually ships is
// what the smoke test exercises.
function exposeTestHookIfRequested(handle: CabnGameHandle | null): void {
	if (new URLSearchParams(window.location.search).get("e2e") !== "1") return;
	(window as unknown as { __cabnStore: unknown }).__cabnStore =
		handle?.store ?? undefined;
}

export function App(): React.ReactElement {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				width: "100vw",
				fontFamily: '"Courier New", monospace',
			}}
		>
			<header
				style={{
					padding: "10px 20px",
					background: "#322214",
					color: "#edeee4",
					borderBottom: "3px solid #8c461f",
					display: "flex",
					alignItems: "baseline",
					gap: 12,
				}}
			>
				<h1 style={{ margin: 0, fontSize: 18 }}>cabn</h1>
				<span style={{ opacity: 0.8, fontSize: 13 }}>
					walk the shelf of worlds — WASD/arrows to move, E to enter a cabin or
					a portal arch, Esc to leave a world (at the bonfire) or a file
				</span>
			</header>
			<div style={{ flex: 1, minHeight: 0 }}>
				<CabnGame
					shelfUrl={SHELF_URL}
					onGameReady={exposeTestHookIfRequested}
				/>
			</div>
		</div>
	);
}
