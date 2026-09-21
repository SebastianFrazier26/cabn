import { useEffect, useRef, useState } from "react";
import { type CabnGameHandle, createCabnGame } from "../game.js";
import { FileOverlay } from "./FileOverlay.js";

export interface CabnGameProps {
	worldUrl: string;
}

export function CabnGame({ worldUrl }: CabnGameProps): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	// State, not a ref: FileOverlay needs a re-render once the game (and its
	// store) exists, and mutating a ref alone never schedules one.
	const [handle, setHandle] = useState<CabnGameHandle | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const next = createCabnGame(container, worldUrl);
		setHandle(next);

		return () => {
			next.game.destroy(true);
			setHandle(null);
		};
		// worldUrl changes are treated as a fresh game, not a hot-swap — Phaser's
		// scene graph doesn't cleanly support re-pointing an already-booted
		// world at a different bundle mid-flight.
	}, [worldUrl]);

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
			{handle && <FileOverlay store={handle.store} />}
		</div>
	);
}
