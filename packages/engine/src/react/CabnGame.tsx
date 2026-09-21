import { useEffect, useRef, useState } from "react";
import {
	type CabnGameHandle,
	type CabnGameTarget,
	createCabnGame,
} from "../game.js";
import { FileOverlay } from "./FileOverlay.js";

// Exactly one of the two: a plain worldUrl boots straight into that world (no
// shelf to return to); shelfUrl boots into the shelf hub, which then boots
// worlds itself as the player walks into cabins (see ShelfScene).
export type CabnGameProps = { worldUrl: string } | { shelfUrl: string };

export function CabnGame(props: CabnGameProps): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	// State, not a ref: FileOverlay needs a re-render once the game (and its
	// store) exists, and mutating a ref alone never schedules one.
	const [handle, setHandle] = useState<CabnGameHandle | null>(null);
	// Destructured to stable primitives, not the `props` object itself, so the
	// effect below re-creates the game exactly when the target url changes —
	// not on every render (props is a fresh object every time).
	const worldUrl = "worldUrl" in props ? props.worldUrl : undefined;
	const shelfUrl = "shelfUrl" in props ? props.shelfUrl : undefined;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const target: CabnGameTarget =
			worldUrl !== undefined ? { worldUrl } : { shelfUrl: shelfUrl as string };
		const next = createCabnGame(container, target);
		setHandle(next);

		return () => {
			next.game.destroy(true);
			setHandle(null);
		};
		// worldUrl/shelfUrl changing is treated as a fresh game, not a hot-swap —
		// Phaser's scene graph doesn't cleanly support re-pointing an already-
		// booted world/shelf at a different bundle mid-flight.
	}, [worldUrl, shelfUrl]);

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
			{handle && <FileOverlay store={handle.store} />}
		</div>
	);
}
