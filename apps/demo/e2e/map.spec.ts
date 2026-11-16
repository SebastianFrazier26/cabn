import type { Page } from "@playwright/test";
import type { CabnStore } from "../../../packages/engine/src/bridge/store.js";
import { expect, test } from "./cspGuard";
import { holdKey, scaled, walkToward } from "./helpers";

async function state(page: Page) {
	return page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		return {
			pos: s.playerPos,
			map: s.worldMap,
			open: s.mapOpen,
			mode: s.mode,
			base: s.activeWorldBase,
			search: s.searchOpen,
			visited: s.visitedClusterIds,
		};
	});
}

test("map: movement, modal keys, typing, destinations and shelf lifecycle", async ({
	page,
}, testInfo) => {
	test.setTimeout(scaled(120000));
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas")).toBeVisible();
	await page.waitForTimeout(1500);
	await expect(page.getByTestId("world-minimap")).toHaveCount(0);
	await walkToward(page, { x: 0, y: -480 }, 45);
	await holdKey(page, "Enter");
	await expect(page.getByTestId("world-minimap")).toBeVisible({
		timeout: scaled(20000),
	});
	await page.waitForTimeout(1200);
	const spawn = (await state(page)).pos;
	const marker = page.getByTestId("minimap-player");
	const oldX = await marker.getAttribute("cx");
	await holdKey(page, "ArrowRight", 300);
	expect(await marker.getAttribute("cx")).not.toBe(oldX);
	await page.keyboard.press("m");
	await expect(page.getByRole("dialog", { name: "World map" })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("map-overview.png") });
	const before = (await state(page)).pos;
	await holdKey(page, "ArrowRight", 300);
	expect((await state(page)).pos).toEqual(before);
	await page.keyboard.press("f");
	expect((await state(page)).search).toBe(false);
	await page.keyboard.press("Control+f");
	expect((await state(page)).search).toBe(false);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("world-map")).toHaveCount(0);
	expect((await state(page)).base).not.toBeNull();
	await page.keyboard.press("f");
	const input = page.locator("input").first();
	await expect(input).toBeVisible();
	await input.fill("m");
	await input.press("m");
	expect((await state(page)).open).toBe(false);
	await page.keyboard.press("Escape");
	await page.locator("canvas").click({ position: { x: 600, y: 400 } });
	await page.keyboard.press("m");
	await expect(page.getByTestId("world-map")).toBeVisible();
	const target = (await state(page)).map?.portals[0];
	if (!target) throw new Error("No map portal");
	await page
		.locator(`[data-testid="map-portal"][data-portal-id="${target.id}"]`)
		.click();
	await expect(page.getByTestId("world-map")).toHaveCount(0);
	await expect
		.poll(
			async () => {
				const { pos } = await state(page);
				return Math.hypot(pos.x - target.pos.x, pos.y - target.pos.y);
			},
			{ timeout: scaled(20000) },
		)
		.toBeLessThan(110);
	expect((await state(page)).mode).toBe("world");
	await walkToward(page, spawn, 45);
	await page.keyboard.press("m");
	await expect(page.getByTestId("world-map")).toBeVisible();
	await page.keyboard.press("Enter");
	await page.waitForTimeout(300);
	expect((await state(page)).base).not.toBeNull();
	await expect(page.getByTestId("world-map")).toHaveCount(0);
	await holdKey(page, "Escape");
	await expect(page.getByTestId("world-minimap")).toHaveCount(0);
	expect((await state(page)).map).toBeNull();
	expect((await state(page)).visited).toEqual([]);
	expect(errors).toEqual([]);
});
