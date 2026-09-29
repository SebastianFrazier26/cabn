import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

// Regression coverage for the M10 perf fix that shrank the ground-field
// bake area from a flat viewport-based margin to exactly half the viewport
// (render/worldBounds.ts) — the invariant it must never break is the one
// WorldScene.ts's own computeWorldBounds doc calls out: the camera must
// never be able to scroll to a position that shows unbaked ground. Phaser
// never lets the camera's view rectangle scroll outside `camera.setBounds()`,
// so the four corners of that rectangle (read back live via
// `camera.getBounds()`, not recomputed independently) are the worst case —
// if any one of them shows the raw scene background colour instead of baked
// grass, some reachable camera position has a void in it.

interface CabnStoreSnapshot {
	mode: string;
	playerPos: { x: number; y: number };
	activeWorldBase: string | null;
}

function state(page: Page): Promise<CabnStoreSnapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as { __cabnStore?: { getState(): CabnStoreSnapshot } }
		).__cabnStore;
		return store?.getState();
	});
}

async function holdKey(page: Page, key: string, ms = 150): Promise<void> {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
}

async function walkToward(
	page: Page,
	target: { x: number; y: number },
	within: number,
): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const key of keys) await page.keyboard.down(key);
		await page.waitForTimeout(150);
		for (const key of keys) await page.keyboard.up(key);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

// game.ts's Phaser.Game `backgroundColor` — the one colour that can only
// ever mean "nothing was drawn here", never a real ground/decal pixel.
const BACKGROUND_RGB = { r: 0x1f, g: 0x2a, b: 0x17 };
const VOID_COLOR_DISTANCE = 30;

function colorDistance(r: number, g: number, b: number): number {
	return Math.hypot(
		r - BACKGROUND_RGB.r,
		g - BACKGROUND_RGB.g,
		b - BACKGROUND_RGB.b,
	);
}

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Reads the scene's *actual* runtime camera bounds (not a value recomputed independently by the test) and turns each of its four corners into the camera scroll position that puts that corner at the matching screen corner. */
async function cornerScrollPositions(
	page: Page,
	sceneKey: string,
): Promise<Record<Corner, { x: number; y: number }>> {
	return page.evaluate((key) => {
		const game = (
			window as unknown as {
				__cabnGame: {
					scale: { width: number; height: number };
					scene: {
						getScene(k: string): {
							cameras: {
								main: {
									stopFollow(): void;
									getBounds(): {
										x: number;
										y: number;
										width: number;
										height: number;
									};
								};
							};
						};
					};
				};
			}
		).__cabnGame;
		const scene = game.scene.getScene(key);
		const cam = scene.cameras.main;
		cam.stopFollow();
		const b = cam.getBounds();
		const vw = game.scale.width;
		const vh = game.scale.height;
		return {
			topLeft: { x: b.x, y: b.y },
			topRight: { x: b.x + b.width - vw, y: b.y },
			bottomLeft: { x: b.x, y: b.y + b.height - vh },
			bottomRight: { x: b.x + b.width - vw, y: b.y + b.height - vh },
		};
	}, sceneKey);
}

async function scrollCameraTo(
	page: Page,
	sceneKey: string,
	pos: { x: number; y: number },
): Promise<void> {
	await page.evaluate(
		({ key, pos }) => {
			const game = (
				window as unknown as {
					__cabnGame: {
						scene: {
							getScene(k: string): {
								cameras: { main: { setScroll(x: number, y: number): void } };
							};
						};
					};
				}
			).__cabnGame;
			game.scene.getScene(key).cameras.main.setScroll(pos.x, pos.y);
		},
		{ key: sceneKey, pos },
	);
	// Camera scroll takes effect on the next render pass, not synchronously.
	await page.waitForTimeout(100);
}

/** True if a `size`x`size` block inset from the given screen corner is entirely (within VOID_COLOR_DISTANCE) the raw background colour — one stray light/decal pixel shouldn't hide a real void, so every sampled pixel must match, not just one. */
function cornerIsVoid(png: PNG, corner: Corner, size = 10, inset = 4): boolean {
	const xs =
		corner === "topLeft" || corner === "bottomLeft"
			? range(inset, inset + size)
			: range(png.width - inset - size, png.width - inset);
	const ys =
		corner === "topLeft" || corner === "topRight"
			? range(inset, inset + size)
			: range(png.height - inset - size, png.height - inset);
	for (const y of ys) {
		for (const x of xs) {
			const idx = (png.width * y + x) * 4;
			const r = png.data[idx] ?? 0;
			const g = png.data[idx + 1] ?? 0;
			const b = png.data[idx + 2] ?? 0;
			if (colorDistance(r, g, b) > VOID_COLOR_DISTANCE) return false;
		}
	}
	return true;
}

function range(start: number, end: number): number[] {
	return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

async function assertNoVoidAtAnyCorner(
	page: Page,
	sceneKey: string,
): Promise<void> {
	const corners = await cornerScrollPositions(page, sceneKey);
	for (const [name, pos] of Object.entries(corners) as [
		Corner,
		{ x: number; y: number },
	][]) {
		await scrollCameraTo(page, sceneKey, pos);
		const screenshot = await page.locator("canvas").first().screenshot();
		const png = PNG.sync.read(screenshot);
		expect(
			cornerIsVoid(png, name),
			`${sceneKey} scene: ${name} corner (scroll ${pos.x},${pos.y}) shows unbaked void`,
		).toBe(false);
	}
}

async function setDay(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Day" }).click();
	await page.waitForTimeout(500);
}

async function runCheckAtViewport(
	page: Page,
	viewport: { width: number; height: number },
): Promise<void> {
	await page.setViewportSize(viewport);
	await page.goto("/?e2e=1");
	await page.locator("canvas").first().waitFor({ state: "visible" });
	await page.waitForTimeout(1500);
	await setDay(page);

	await assertNoVoidAtAnyCorner(page, "shelf");

	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase ?? null, {
			timeout: 10_000,
		})
		.not.toBeNull();
	await page.waitForTimeout(500);
	await setDay(page);

	await assertNoVoidAtAnyCorner(page, "world");
}

test("no unbaked void at any reachable camera corner — 1280x720", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await runCheckAtViewport(page, { width: 1280, height: 720 });
});

test("no unbaked void at any reachable camera corner — 1920x1200", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await runCheckAtViewport(page, { width: 1920, height: 1200 });
});
