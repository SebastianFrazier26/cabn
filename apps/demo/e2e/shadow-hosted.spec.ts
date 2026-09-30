import { expect, test } from "@playwright/test";
import type { CabnStore } from "../../../packages/engine/src/bridge/store.js";

// The hosted demo is a normal world: no world layers and no owner toolkit
// (so O does nothing), and the shadow realm's routes don't exist on its server.
test("hosted: no owner toolkit, no world layers, and no shadow routes", async ({
	page,
	request,
}) => {
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas")).toBeVisible();
	await expect(page.locator('[data-tool="opener"]')).toBeVisible({
		timeout: 20_000,
	});
	const layers = await page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore.getState().worldLayers.length,
	);
	expect(layers).toBe(0);
	await expect(page.locator('[data-tool="owner"]')).toHaveCount(0);
	await page.keyboard.press("o");
	await page.keyboard.press("h");
	await page.waitForTimeout(300);
	await expect(page.getByTestId("owner-toolkit")).toHaveCount(0);
	const active = await page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore.getState().activeLayerId,
	);
	expect(active).toBeNull();
	const res = await request.get("/owner/shadow/manifest", {
		headers: { accept: "application/json" },
	});
	expect(res.status()).toBe(404);
});
