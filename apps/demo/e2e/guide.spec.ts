import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// The guide NPC end to end: she stands by the first world's bonfire (and
// not in the second world), a click walks to her and opens the dialogue,
// pages turn, Esc closes, Enter reopens, and the player stays put while the
// box is open. CABN_REVIEW_SHOTS=1 also writes review screenshots to
// assets/generated/review/guide-npc/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"guide-npc",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	guideNpc: { pos: { x: number; y: number }; talked: boolean } | null;
	guideOpen: boolean;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as { __cabnStore?: { getState(): Snapshot } }
		).__cabnStore;
		const s = store?.getState();
		return s
			? {
					mode: s.mode,
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					guideNpc: s.guideNpc,
					guideOpen: s.guideOpen,
				}
			: undefined;
	});
}

/** Held across a frame boundary — see smoke.spec.ts for why a CDP `.press()` can slip between two Phaser updates. */
async function holdKey(page: Page, key: string, ms = 150): Promise<void> {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
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

async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page
		.getByRole("button", { name: tod === "day" ? "Day" : "Night" })
		.click();
	await page.waitForTimeout(800);
}

async function shoot(
	page: Page,
	name: string,
	around?: { x: number; y: number },
) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	const path = join(SHOTS_DIR, `${name}.png`);
	if (!around) {
		await page.screenshot({ path });
		return;
	}
	const box = await page.locator("canvas").first().boundingBox();
	const pos = (await state(page))?.playerPos;
	if (!box || !pos) return;
	// The camera follows the player, so a world point sits at the canvas
	// centre plus its offset from the player.
	const w = 420;
	const h = 300;
	const cx = box.x + box.width / 2 + (around.x - pos.x);
	const cy = box.y + box.height / 2 + (around.y - pos.y) - 20;
	await page.screenshot({
		path,
		clip: {
			x: Math.max(box.x, cx - w / 2),
			y: Math.max(box.y, cy - h / 2),
			width: w,
			height: h,
		},
	});
}

test("guide NPC: first world only, click to talk, pages, Esc, Enter to reopen", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	const canvas = page.locator("canvas").first();
	await expect(canvas).toBeVisible();
	await page.waitForTimeout(1500);
	expect((await state(page))?.guideNpc).toBeNull();

	// shelf.json lists the sample world first; ShelfScene puts it due north.
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.guideNpc ?? null, {
			timeout: 15_000,
		})
		.not.toBeNull();
	await page.waitForTimeout(1200);
	const guide = (await state(page))?.guideNpc;
	if (!guide) throw new Error("no guide in the first world");
	expect(guide.talked).toBe(false);

	await setTimeOfDay(page, "day");
	await shoot(page, "npc-day-bubble", guide.pos);
	await setTimeOfDay(page, "night");
	await shoot(page, "npc-night-bubble", guide.pos);
	await setTimeOfDay(page, "day");

	// Click-walk to her: the click lands on her sprite (canvas centre is the
	// player), the walk ends inside her arrive radius and opens the box.
	const box = await canvas.boundingBox();
	if (!box) throw new Error("canvas has no bounding box");
	const from = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await page.mouse.click(
		box.x + box.width / 2 + (guide.pos.x - from.x),
		box.y + box.height / 2 + (guide.pos.y - from.y),
	);
	await expect
		.poll(async () => (await state(page))?.guideOpen, { timeout: 10_000 })
		.toBe(true);
	const dialog = page.getByTestId("guide-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Wren");
	await expect(page.getByTestId("guide-text")).toContainText("Well met");
	await page.waitForTimeout(3500);
	await shoot(page, "dialog-day-menu");

	const atOpen = (await state(page))?.playerPos;
	await page.keyboard.press("1");
	await expect(page.getByTestId("guide-page")).toHaveText("Moving · 1 / 5");
	await page.keyboard.press("Space"); // skip the typewriter
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("guide-page")).toHaveText("Moving · 2 / 5");
	await expect(page.getByTestId("guide-text")).toContainText("Press Enter");
	await page.waitForTimeout(3000);
	await shoot(page, "dialog-day-moving-2");
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByTestId("guide-page")).toHaveText("Moving · 1 / 5");
	// Arrow keys page the box; they must not walk the player underneath.
	expect((await state(page))?.playerPos).toEqual(atOpen);

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	const closed = await state(page);
	expect(closed?.guideOpen).toBe(false);
	expect(closed?.guideNpc?.talked).toBe(true);
	// Esc was the box's, not the world's: still in the world, near the fire.
	expect(closed?.activeWorldBase).not.toBeNull();
	expect(closed?.mode).toBe("world");
	await shoot(page, "npc-day-talked", guide.pos);

	await setTimeOfDay(page, "night");
	await holdKey(page, "Enter");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("3");
	await expect(page.getByTestId("guide-page")).toHaveText(/^Monsters · 1 \//);
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("guide-text")).toContainText("Ghost");
	await page.waitForTimeout(3500);
	await shoot(page, "dialog-night-monsters");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await shoot(page, "npc-night-talked", guide.pos);
	await setTimeOfDay(page, "day");

	// The second world on the shelf has no guide.
	const root = await page.evaluate(async () => {
		const s = (
			window as unknown as {
				__cabnStore: { getState(): { activeWorldBase: string } };
			}
		).__cabnStore.getState();
		const manifest = await (
			await fetch(`${s.activeWorldBase}world.json`)
		).json();
		return (
			manifest.clusters.find((c: { path: string }) => c.path === ".") ??
			manifest.clusters[0]
		).pos as { x: number; y: number };
	});
	await walkToward(page, { x: root.x + 70, y: root.y }, 30);
	await holdKey(page, "Escape");
	// Leaving the world tears her down (the store keeps the last world's
	// base until the next world loads, so that's not a usable signal here).
	await expect
		.poll(async () => (await state(page))?.guideNpc ?? null, {
			timeout: 10_000,
		})
		.toBeNull();
	await page.waitForTimeout(1200);
	await walkToward(page, { x: 0, y: 480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase ?? null, {
			timeout: 15_000,
		})
		.toBe("/worlds/notes/");
	await page.waitForTimeout(1500);
	expect((await state(page))?.guideNpc).toBeNull();

	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
