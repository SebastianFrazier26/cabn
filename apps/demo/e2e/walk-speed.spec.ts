import { expect, test } from "./cspGuard";
import {
	getStoreState,
	scaled,
	WORLD_LOAD_TIMEOUT_MS,
	waitUntilStill,
} from "./helpers";

// Nominal walk speed (playerController.ts), px/s.
const NOMINAL_PX_PER_S = 220;

// The floor is the whole point. Before systems/frameTiming.ts, walking was
// frame-bound: CI's software GL renders ~5fps and measured ~14.5 px/s with a
// held key. This is the only @core test that reads real speed on that runner,
// so it is what proves the fix there. 150 leaves room for the 10-frame delta
// smoothing ramp and a slow runner's jitter, yet is ten times the broken
// figure. The ceiling only catches a unit error or double-stepping.
const MIN_PX_PER_S = 150;
const MAX_PX_PER_S = 300;

const WINDOW_MS = 3_000;
// Straight down from the shelf spawn is clear for ~975px (east/west stop at
// the world edge after ~700px, which a 3s walk nearly reaches), so the walk
// is capped well inside that.
const MAX_TRAVEL_PX = 800;

test("holding a key walks near the nominal speed whatever the frame rate", {
	tag: "@core",
}, async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await expect
		.poll(async () => (await getStoreState(page))?.playerPos, {
			timeout: WORLD_LOAD_TIMEOUT_MS,
		})
		.toBeDefined();
	// Phaser smooths each delta over the last 10 frames, so a slow runner needs
	// seconds before a measurement reflects the real frame time.
	await page.waitForTimeout(scaled(3_000));
	await waitUntilStill(page);

	await page.evaluate(() => {
		const w = window as unknown as { __rafFrames: number };
		w.__rafFrames = 0;
		const tick = () => {
			w.__rafFrames++;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	await page.keyboard.down("ArrowDown");
	// Timed inside the page: Playwright round-trips stretch to seconds on a
	// frame-starved runner and would skew a wall-clock window taken outside.
	// The window opens at the first observed movement, so key-down latency
	// (a whole frame at 5fps) is not counted against the speed.
	const run = await page.evaluate(
		({ windowMs, maxTravel }) =>
			new Promise<{
				seconds: number;
				distance: number;
				rafFps: number;
				phaserFps: number;
			}>((resolve) => {
				const w = window as unknown as {
					__rafFrames: number;
					__cabnGame: { loop: { actualFps: number } };
					__cabnStore: {
						getState(): { playerPos: { x: number; y: number } };
					};
				};
				const idle = w.__cabnStore.getState().playerPos;
				let start = idle;
				let t0 = 0;
				let frames0 = 0;
				const timer = setInterval(() => {
					const pos = w.__cabnStore.getState().playerPos;
					const now = performance.now();
					if (t0 === 0) {
						if (pos.x !== idle.x || pos.y !== idle.y) {
							start = pos;
							t0 = now;
							frames0 = w.__rafFrames;
						}
						return;
					}
					const moved = Math.hypot(pos.x - start.x, pos.y - start.y);
					if (now - t0 >= windowMs || moved >= maxTravel) {
						clearInterval(timer);
						const seconds = (now - t0) / 1000;
						resolve({
							seconds,
							distance: moved,
							rafFps: (w.__rafFrames - frames0) / seconds,
							phaserFps: w.__cabnGame.loop.actualFps,
						});
					}
				}, 16);
			}),
		{ windowMs: WINDOW_MS, maxTravel: MAX_TRAVEL_PX },
	);
	await page.keyboard.up("ArrowDown");

	const speed = run.distance / run.seconds;
	const summary = `walk speed ${speed.toFixed(1)} px/s over ${run.seconds.toFixed(2)}s (nominal ${NOMINAL_PX_PER_S}), fps raf ${run.rafFps.toFixed(1)} / phaser ${run.phaserFps.toFixed(1)}`;
	console.log(summary);
	test.info().annotations.push({ type: "walk-speed", description: summary });

	expect(speed, summary).toBeGreaterThanOrEqual(MIN_PX_PER_S);
	expect(speed, summary).toBeLessThanOrEqual(MAX_PX_PER_S);
});
