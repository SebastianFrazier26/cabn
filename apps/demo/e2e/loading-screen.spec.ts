import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./cspGuard";

// The loading overlay end to end: a slow world.json (Playwright route
// throttling) shows the panel over the held cabin fade with the world's
// name and one of Wren's tips, and it goes once the world is walkable; a
// fast load never shows it; a failed world.json shows the in-world error,
// whose Try again and Back to shelf both work. CABN_REVIEW_SHOTS=1 also
// writes review screenshots to assets/generated/review/loading-screen/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"loading-screen",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const SAMPLE_WORLD = "**/worlds/sample/world.json";
const WORLD_DELAY_MS = 2000;

interface LoadingSnapshot {
	active: boolean;
	visible: boolean;
	label: string;
	error: string | null;
}

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	portals: number;
	loading: LoadingSnapshot;
	shelfActive: boolean;
	worldActive: boolean;
}

interface LogEntry extends LoadingSnapshot {
	t: number;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const w = window as unknown as {
			__cabnStore?: {
				getState(): {
					mode: string;
					activeWorldBase: string | null;
					playerPos: { x: number; y: number };
					portals: unknown[];
					loading: {
						active: boolean;
						visible: boolean;
						label: string;
						error: { message: string } | null;
					};
				};
			};
			__cabnGame?: { scene: { isActive(key: string): boolean } };
		};
		const s = w.__cabnStore?.getState();
		if (!s) return undefined;
		return {
			mode: s.mode,
			activeWorldBase: s.activeWorldBase,
			playerPos: s.playerPos,
			portals: s.portals.length,
			loading: {
				active: s.loading.active,
				visible: s.loading.visible,
				label: s.loading.label,
				error: s.loading.error?.message ?? null,
			},
			shelfActive: w.__cabnGame?.scene.isActive("shelf") ?? false,
			worldActive: w.__cabnGame?.scene.isActive("world") ?? false,
		};
	});
}

/** Every change to the store's loading state, timestamped in the page, from here on. */
async function recordLoading(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as {
			__loadingLog: unknown[];
			__cabnStore: {
				getState(): { loading: unknown };
				subscribe(fn: (s: { loading: unknown }) => void): () => void;
			};
		};
		w.__loadingLog = [];
		let last: unknown = null;
		w.__cabnStore.subscribe((s) => {
			if (s.loading === last) return;
			last = s.loading;
			const l = s.loading as {
				active: boolean;
				visible: boolean;
				label: string;
				error: { message: string } | null;
			};
			w.__loadingLog.push({
				t: performance.now(),
				active: l.active,
				visible: l.visible,
				label: l.label,
				error: l.error?.message ?? null,
			});
		});
	});
}

async function loadingLog(page: Page): Promise<LogEntry[]> {
	return page.evaluate(
		() => (window as unknown as { __loadingLog: LogEntry[] }).__loadingLog,
	);
}

/** Total time the overlay was on screen across a log, in ms. */
function visibleMs(log: LogEntry[], end: number): number {
	let total = 0;
	let since: number | null = null;
	for (const entry of log) {
		if (entry.visible && since === null) since = entry.t;
		if (!entry.visible && since !== null) {
			total += entry.t - since;
			since = null;
		}
	}
	if (since !== null) total += end - since;
	return total;
}

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

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

async function waitForShelf(page: Page) {
	await expect
		.poll(
			async () => {
				const s = await state(page);
				return !!s && s.shelfActive && !s.loading.active && !s.loading.visible;
			},
			{ timeout: 30_000 },
		)
		.toBe(true);
	// Past the shelf's own arrival fade.
	await page.waitForTimeout(800);
}

async function waitForWorld(page: Page, base = "/worlds/sample/") {
	await expect
		.poll(
			async () => {
				const s = await state(page);
				return (
					!!s &&
					s.worldActive &&
					s.activeWorldBase === base &&
					s.portals > 0 &&
					!s.loading.active &&
					!s.loading.visible
				);
			},
			{ timeout: 30_000 },
		)
		.toBe(true);
}

/** shelf.json lists the sample world first; ShelfScene puts it due north. */
async function enterSampleWorld(page: Page) {
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
}

async function returnToShelf(page: Page) {
	const root = await page.evaluate(async () => {
		const manifest = await (await fetch("/worlds/sample/world.json")).json();
		return (
			manifest.clusters.find((c: { path: string }) => c.path === ".") ??
			manifest.clusters[0]
		).pos as { x: number; y: number };
	});
	await walkToward(page, { x: root.x + 70, y: root.y }, 30);
	await holdKey(page, "Escape");
}

