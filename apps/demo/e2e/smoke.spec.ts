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
	// (480px) due "up" (angle -PI/2) from the player's (0,0) spawn point,
	// player speed is 220px/s — see packages/engine/src/scenes/ShelfScene.ts.
	// Walking up for ~2.2s comfortably closes the distance to within
	// CABIN_ENTER_RADIUS (70px) without needing to read pixel positions back
	// out of the page.
	await page.keyboard.down("ArrowUp");
	await page.waitForTimeout(2200);
	await page.keyboard.up("ArrowUp");
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
