import type { Page } from "@playwright/test";
import { expect, test } from "./cspGuard";

// M9 showcase worlds: the notes world's injected config (notes-showcase.json)
// gives its shelf cabin a description card and its root a hero site portal.
// A fresh visit must see the hero's live page without taking a step.

const HERO = "@cabn-site/home";
const HERO_ORIGIN = "https://example.com";
const STUB_PAGE = `<!doctype html><html><head><title>stub</title></head>
<body style="margin:0;font:16px sans-serif"><h1>hero stub</h1></body></html>`;

interface Snapshot {
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	nearWebPortal: { portalId: string; url: string } | null;
	nearShelfWorld: { id: string; description?: string } | null;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore?: { getState(): Snapshot } }
		).__cabnStore?.getState();
		return s
			? {
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					nearWebPortal: s.nearWebPortal
						? {
								portalId: s.nearWebPortal.portalId,
								url: s.nearWebPortal.url,
							}
						: null,
					nearShelfWorld: s.nearShelfWorld
						? {
								id: s.nearShelfWorld.id,
								description: s.nearShelfWorld.description,
							}
						: null,
				}
			: undefined;
	});
}

async function walkToward(
	page: Page,
	target: { x: number; y: number },
	within: number,
) {
	const deadline = Date.now() + 25_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(120);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

test("showcase: cabin card on approach, hero site live at spawn", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.route(`${HERO_ORIGIN}/**`, (route) =>
		route.fulfill({ contentType: "text/html", body: STUB_PAGE }),
	);

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);

	// The sample world (north) has no showcase info: no card.
	await walkToward(page, { x: 0, y: -380 }, 40);
	expect((await state(page))?.nearShelfWorld?.id).toBe("sample-project");
	await expect(page.getByTestId("shelf-world-card")).toHaveCount(0);

	// The notes world (south) does.
	await walkToward(page, { x: 0, y: 380 }, 40);
	await expect
		.poll(async () => (await state(page))?.nearShelfWorld?.id ?? null)
		.toBe("notes-vault");
	await expect(page.getByTestId("shelf-world-description")).toContainText(
		"markdown notes vault",
	);
	await expect(
		page.getByRole("button", { name: "cabn on GitHub ↗" }),
	).toBeVisible();

	await walkToward(page, { x: 0, y: 480 }, 50);
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase ?? null, {
			timeout: 15_000,
		})
		.toBe("/worlds/notes/");
	await expect(page.getByTestId("shelf-world-card")).toHaveCount(0);

	// No movement: the hero's live page is already up.
	await expect
		.poll(async () => (await state(page))?.nearWebPortal?.portalId ?? null, {
			timeout: 10_000,
		})
		.toBe(HERO);
	expect((await state(page))?.nearWebPortal?.url).toBe(`${HERO_ORIGIN}/`);
	await expect(page.locator(`iframe[src^="${HERO_ORIGIN}"]`)).toHaveCount(1, {
		timeout: 10_000,
	});

	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
