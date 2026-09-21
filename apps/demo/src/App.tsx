import { CabnGame } from "@cabn/engine";

// build:world (see scripts/build-world.mjs) converts both demo projects and
// writes a shelf.json listing them here, under public/, so it's served as a
// static file by both `vite` (dev) and the production build.
const SHELF_URL = "/worlds/shelf.json";

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
				<CabnGame shelfUrl={SHELF_URL} />
			</div>
		</div>
	);
}
