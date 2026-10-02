import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./cspGuard";

// The file view's monster encounter popup (react/EncounterBanner.tsx): it
// used to auto-advance into the quill on a fixed 1.4s timer regardless of
// whether the player had read it — 2026-09-29 fix makes it stay up until an
// explicit dismissal (a click, a key, Enter/Space) continues, and Esc alone
// closes it without continuing. With CABN_REVIEW_SHOTS=1 it writes the popup
// in day/night/crimson to assets/generated/review/encounter-popup/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"encounter-popup",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const FILE = "lib/utils.py"; // has a gremlin in the sample world (see monsters.spec.ts)

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
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = await page.evaluate(
			() =>
				(
					window as unknown as {
						__cabnStore: {
							getState(): { playerPos: { x: number; y: number } };
						};
					}
				).__cabnStore.getState().playerPos,
		);
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(150);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error("walkToward timed out");
}

async function enterFile(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await page.waitForFunction(
		(id) =>
			(
				window as unknown as {
					__cabnStore: {
						getState(): { focusedPortalPreview: { portalId: string } | null };
					};
				}
			).__cabnStore.getState().focusedPortalPreview?.portalId === id,
		portalId,
		{ timeout: 20_000 },
	);
	await page.waitForTimeout(900);
	await holdKey(page, "Enter");
	await page.waitForFunction(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): { mode: string } } }
			).__cabnStore.getState().mode === "file",
	);
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("data-testid") ===
			"cabn-file-caret-input",
	);
	await page.waitForTimeout(600);
}

async function enterSampleFile(page: Page) {
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								__cabnStore: { getState(): { activeWorldBase: string | null } };
							}
						).__cabnStore.getState().activeWorldBase,
				),
			{ timeout: 10_000 },
		)
		.not.toBeNull();
	await page.waitForTimeout(1500);
	await enterFile(page, FILE);
}

function mode(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): { mode: string } } }
			).__cabnStore.getState().mode,
	);
}

/** Clicks the file view's first (only, in this fixture) monster sprite. */
async function clickMonster(page: Page): Promise<void> {
	const monsterPos = await page.evaluate(() => {
		const scene = (
			window as unknown as {
				__cabnGame: {
					scene: {
						getScene(k: string): {
							monsters: { id: string }[];
							monsterPos(m: unknown): { x: number; y: number };
						};
					};
				};
			}
		).__cabnGame.scene.getScene("file");
		const m = scene.monsters[0];
		return m ? scene.monsterPos(m) : null;
	});
	if (!monsterPos) throw new Error("expected a monster in this fixture file");
	const geom = await page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: {
					canvas: HTMLCanvasElement;
					scene: {
						getScene(k: string): {
							cameras: {
								main: { zoom: number; worldView: { x: number; y: number } };
							};
						};
					};
				};
			}
		).__cabnGame;
		const scene = game.scene.getScene("file");
		const cam = scene.cameras.main;
		const rect = game.canvas.getBoundingClientRect();
		return {
			scale: rect.width / game.canvas.width,
			rectLeft: rect.left,
			rectTop: rect.top,
			zoom: cam.zoom,
			worldViewX: cam.worldView.x,
			worldViewY: cam.worldView.y,
		};
	});
	const x =
		geom.rectLeft + (monsterPos.x - geom.worldViewX) * geom.zoom * geom.scale;
	const y =
		geom.rectTop + (monsterPos.y - geom.worldViewY) * geom.zoom * geom.scale;
	await page.mouse.click(x, y);
}

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

test("clicking a monster opens a popup that outlasts the old 1.4s timer, and Enter continues into the editor", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const errors: string[] = [];
	page.on("pageerror", (err) => errors.push(err.message));
	await enterSampleFile(page);

	await clickMonster(page);
	await expect.poll(() => mode(page)).toBe("encounter");
	const popup = page.getByTestId("cabn-encounter-popup");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("Enter to fight");
	await shoot(page, "01-popup-day");

	// Outlasts the old ENCOUNTER_BANNER_MS (1400ms) several times over —
	// the regression this guards against auto-advanced well before this.
	await page.waitForTimeout(5000);
	expect(await mode(page)).toBe("encounter");
	await expect(popup).toBeVisible();

	// Typing while it's up doesn't reach the file buffer (it owns the
	// keyboard) — the very first non-Escape key both proves that and
	// dismisses-to-continue in one step.
	const docBefore = await page.evaluate(() =>
		(
			window as unknown as {
				__cabnStore: {
					getState(): { activeFileState: { doc: { toString(): string } } };
				};
			}
		).__cabnStore
			.getState()
			.activeFileState.doc.toString(),
	);
	await page.keyboard.press("Enter");
	await expect.poll(() => mode(page)).toBe("editor");
	const docAfter = await page.evaluate(() =>
		(
			window as unknown as {
				__cabnStore: {
					getState(): { activeFileState: { doc: { toString(): string } } };
				};
			}
		).__cabnStore
			.getState()
			.activeFileState.doc.toString(),
	);
	expect(docAfter).toBe(docBefore);

	expect(errors).toEqual([]);
});

test("Esc closes the popup without continuing, and gives the caret its focus back", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await enterSampleFile(page);

	await clickMonster(page);
	await expect.poll(() => mode(page)).toBe("encounter");
	await page.waitForTimeout(300);

	await page.keyboard.press("Escape");
	await expect.poll(() => mode(page)).toBe("file");
	await expect(page.getByTestId("cabn-encounter-popup")).not.toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		)
		.toBe("cabn-file-caret-input");
});

test("a click anywhere dismisses and continues, same as a key", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await enterSampleFile(page);

	await clickMonster(page);
	await expect.poll(() => mode(page)).toBe("encounter");
	// Click somewhere far from the popup itself (top-left corner of the canvas).
	const box = await page.locator("canvas").first().boundingBox();
	if (!box) throw new Error("expected the canvas to have a bounding box");
	await page.mouse.click(box.x + 10, box.y + 10);
	await expect.poll(() => mode(page)).toBe("editor");
});

if (TAKE_SHOTS) {
	test("popup in night and crimson", async ({ page }) => {
		test.setTimeout(60_000);
		await enterSampleFile(page);
		await page.evaluate(() =>
			(
				window as unknown as {
					__cabnStore: {
						getState(): { setTimeOfDayOverride(t: string): void };
					};
				}
			).__cabnStore
				.getState()
				.setTimeOfDayOverride("night"),
		);
		await page.waitForTimeout(500);
		await clickMonster(page);
		await expect.poll(() => mode(page)).toBe("encounter");
		await shoot(page, "02-popup-night");
	});
}
