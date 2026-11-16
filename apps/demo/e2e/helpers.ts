import type { Page } from "@playwright/test";
import { expect } from "./cspGuard";

export { scaled, TIME_SCALE } from "./timeScale";

import { scaled } from "./timeScale";

export interface CabnStoreSnapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	monsters: { species: string }[];
}

// window.__cabnStore only exists when the page is loaded with ?e2e=1 — see
// apps/demo/src/App.tsx's exposeTestHookIfRequested.
export function getStoreState(
	page: Page,
): Promise<CabnStoreSnapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: { getState(): CabnStoreSnapshot };
			}
		).__cabnStore;
		return store?.getState();
	});
}

export async function holdKeys(
	page: Page,
	keys: string[],
	ms: number,
): Promise<void> {
	for (const k of keys) await page.keyboard.down(k);
	await page.waitForTimeout(ms);
	for (const k of keys) await page.keyboard.up(k);
}

/**
 * Steers toward `target` in short key-bursts, re-reading position after each
 * and re-choosing which arrow keys to hold. Movement speed is constant (see
 * playerController.ts — no deceleration), so one fixed diagonal held for the
 * whole walk overshoots the axis that arrives first. Keys stay held across
 * polls and only change when the needed direction does: releasing every burst
 * threw away frames on slow runners where a burst spans a couple of updates.
 */
export async function walkToward(
	page: Page,
	target: { x: number; y: number },
	withinPx: number,
	options: { maxMs?: number; burstMs?: number } = {},
): Promise<void> {
	const maxMs = scaled(options.maxMs ?? 60_000);
	const burstMs = options.burstMs ?? 100;
	const deadline = Date.now() + maxMs;
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

/** Loads the shelf and walks into the sample-project cabin; resolves once its world is active. */
export async function enterSampleWorld(
	page: Page,
	options: { settleMs?: number } = {},
): Promise<void> {
	const settleMs = options.settleMs ?? 1500;
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await getStoreState(page))?.activeWorldBase, {
			timeout: scaled(10_000),
		})
		.not.toBeNull();
	await page.waitForTimeout(settleMs);
}

/**
 * Walks by clicking the ground toward `target` in canvas-sized hops, waiting
 * for the player to stop between clicks. Unlike walkToward this lets the
 * game's own click-walker steer and stop on arrival (it never overshoots), so
 * it still works when software GL renders ~5fps and a held key keeps carrying
 * the player past the target for several polls before the test can react.
 * The camera follows the player, so the canvas centre is (about) the player.
 */
export async function clickWalkToward(
	page: Page,
	target: { x: number; y: number },
	withinPx: number,
	options: { maxMs?: number } = {},
): Promise<void> {
	const maxMs = scaled(options.maxMs ?? 60_000);
	const deadline = Date.now() + maxMs;
	const canvas = page.locator("canvas").first();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("canvas has no bounding box");
	const reach = Math.min(box.width, box.height) / 2 - 80;

	let last: { x: number; y: number } | undefined;
	while (Date.now() < deadline) {
		const pos = (await getStoreState(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		const dist = Math.hypot(dx, dy);
		if (dist <= withinPx) return;
		const moving =
			last !== undefined && Math.hypot(pos.x - last.x, pos.y - last.y) > 1;
		last = pos;
		if (moving) {
			await page.waitForTimeout(500);
			continue;
		}
		const k = dist > reach ? reach / dist : 1;
		await page.mouse.click(
			box.x + box.width / 2 + dx * k,
			box.y + box.height / 2 + dy * k,
		);
		await page.waitForTimeout(500);
	}
	throw new Error(
		`clickWalkToward: did not reach (${target.x}, ${target.y}) within ${maxMs}ms`,
	);
}