function throttleWorld(page: Page, ms = WORLD_DELAY_MS) {
	return page.route(SAMPLE_WORLD, async (route) => {
		await new Promise((r) => setTimeout(r, ms));
		await route.continue();
	});
}

function trackErrors(page: Page) {
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	return pageErrors;
}

test("a slow world.json shows the loading panel over the held fade, and a fast load never does", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors = trackErrors(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	// Startup: a slow shelf.json keeps it past the show delay on a warm
	// server, and slowing the art gives the preloader real progress to show.
	await page.route("**/worlds/shelf.json", async (route) => {
		await new Promise((r) => setTimeout(r, 900));
		await route.continue();
	});
	await page.route("**/*.png", async (route) => {
		await new Promise((r) => setTimeout(r, 60));
		await route.continue();
	});
	await page.goto("/?e2e=1");
	const overlay = page.getByTestId("loading-overlay");
	await expect(overlay).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("loading-label")).toHaveText(
		"Waking the cabin…",
	);
	await expect(page.getByTestId("loading-bar")).toBeVisible({
		timeout: 10_000,
	});
	// The overlay swallows clicks (the Day button underneath included), so the store sets the look.
	await page.evaluate(() =>
		(
			window as unknown as {
				__cabnStore: {
					getState(): { setTimeOfDayOverride(o: string): void };
				};
			}
		).__cabnStore
			.getState()
			.setTimeOfDayOverride("day"),
	);
	await expect(page.getByTestId("loading-overlay")).toBeVisible();
	await shoot(page, "startup-day");
	await waitForShelf(page);
	await page.unroute("**/*.png");
	await page.unroute("**/worlds/shelf.json");
	await expect(overlay).toBeHidden();
	await expect(page.getByTestId("cabn-game-root")).toHaveAttribute(
		"aria-busy",
		"false",
	);

	await throttleWorld(page);
	await recordLoading(page);
	await enterSampleWorld(page);
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await expect(page.getByTestId("loading-label")).toHaveText(
		"Walking to sample-project…",
	);
	await expect(page.getByRole("status")).toHaveText(
		"Walking to sample-project…",
	);
	const tip = page.getByTestId("loading-tip");
	await expect(tip).toContainText("Wren's tip");
	expect(((await tip.textContent()) ?? "").length).toBeGreaterThan(30);
	await expect(page.getByTestId("loading-swirl")).toBeVisible();
	await expect(page.getByTestId("cabn-game-root")).toHaveAttribute(
		"aria-busy",
		"true",
	);
	// The cabin fade holds its cover under the panel instead of revealing a blank canvas.
	await expect(
		page.locator('[data-transition="cabin"][data-phase="held"]'),
	).toBeVisible();
	await page.waitForTimeout(400);
	await shoot(page, "entering-world-day");

	await waitForWorld(page);
	await expect(overlay).toBeHidden();
	await expect(page.locator("[data-transition]")).toHaveCount(0, {
		timeout: 3_000,
	});
	const entered = await loadingLog(page);
	expect(entered.some((e) => e.visible)).toBe(true);
	// It stayed up for the throttled wait, then went.
	const endT = await page.evaluate(() => performance.now());
	expect(visibleMs(entered, endT)).toBeGreaterThan(WORLD_DELAY_MS / 2);
	// Walkable: the arrow keys move the player again.
	const before = (await state(page))?.playerPos;
	await holdKey(page, "ArrowRight", 300);
	expect((await state(page))?.playerPos.x).toBeGreaterThan(before?.x ?? 0);
	await page.unroute(SAMPLE_WORLD);

	// No delay: back to the shelf and in again without the panel ever showing
	// (the whole scene switch finishes under the cabin fade).
	await recordLoading(page);
	await returnToShelf(page);
	await waitForShelf(page);
	await enterSampleWorld(page);
	await waitForWorld(page);
	const fast = await loadingLog(page);
	expect(fast.some((e) => e.active)).toBe(true);
	const fastEnd = await page.evaluate(() => performance.now());
	expect(visibleMs(fast, fastEnd)).toBeLessThan(17);

	expect(pageErrors).toEqual([]);
});

