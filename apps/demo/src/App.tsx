import { CabnGame } from "@cabn/engine";

// build:world (see scripts/build-world.mjs) writes the converted sample
// project here, under public/, so it's served as a static file by both
// `vite` (dev) and the production build.
const WORLD_URL = "/worlds/sample/world.json";

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
					walk the sample-project world — WASD/arrows to move, E/Enter at a
					portal arch to open a file, Esc to leave
				</span>
			</header>
			<div style={{ flex: 1, minHeight: 0 }}>
				<CabnGame worldUrl={WORLD_URL} />
			</div>
		</div>
	);
}
