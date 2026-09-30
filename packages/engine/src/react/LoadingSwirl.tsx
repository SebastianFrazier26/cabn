import { useEffect, useRef } from "react";
import {
	hashSeed,
	LOADING_MOTE_COUNT,
	loadingMote,
} from "../systems/portalFx.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";

// The arches' MYSTIC palette (render/portalFx.ts): the swirl a loading arch shows, drawn for React.
const PALETTE = ["#b27cd6", "#f2b544", "#7fe3f0", "#ff8fb8"];
/** Mote pixels per shape, matching portalFx's atlas: dot, plus, sparkle (2px cells). */
const SHAPES: ReadonlyArray<ReadonlyArray<[number, number]>> = [
	[[0, 0]],
	[
		[0, 0],
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	],
	[
		[0, 0],
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
		[-2, 0],
		[2, 0],
		[0, -2],
		[0, 2],
	],
];

/** The same particle swirl an arch shows while its preview loads (systems/portalFx.ts loadingMote), here on the loading panel. Under reduced motion it draws one still frame. */
export function LoadingSwirl({
	seedKey,
	size = 120,
	testId = "universe-loading-swirl",
}: {
	seedKey: string;
	size?: number;
	testId?: string;
}): React.ReactElement {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const seed = hashSeed(seedKey);
		const reduced = prefersReducedMotion();
		const rect = { x: 0, y: 0, w: size, h: size };
		let frame = 0;
		const draw = (time: number) => {
			ctx.clearRect(0, 0, size, size);
			for (let i = 0; i < LOADING_MOTE_COUNT * 2; i++) {
				const mote = loadingMote(seed, i, time, rect, reduced);
				ctx.globalAlpha = mote.alpha;
				ctx.fillStyle = PALETTE[mote.color % PALETTE.length] as string;
				for (const [dx, dy] of SHAPES[mote.shape] ?? [])
					ctx.fillRect(mote.x + dx * 2 - 1, mote.y + dy * 2 - 1, 2, 2);
			}
			if (!reduced) frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [seedKey, size]);
	return (
		<canvas
			ref={ref}
			width={size}
			height={size}
			data-testid={testId}
			aria-hidden
			style={{ imageRendering: "pixelated", width: size, height: size }}
		/>
	);
}
