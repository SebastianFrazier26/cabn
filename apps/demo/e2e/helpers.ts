import type { Page } from "@playwright/test";
import { expect } from "./cspGuard";

export { scaled, TIME_SCALE } from "./timeScale";

import { scaled } from "./timeScale";

/** Per-burst overhead beyond the requested hold that marks input as too laggy for key-bursts. */
const HIGH_LATENCY_MS = 400;

/**
 * Budget for a world to go active after Enter. The fetches finish in ~10ms;
 * the wait is WorldScene's synchronous ground-field bake, which on CI's
 * software-GL runner took >25s on a slow day (the 2026-11-17 smoke failures:
 * loading card up, store still null at 20s), so 10s * scale was too tight.
 */
export const WORLD_LOAD_TIMEOUT_MS = scaled(45_000);

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

export function holdKey(page: Page, key: string, ms = 150): Promise<void> {
	return holdKeys(page, [key], ms);
}

/**
 * Steers toward `target` in short key-bursts, re-reading position after each
 * and re-choosing which arrow keys to press. Movement speed is constant (see
 * playerController.ts — no deceleration), so one fixed diagonal held for the
 * whole walk overshoots the axis that arrives first. Keys are released after
 * every burst: holding them across polls lets a frame-starved runner carry
 * the player past the target (or lose the held state when an embed or modal
 * takes focus) and the walk never converges.
 */
export async function walkToward(
	page: Page,
	target: { x: number; y: number },
	withinPx: number,
	options: { maxMs?: number; burstMs?: number } = {},
): Promise<void> {
	const maxMs = scaled(options.maxMs ?? 60_000);
	const maxBurstMs = options.burstMs ?? 100;
	let burstMs = maxBurstMs;
	let lastDist = Number.POSITIVE_INFINITY;
	let laggyBursts = 0;
	let overshoots = 0;
	const deadline = Date.now() + maxMs;

	while (Date.now() < deadline) {
		const pos = (await getStoreState(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		const dist = Math.hypot(dx, dy);
		if (dist <= withinPx) return;
		// A burst that moves the player further than the tolerance window can
		// leap over it forever on a frame-starved runner: shrink on overshoot,
		// grow again when a burst moved nothing (shorter than one frame).
		if (dist > lastDist + 0.5) {
			burstMs = Math.max(30, burstMs / 2);
			overshoots++;
		} else if (Math.abs(dist - lastDist) <= 0.5)
			burstMs = Math.min(maxBurstMs * 2, burstMs * 2);
		lastDist = dist;

		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		const burstStart = Date.now();
		await holdKeys(page, keys, burstMs);
		// Every CDP call costs ~0.5s on the GPU-less CI runner, so a "100ms"
		// burst holds the key ~1.6s and no burst length can stop short of the
		// target. Shrinking the hold can't help; hand over to the game's own
		// click-walker, which stops on arrival. Gated on laggy bursts AND repeated
		// overshoot: a slow burst alone also happens on a healthy machine in a
		// heavy world, where the keyboard walk still converges (git.spec rift).
		laggyBursts =
			Date.now() - burstStart - burstMs > HIGH_LATENCY_MS ? laggyBursts + 1 : 0;
		if (laggyBursts >= 2 && overshoots >= 2) {
			return clickWalkToward(page, target, withinPx, {
				maxMs: options.maxMs ?? 60_000,
			});
		}
	}

	throw new Error(
		`walkToward: did not reach (${target.x}, ${target.y}) within ${maxMs}ms`,
	);
}

/** Loads the shelf and walks into the sample-project cabin; resolves once its world is active. */
export async function enterSampleWorld(
	page: Page,
	options: {
		settleMs?: number;
		/** Pass null to keep a viewport the spec already set. */
		viewport?: { width: number; height: number } | null;
	} = {},
): Promise<void> {
	const settleMs = options.settleMs ?? 1500;
	const viewport =
		options.viewport === undefined
			? { width: 1280, height: 800 }
			: options.viewport;
	if (viewport) await page.setViewportSize(viewport);
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await getStoreState(page))?.activeWorldBase, {
			timeout: WORLD_LOAD_TIMEOUT_MS,
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

/** Resolves once the player's position is unchanged across `settleMs`; a fixed sleep can't know how far a slow runner got. */
export async function waitUntilStill(
	page: Page,
	options: { settleMs?: number; maxMs?: number } = {},
): Promise<void> {
	const settleMs = options.settleMs ?? 600;
	const deadline = Date.now() + scaled(options.maxMs ?? 30_000);
	let last = (await getStoreState(page))?.playerPos;
	while (Date.now() < deadline) {
		await page.waitForTimeout(settleMs);
		const pos = (await getStoreState(page))?.playerPos;
		if (last && pos && pos.x === last.x && pos.y === last.y) return;
		last = pos;
	}
	throw new Error("waitUntilStill: player kept moving");
}

/**
 * Summons the in-game walk-to-portal tool and resolves with the player's
 * position once it has actually stopped at the arch. `readFocused` supplies
 * the portal id from each spec's own state snapshot (the field name differs
 * per spec); the 20s wait covers the summoned walk, which is frame-bound.
 */
export async function walkToPortal(
	page: Page,
	portalId: string,
	readFocused: () => Promise<string | null | undefined>,
): Promise<{ x: number; y: number }> {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect.poll(readFocused, { timeout: scaled(20_000) }).toBe(portalId);
	await waitUntilStill(page);
	return (await getStoreState(page))?.playerPos ?? { x: 0, y: 0 };
}
