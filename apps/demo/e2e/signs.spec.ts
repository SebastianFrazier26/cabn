import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Signs (.seyn files) in the hosted demo: three signposts in the sample
// world, the popup on approach, the reader on Enter, an internal link that
// walks the player to its target, and a web link that opens a new tab with
// no opener. The demo has no owner mode, so the sign item must be absent.
// CABN_REVIEW_SHOTS=1 also writes review screenshots to
// assets/generated/review/signs/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(here, "..", "..", "..", "assets", "generated", "review", "signs");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Pos {
	x: number;
	y: number;
}

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: Pos;
	signs: { path: string }[];
	focusedSignPath: string | null;
	openSignPath: string | null;
	ownerSigns: unknown;
	clusters: { id: string; pos: Pos }[];
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): Omit<Snapshot, "clusters"> & {
						worldMap: { clusters: { id: string; pos: Pos }[] } | null;
					};
				};
			}
		).__cabnStore;
		const s = store?.getState();
		return s
			? {
					mode: s.mode,
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					signs: s.signs,
					focusedSignPath: s.focusedSignPath,
					openSignPath: s.openSignPath,
					ownerSigns: s.ownerSigns,
					clusters: s.worldMap?.clusters ?? [],
				}
			: undefined;
	});
}

/** Where each signpost's board stands — read off the running scene, since only the scene knows where placement put them. */
function signSpots(page: Page): Promise<Record<string, Pos>> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: {
					scene: {
						getScene(key: string): {
							signs: { interactables(): { id: string; pos: Pos }[] } | null;
						};
					};
				};
			}
		).__cabnGame;
		const layer = game.scene.getScene("world").signs;
		return Object.fromEntries(
			(layer?.interactables() ?? []).map((i) => [i.id, i.pos]),
		);
	});
}

async function holdKey(page: Page, key: string, ms = 150): Promise<void> {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
}

async function walkToward(page: Page, target: Pos, within: number) {
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
		await page.waitForTimeout(90);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page.getByRole("button", { name: tod === "day" ? "Day" : "Night" }).click();
	await page.waitForTimeout(800);
}

async function shoot(page: Page, name: string, around?: Pos) {
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
	const w = 460;
	const h = 320;
	const cx = box.x + box.width / 2 + (around.x - pos.x);
	const cy = box.y + box.height / 2 + (around.y - pos.y);
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

test("signs: popup, reader, internal link walks, web link opens a tab; no sign item in the demo", async ({
	page,
	context,
}) => {
	test.setTimeout(180_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));
	// The web link's tab never reaches the real site.
	await context.route("https://github.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "<p>ok</p>" }),
	);

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);

	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.signs.length ?? 0, { timeout: 15_000 })
		.toBe(3);
	await page.waitForTimeout(1200);

	// Hosted: no owner capability, so no sign item — not hidden, absent.
	expect((await state(page))?.ownerSigns).toBeNull();
	await expect(page.locator('[data-tool="sign"]')).toHaveCount(0);
	await holdKey(page, "p");
	expect(await page.getByTestId("sign-placing").count()).toBe(0);

	const spots = await signSpots(page);
	expect(Object.keys(spots).sort()).toEqual(["docs/about.seyn", "src/tour.seyn", "welcome.seyn"]);
	const welcome = spots["welcome.seyn"] as Pos;

	await setTimeOfDay(page, "day");
	await walkToward(page, { x: welcome.x + 50, y: welcome.y + 20 }, 16);
	const popup = page.getByTestId("sign-popup");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("Welcome to harvest-log");
	await expect(popup).toHaveAttribute("data-sign-path", "welcome.seyn");
	await shoot(page, "signpost-day", welcome);
	await shoot(page, "popup-day");
	await setTimeOfDay(page, "night");
	await shoot(page, "signpost-night", welcome);
	await shoot(page, "popup-night");
	await setTimeOfDay(page, "day");

	// Enter reads it (the sign is closer than any arch here).
	const before = (await state(page))?.playerPos;
	await holdKey(page, "Enter");
	const reader = page.getByTestId("sign-reader");
	await expect(reader).toBeVisible();
	await expect(popup).toBeHidden();
	await expect(reader.getByTestId("sign-title")).toHaveText("Welcome to harvest-log");
	// Owner-only controls don't exist here either.
	await expect(reader.getByTestId("sign-edit")).toHaveCount(0);
	await expect(reader.getByTestId("sign-delete")).toHaveCount(0);
	await shoot(page, "reader-day");
	// Arrow keys belong to the reader while it's open; the player holds still.
	await holdKey(page, "ArrowLeft", 300);
	expect((await state(page))?.playerPos).toEqual(before);
	expect((await state(page))?.mode).toBe("world");

	// Web link: new tab, no opener, no referrer.
	const web = reader.locator('a[data-link-kind="url"]');
	await expect(web).toHaveAttribute("target", "_blank");
	await expect(web).toHaveAttribute("rel", "noopener noreferrer");
	await expect(web).toHaveAttribute("href", "https://github.com/SebastianFrazier26/cabn");
	const [tab] = await Promise.all([context.waitForEvent("page"), web.click()]);
	await tab.waitForLoadState();
	expect(tab.url()).toBe("https://github.com/SebastianFrazier26/cabn");
	expect(await tab.evaluate(() => window.opener)).toBeNull();
	expect(await tab.evaluate(() => document.referrer)).toBe("");
	await tab.close();
	await page.bringToFront();

	// Internal link: the reader closes and the player walks to the docs fountain.
	const docs = (await state(page))?.clusters.find((c) => c.id === "docs");
	if (!docs) throw new Error("no docs cluster");
	const startDist = Math.hypot(
		(before?.x ?? 0) - docs.pos.x,
		(before?.y ?? 0) - docs.pos.y,
	);
	await reader.getByRole("button", { name: "the docs grove" }).click();
	await expect(reader).toBeHidden();
	await expect
		.poll(
			async () => {
				const p = (await state(page))?.playerPos;
				return p ? Math.hypot(p.x - docs.pos.x, p.y - (docs.pos.y + 86)) : Infinity;
			},
			{ timeout: 20_000 },
		)
		.toBeLessThan(40);
	expect(startDist).toBeGreaterThan(200);

	// The docs grove's own sign, opened by clicking its post.
	await page.waitForTimeout(500);
	const about = (await signSpots(page))["docs/about.seyn"] as Pos;
	const canvasBox = await page.locator("canvas").first().boundingBox();
	const me = (await state(page))?.playerPos;
	if (!canvasBox || !me) throw new Error("no canvas");
	await page.mouse.click(
		canvasBox.x + canvasBox.width / 2 + (about.x - me.x),
		canvasBox.y + canvasBox.height / 2 + (about.y - me.y),
	);
	await expect(reader).toBeVisible({ timeout: 10_000 });
	await expect(reader).toHaveAttribute("data-sign-path", "docs/about.seyn");
	// A link to a file becomes a button that walks there; Esc closes.
	await expect(reader.getByRole("button", { name: "models.py" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(reader).toBeHidden();
	expect((await state(page))?.mode).toBe("world");

	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