test("a failed world.json shows the in-world error; Try again and Back to shelf both work", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors = trackErrors(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await waitForShelf(page);
	await page.getByRole("button", { name: "Night" }).click();

	await throttleWorld(page);
	await enterSampleWorld(page);
	const overlay = page.getByTestId("loading-overlay");
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await page.waitForTimeout(400);
	await shoot(page, "entering-world-night");
	await waitForWorld(page);
	await page.unroute(SAMPLE_WORLD);
	await returnToShelf(page);
	await waitForShelf(page);

	let requests = 0;
	await page.route(SAMPLE_WORLD, (route) => {
		requests += 1;
		return route.fulfill({ status: 404, body: "gone" });
	});
	await enterSampleWorld(page);
	const error = page.getByTestId("loading-error");
	await expect(error).toBeVisible({ timeout: 10_000 });
	await expect(error).toContainText("The path to this world has washed out.");
	await expect(error).toContainText("HTTP 404");
	const back = page.getByRole("button", { name: "Back to shelf" });
	await expect(back).toBeVisible();
	await expect(back).toBeFocused();
	await page.waitForTimeout(300);
	await shoot(page, "error-night");

	// Phaser's loader retries a failed file itself, so count attempts, not requests.
	const firstAttempt = requests;
	expect(firstAttempt).toBeGreaterThan(0);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect
		.poll(() => requests, { timeout: 10_000 })
		.toBeGreaterThan(firstAttempt);
	await expect(error).toBeVisible({ timeout: 10_000 });

	await back.click();
	await waitForShelf(page);
	await expect(overlay).toBeHidden();
	const s = await state(page);
	expect(s?.loading.error).toBeNull();
	// Walkable shelf: the player moves.
	const before = s?.playerPos;
	await holdKey(page, "ArrowDown", 300);
	expect((await state(page))?.playerPos.y).toBeGreaterThan(before?.y ?? 0);

	// Once the path is back, the same cabin opens.
	await page.unroute(SAMPLE_WORLD);
	await enterSampleWorld(page);
	await waitForWorld(page);

	// Before the error state, the throw escaped BootScene.create as an uncaught error.
	expect(
		pageErrors.filter((m) => m.includes("Invalid world manifest")),
	).toEqual([]);
});

test("reduced motion: the panel is still, the fade is flat, and it still waits for the world", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const pageErrors = trackErrors(page);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await waitForShelf(page);
	await page.getByRole("button", { name: "Day" }).click();
	await throttleWorld(page);
	await enterSampleWorld(page);
	const overlay = page.getByTestId("loading-overlay");
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await expect(overlay).toHaveAttribute("data-reduced-motion", "");
	await expect(page.getByTestId("loading-swirl")).toBeVisible();
	await expect(
		page.locator('.cabn-transition-fade[data-transition="cabin"]'),
	).toBeVisible();
	await page.waitForTimeout(300);
	await shoot(page, "entering-world-reduced-motion");
	await waitForWorld(page);
	await expect(overlay).toBeHidden();
	expect(pageErrors).toEqual([]);
});

test("a PDF whose document is slow puts up the panel in the file view, labelled with the viewer's own line", async ({
	page,
}) => {
	test.setTimeout(150_000);
	const pageErrors = trackErrors(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	// Held until released below: the dock and the arch thumbnail share the
	// same document load, so a plain delay could run out before the file opens.
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	await page.route("**/worlds/sample/media/*.pdf", async (route) => {
		await gate;
		await route.continue();
	});
	await page.goto("/?e2e=1");
	await waitForShelf(page);
	await page.getByRole("button", { name: "Day" }).click();
	await enterSampleWorld(page);
	await waitForWorld(page);

	const portalId = "media/field-guide.pdf";
	await page.evaluate((id) => {
		(
			window as unknown as {
				__cabnBus: { emit(e: string, p: unknown): void };
			}
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								__cabnStore: {
									getState(): {
										focusedPortalPreview: { portalId: string } | null;
									};
								};
							}
						).__cabnStore.getState().focusedPortalPreview?.portalId ?? null,
				),
			{ timeout: 20_000 },
		)
		.toBe(portalId);
	await page.waitForTimeout(900);
	// The dock waits on the same document without the panel: only the file view reports it.
	expect((await state(page))?.loading.active).toBe(false);
	await holdKey(page, "Enter");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");

	const overlay = page.getByTestId("loading-overlay");
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await expect(page.getByTestId("loading-label")).toHaveText(
		"Unrolling the scroll…",
	);
	await page.waitForTimeout(300);
	await shoot(page, "pdf-file-day");
	release();
	const view = page.getByTestId("cabn-file-media-view");
	await expect(view.locator(".cabn-pdf-scroll canvas")).toBeVisible({
		timeout: 15_000,
	});
	await expect(overlay).toBeHidden({ timeout: 5_000 });
	await holdKey(page, "Escape");
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	expect(pageErrors).toEqual([]);
});
