import { expect, test } from "./cspGuard";
import { enterSampleWorld, WORLD_LOAD_TIMEOUT_MS } from "./helpers";

// Set to write screenshots of the labelled bar and the card (review aid only).
const SHOT_DIR = process.env.CABN_TOOL_SHOT_DIR;

const LABELS: Record<string, string> = {
	opener: "Enter",
	spyglass: "Look",
	orb: "Search",
	bag: "Copy",
	quill: "Edit",
	wand: "Run",
};

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 360, height: 640 },
]) {
	test(`hotbar labels and tool card in world mode: ${viewport.width}px`, async ({
		page,
	}) => {
		test.setTimeout(WORLD_LOAD_TIMEOUT_MS + 60_000);
		await enterSampleWorld(page, { viewport });

		for (const [tool, label] of Object.entries(LABELS)) {
			const slot = page.locator(`[data-tool="${tool}"]`);
			await expect(slot.locator(".cabn-slot-label")).toHaveText(label);
			await expect(slot.locator(".cabn-slot-label")).toBeVisible();
			const box = await slot.boundingBox();
			if (!box) throw new Error(`no box for ${tool}`);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
			// A label wider than its slot is clipped by the slot's overflow.
			const clipped = await slot
				.locator(".cabn-slot-label")
				.evaluate(
					(el) =>
						el.scrollWidth > (el.parentElement as HTMLElement).clientWidth,
				);
			expect(clipped, `${tool} label clipped`).toBe(false);
		}
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <= window.innerWidth &&
					document.body.scrollWidth <= window.innerWidth,
			),
		).toBe(true);

		const card = page.getByTestId("cabn-tool-card");
		await expect(card).toHaveCount(0);
		await page.locator('[data-tool="orb"]').hover();
		await expect(card).toBeVisible();
		await expect(card).toContainText("Crystal orb");
		await expect(card).toContainText("F");
		await expect(card).toContainText("Search the world");
		if (SHOT_DIR)
			await page.screenshot({
				path: `${SHOT_DIR}/world-${viewport.width}.png`,
			});
		await page.mouse.move(viewport.width / 2, 40);
		await expect(card).toHaveCount(0);

		await page.locator('[data-tool="wand"]').focus();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(card).toContainText("Wand");
		await expect(card).toContainText("step by step");
		await expect(page.locator('[data-tool="wand"]')).toHaveAttribute(
			"aria-describedby",
			"cabn-tool-desc-wand",
		);
	});
}
