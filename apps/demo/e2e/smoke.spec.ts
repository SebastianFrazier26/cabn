import { PNG } from "pngjs";
import { expect, test } from "./cspGuard";
import { getStoreState, scaled, walkToward } from "./helpers";

// The two bugs mentioned in this milestone's brief (blank world, glow
// pipeline lookup) both only showed up in a real browser — jsdom-based
// component tests never touch WebGL at all. This is the backstop for that
// class of bug: build the production bundle, preview it, and actually look
// at pixels.

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

test("demo loads, renders a non-blank world, click-to-move works, and walking into a cabin loads a world", {
	tag: "@core",
}, async ({ page }) => {
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
	const spawn = initial?.playerPos ?? { x: 0, y: 0 };

	// Click-to-move: the camera follows the player, so the canvas centre is
	// (about) the player — a click 160px right of it is open ground on the
	// shelf's east side (the tower is west of spawn, the cabins north/south).
	const box = await canvas.boundingBox();
	if (!box) throw new Error("canvas has no bounding box");
	await page.mouse.click(box.x + box.width / 2 + 160, box.y + box.height / 2);
	await expect
		.poll(async () => (await getStoreState(page))?.playerPos.x ?? spawn.x, {
			// Walking speed is frame-bound (see CLAUDE.md, e2e:core);
			// 160px took ~11s at the 5fps CI's software GL manages.
			timeout: scaled(20_000),
		})
		.toBeGreaterThan(spawn.x + 100);

	// A click on a React panel over the canvas must not become a walk command.
	// Wait for the click-walk above to finish first so any movement seen
	// after the panel click could only have come from it.
	await page.waitForTimeout(1200);
	const beforePanelClick = (await getStoreState(page))?.playerPos;
	await page.getByRole("button", { name: "Auto" }).click();
	await page.waitForTimeout(500);
	const afterPanelClick = (await getStoreState(page))?.playerPos;
	expect(afterPanelClick).toEqual(beforePanelClick);

	// ShelfScene places the demo's first world's cabin CABIN_RING_RADIUS
	// (480px) due "up" (angle -PI/2) from the shelf's origin, and Enter enters
	// within CABIN_ENTER_RADIUS (70px) — see
	// packages/engine/src/scenes/ShelfScene.ts. The player no longer spawns
	// at that same origin (M10b batch 1 fixed "spawns on top of the tower" —
	// it's now offset beside the tower's footprint), so this steers toward
	// the cabin from wherever the store reports the *actual* spawn is,
	// rather than assuming (0,0) and walking straight up — robust to that
	// offset changing again without this test needing to know why. Stops
	// well inside the real CABIN_ENTER_RADIUS (70px, ShelfScene.ts) rather
	// than right at its edge, so a burst's overshoot never lands the player
	// just outside it the instant before Enter is pressed.
	const CABIN_POS = { x: 0, y: -480 };
	const WALK_STOP_RADIUS = 50;
	await walkToward(page, CABIN_POS, WALK_STOP_RADIUS);
	// Not page.keyboard.press("Enter") — CDP's down+up pair for a `.press()` can
	// land within a single browser input-processing tick, before the game
	// loop's next update() ever polls the key, and Phaser's JustDown() then
	// never observes it. A real keypress is never this fast; holding it
	// across a frame boundary (confirmed empirically, not documented anywhere)
	// is what makes this reliable under a headless CDP driver.
	await page.keyboard.down("Enter");
	await page.waitForTimeout(500);
	await page.keyboard.up("Enter");

	await expect
		.poll(async () => (await getStoreState(page))?.activeWorldBase, {
			timeout: scaled(10_000),
		})
		.not.toBeNull();

	// The sample world's newer species ship in monsters.json, not world.json;
	// seeing them in the store proves BootScene fetched and merged it.
	await expect
		.poll(
			async () =>
				new Set((await getStoreState(page))?.monsters.map((m) => m.species)),
			{ timeout: scaled(10_000) },
		)
		.toEqual(
			new Set([
				"ghost",
				"rot-sprite",
				"warded-mimic",
				"gremlin",
				"ouroboros",
				"will-o-wisp",
				"imp",
				"magpie",
				"skeleton",
				"bramble",
				"shade",
			]),
		);

	// Allowlist nothing — a real favicon is committed (apps/demo/public/
	// favicon.webp) specifically so this can stay a hard zero rather than
	// carrying a 404 exception.
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
