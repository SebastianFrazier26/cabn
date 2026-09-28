import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

// The two bugs mentioned in this milestone's brief (blank world, glow
// pipeline lookup) both only showed up in a real browser — jsdom-based
// component tests never touch WebGL at all. This is the backstop for that
// class of bug: build the production bundle, preview it, and actually look
// at pixels.

interface CabnStoreSnapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
}

// window.__cabnStore only exists when the page is loaded with ?e2e=1 — see
// apps/demo/src/App.tsx's exposeTestHookIfRequested, which is the only place
// this ever gets set on a real (non-test) page load.
function getStoreState(page: Page): Promise<CabnStoreSnapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: { getState(): CabnStoreSnapshot };
			}
		).__cabnStore;
		return store?.getState();
	});
}

/** Downsampled grid of luminance samples across the screenshot — cheap variance check without pulling in a full image-diff library. */
function luminanceSamples(png: PNG, gridSize = 12): number[] {
	const samples: number[] = [];
	for (let gy = 0; gy < gridSize; gy++) {
		for (let gx = 0; gx < gridSize; gx++) {
			const x = Math.floor(((gx + 0.5) / gridSize) * png.width);
			const y = Math.floor(((gy + 0.5) / gridSize) * png.height);
			const idx = (png.width * y + x) * 4;
			const r = png.data[idx] ?? 0;
			const g = png.data[idx + 1] ?? 0;
			const b = png.data[idx + 2] ?? 0;
			samples.push(0.299 * r + 0.587 * g + 0.114 * b);
		}
	}
	return samples;
}

function variance(values: number[]): number {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/**
 * Steers toward `target` in short key-bursts, re-reading position and
 * re-choosing which arrow keys to hold after each burst, rather than picking
 * a direction once and holding it for the whole walk. Movement speed doesn't
 * slow down near the target (see playerController.ts — it's a constant-speed
 * walk, not a seek-and-decelerate), so a single fixed diagonal held the
 * whole time overshoots the axis that arrives first and then just keeps
 * going, increasing distance instead of arriving — confirmed manually running
 * this against the shelf spawn, not a hypothetical.
 */
async function walkToward(
	page: Page,
	target: { x: number; y: number },
	withinPx: number,
	options: { maxMs?: number; burstMs?: number } = {},
): Promise<void> {
	// Generous by default: CI's software-GL runner renders the full world at a
	// small fraction of a dev machine's frame rate (2026-09-28: a 20s budget
	// only covered ~60% of the shelf walk there after M10's heavier scene).
	const maxMs = options.maxMs ?? 60_000;
	const burstMs = options.burstMs ?? 100;
	const deadline = Date.now() + maxMs;
	// Keys stay held across polls and only change when the needed direction
	// does — releasing every burst threw away frames on slow runners where a
	// single burst spans only a couple of game updates.
	let held: string[] = [];
	const release = async () => {
		for (const key of held) await page.keyboard.up(key);
		held = [];
	};

	while (Date.now() < deadline) {
		const pos = (await getStoreState(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= withinPx) {
			await release();
			return;
		}

		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const key of held) {
			if (!keys.includes(key)) await page.keyboard.up(key);
		}
		for (const key of keys) {
			if (!held.includes(key)) await page.keyboard.down(key);
		}
		held = keys;
		await page.waitForTimeout(burstMs);
	}

	await release();
	throw new Error(
		`walkToward: did not reach (${target.x}, ${target.y}) within ${maxMs}ms`,
	);
}

test("demo loads, renders a non-blank world, and walking into a cabin loads a world", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));

	await page.goto("/?e2e=1");

	const canvas = page.locator("canvas");
	await expect(canvas).toBeVisible();

	// Boot + first render needs a beat — Phaser's preload/create cycle and the
	// shelf's own asset loads aren't synchronous with page load.
	await page.waitForTimeout(1500);

	const screenshot = await canvas.screenshot();
	const png = PNG.sync.read(screenshot);
	const samples = luminanceSamples(png);
	// A blank/black canvas has ~zero variance across every sampled point; a
	// rendered shelf (tower, cabins, dashed paths, sky) does not. The
	// threshold is generous on purpose — this only needs to catch "nothing
	// rendered," not judge rendering quality.
	expect(variance(samples)).toBeGreaterThan(50);

	const initial = await getStoreState(page);
	expect(initial).toBeDefined();
	expect(initial?.activeWorldBase).toBeNull();

	// ShelfScene places the demo's first world's cabin CABIN_RING_RADIUS
	// (480px) due "up" (angle -PI/2) from the shelf's origin, and E enters
	// within CABIN_ENTER_RADIUS (70px) — see
	// packages/engine/src/scenes/ShelfScene.ts. The player no longer spawns
	// at that same origin (M10b batch 1 fixed "spawns on top of the tower" —
	// it's now offset beside the tower's footprint), so this steers toward
	// the cabin from wherever the store reports the *actual* spawn is,
	// rather than assuming (0,0) and walking straight up — robust to that
	// offset changing again without this test needing to know why. Stops
	// well inside the real CABIN_ENTER_RADIUS (70px, ShelfScene.ts) rather
	// than right at its edge, so a burst's overshoot never lands the player
	// just outside it the instant before E is pressed.
	const CABIN_POS = { x: 0, y: -480 };
	const WALK_STOP_RADIUS = 50;
	await walkToward(page, CABIN_POS, WALK_STOP_RADIUS);
	// Not page.keyboard.press("e") — CDP's down+up pair for a `.press()` can
	// land within a single browser input-processing tick, before the game
	// loop's next update() ever polls the key, and Phaser's JustDown() then
	// never observes it. A real keypress is never this fast; holding it
	// across a frame boundary (confirmed empirically, not documented anywhere)
	// is what makes this reliable under a headless CDP driver.
	await page.keyboard.down("e");
	await page.waitForTimeout(150);
	await page.keyboard.up("e");

	await expect
		.poll(async () => (await getStoreState(page))?.activeWorldBase, {
			timeout: 10_000,
		})
		.not.toBeNull();

	// Allowlist nothing — a real favicon is committed (apps/demo/public/
	// favicon.webp) specifically so this can stay a hard zero rather than
	// carrying a 404 exception.
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
