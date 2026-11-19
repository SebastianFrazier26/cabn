import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { expect, test } from "./cspGuard";
import { getStoreState } from "./helpers";

// Palette check on the shelf's canvas at day and night. smoke.spec's variance
// check only proves something drew; this one catches a world rendered in the
// wrong colours or stuck in one time of day. Thresholds sit well outside what
// SwiftShader's software GL varies by (measured 2026-11-18 on the CI runner
// and locally: day mean ~(112,165,80), night ~(27,37,52)), so only a real
// palette change trips them.

const BACKGROUND_RGB = { r: 0x1f, g: 0x2a, b: 0x17 };

interface Frame {
	voidFraction: number;
	mean: { r: number; g: number; b: number };
	luminance: number;
}

function frameStats(png: PNG): Frame {
	let voidPixels = 0;
	let sr = 0;
	let sg = 0;
	let sb = 0;
	const n = png.width * png.height;
	for (let i = 0; i < png.data.length; i += 4) {
		const r = png.data[i] ?? 0;
		const g = png.data[i + 1] ?? 0;
		const b = png.data[i + 2] ?? 0;
		sr += r;
		sg += g;
		sb += b;
		if (
			Math.abs(r - BACKGROUND_RGB.r) +
				Math.abs(g - BACKGROUND_RGB.g) +
				Math.abs(b - BACKGROUND_RGB.b) <
			6
		)
			voidPixels++;
	}
	const mean = { r: sr / n, g: sg / n, b: sb / n };
	return {
		voidFraction: voidPixels / n,
		mean,
		luminance: 0.299 * mean.r + 0.587 * mean.g + 0.114 * mean.b,
	};
}

async function captureAt(page: Page, tod: "day" | "night"): Promise<Frame> {
	await page.evaluate((t) => {
		(
			window as unknown as {
				__cabnStore: {
					getState(): { setTimeOfDayOverride(t: string): void };
				};
			}
		).__cabnStore
			.getState()
			.setTimeOfDayOverride(t);
	}, tod);
	await page.waitForTimeout(2500);
	return frameStats(
		PNG.sync.read(await page.locator("canvas").first().screenshot()),
	);
}

test("shelf renders its day and night palettes, not a void or a stuck time of day", {
	tag: "@core",
}, async ({ page }) => {
	await page.goto("/?e2e=1");
	await page.waitForFunction(
		() => !!(window as unknown as { __cabnStore?: unknown }).__cabnStore,
		null,
		{ timeout: 30_000 },
	);
	await expect(page.locator("canvas").first()).toBeVisible();
	expect(await getStoreState(page)).toBeDefined();

	const day = await captureAt(page, "day");
	expect(day.voidFraction).toBeLessThan(0.05);
	expect(day.luminance).toBeGreaterThan(90);
	expect(day.mean.g).toBeGreaterThan(day.mean.r);
	expect(day.mean.g).toBeGreaterThan(day.mean.b);

	const night = await captureAt(page, "night");
	expect(night.voidFraction).toBeLessThan(0.05);
	expect(night.luminance).toBeLessThan(60);
	expect(night.mean.b).toBeGreaterThan(night.mean.r);
	expect(night.luminance).toBeLessThan(day.luminance / 2);
});
