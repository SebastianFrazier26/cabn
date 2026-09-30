import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

// M10 stream-bake: with the ground field/cluster ground now baked around the
// camera instead of over the whole world up front (see
// docs/testing/2026-09-29-wide-pass.md Bug 1), the risk that fix introduces
// is pop-in — the streamer's load margin failing to stay ahead of the
// camera at real walking speed. This reuses world-bounds.spec.ts's own
// void-pixel check (same BACKGROUND_RGB, same "screen-edge block must be
// entirely non-void" logic) but samples it *while walking*, continuously,
// rather than only at rest — a margin that's merely wide enough for a
// stationary camera wouldn't catch a streamer that can't keep up on foot.

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

async function holdKeys(page: Page, keys: string[], ms: number): Promise<void> {
	for (const key of keys) await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	for (const key of keys) await page.keyboard.up(key);
}

// game.ts's Phaser.Game backgroundColor — same colour world-bounds.spec.ts
// checks for, but an *exact* match here rather than its distance-30
// tolerance. That tolerance is fine at a literal empty corner with nothing
// else nearby; this test instead walks through a busy world where legitimate
// dark content (e.g. archPreviews.ts's file-preview panels, "#0d0a18", or a
// blended sky/atmosphere edge) can land within 30 of this colour and
// false-positive. An exact match still reliably catches genuine void: it's
// Phaser's literal, unblended per-frame clear colour, and nothing drawn on
// top of it lands on that exact value except by the coincidence a >=20px
// contiguous run below guards against.
const BACKGROUND_RGB = { r: 0x1f, g: 0x2a, b: 0x17 };
const VOID_COLOR_DISTANCE = 0;
/** A single incidentally-exact pixel (e.g. one dark sprite texel) is noise; only a run this long is credibly "nothing was drawn here". */
const MIN_VOID_RUN = 20;

function colorDistance(r: number, g: number, b: number): number {
	return Math.hypot(
		r - BACKGROUND_RGB.r,
		g - BACKGROUND_RGB.g,
		b - BACKGROUND_RGB.b,
	);
}

/** True if any pixel in a screen-edge strip (the side the camera is moving toward, where a lagging streamer would show void first) is void-coloured. */
function edgeHasVoid(
	png: PNG,
	side: "left" | "right" | "top" | "bottom",
	thickness = 12,
): boolean {
	const xs =
		side === "left"
			? range(0, thickness)
			: side === "right"
				? range(png.width - thickness, png.width)
				: range(0, png.width);
	const ys =
		side === "top"
			? range(0, thickness)
			: side === "bottom"
				? range(png.height - thickness, png.height)
				: range(0, png.height);
	let voidPixels = 0;
	for (const y of ys) {
		for (const x of xs) {
			const idx = (png.width * y + x) * 4;
			const r = png.data[idx] ?? 0;
			const g = png.data[idx + 1] ?? 0;
			const b = png.data[idx + 2] ?? 0;
			if (colorDistance(r, g, b) <= VOID_COLOR_DISTANCE) voidPixels++;
		}
	}
	return voidPixels >= MIN_VOID_RUN;
}

function range(start: number, end: number): number[] {
	return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

/**
 * A raw snapshot of just the Phaser canvas's own drawn pixels, via Phaser's
 * renderer (not `page.screenshot`/element `.screenshot()`, both of which
 * capture the *composited* page — the React HUD (toolbar, file-preview
 * docks, the minimap panel) sits on top of the canvas in the DOM and would
 * paint into any edge-strip check, false-positiving on its own dark panel
 * backgrounds long before any real ground/void pixel is involved).
 */
async function snapshotCanvas(page: Page): Promise<PNG> {
	const dataUrl = await page.evaluate(
		() =>
			new Promise<string>((resolve) => {
				const game = (
					window as unknown as {
						__cabnGame: {
							renderer: {
								snapshot: (cb: (image: { src: string }) => void) => void;
							};
						};
					}
				).__cabnGame;
				game.renderer.snapshot((image) => resolve(image.src));
			}),
	);
	const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
	return PNG.sync.read(Buffer.from(base64, "base64"));
}

async function farthestClusterPos(
	page: Page,
): Promise<{ x: number; y: number }> {
	return page.evaluate(async () => {
		const s = (
			window as unknown as {
				__cabnStore: {
					getState(): {
						activeWorldBase: string;
						playerPos: { x: number; y: number };
					};
				};
			}
		).__cabnStore.getState();
		const manifest = await (
			await fetch(`${s.activeWorldBase}world.json`)
		).json();
		const from = s.playerPos;
		let best = manifest.clusters[0].pos;
		let bestDist = -1;
		for (const c of manifest.clusters as { pos: { x: number; y: number } }[]) {
			const d = Math.hypot(c.pos.x - from.x, c.pos.y - from.y);
			if (d > bestDist) {
				bestDist = d;
				best = c.pos;
			}
		}
		return best;
	});
}

async function setDay(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Day" }).click();
	await page.waitForTimeout(500);
}

test("walking to a far corner never shows unbaked ground at the leading screen edge", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/?e2e=1");
	await page.locator("canvas").first().waitFor({ state: "visible" });
	await page.waitForTimeout(1500);
	await setDay(page);

	// Into the world (same cabin the perf harness and world-bounds.spec both
	// use — see apps/demo/scripts/perf-measure.mjs's CABIN_POS.world0).
	const target = { x: 0, y: -480 };
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= 50) break;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		await holdKeys(page, keys, 150);
	}
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await state(page))?.activeWorldBase ?? null, {
			timeout: 10_000,
		})
		.not.toBeNull();
	await page.waitForTimeout(500);
	await setDay(page);

	const corner = await farthestClusterPos(page);

	const deadlineWalk = Date.now() + 30_000;
	let sampled = 0;
	while (Date.now() < deadlineWalk) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = corner.x - pos.x;
		const dy = corner.y - pos.y;
		if (Math.hypot(dx, dy) <= 60) break;
		const keys: string[] = [];
		let side: "left" | "right" | "top" | "bottom" = "right";
		if (Math.abs(dx) >= Math.abs(dy)) {
			keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
			side = dx > 0 ? "right" : "left";
		} else {
			keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
			side = dy > 0 ? "bottom" : "top";
		}
		await holdKeys(page, keys, 200);
		const png = await snapshotCanvas(page);
		expect(
			edgeHasVoid(png, side),
			`unbaked void at the ${side} edge while walking toward (${corner.x}, ${corner.y}), player currently at (${pos.x}, ${pos.y})`,
		).toBe(false);
		sampled++;
	}
	// The walk itself must actually have happened (and been sampled) for this
	// test to mean anything — a world small enough to start already inside
	// the load radius would make every check trivially true.
	expect(sampled).toBeGreaterThan(3);
});
