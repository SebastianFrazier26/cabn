import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Portal-type arches: the overlay sheet loads from this build's own origin
// without errors. With CABN_REVIEW_SHOTS=1 it also walks to one arch per
// sample-world file type and writes in-world shots (day + night) to
// assets/generated/review/portal-types/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"portal-types",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Snapshot {
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalPreview: { portalId: string } | null;
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
					focusedPortalPreview: s.focusedPortalPreview,
				}
			: undefined;
	});
}

async function walkToward(page: Page, target: { x: number; y: number }) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= 50) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(150);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error("walkToward timed out");
}

async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page.evaluate((t) => {
		(
			window as unknown as {
				__cabnStore: { getState(): { setTimeOfDayOverride(t: string): void } };
			}
		).__cabnStore
			.getState()
			.setTimeOfDayOverride(t);
	}, tod);
	await page.waitForTimeout(500);
}

/** Walks to the arch; the camera then frames it and its ring neighbours. */
async function visitPortal(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focusedPortalPreview?.portalId, {
			timeout: 20_000,
		})
		.toBe(portalId);
	await page.waitForTimeout(1500);
}

const SHOTS = [
	{ id: "README.md", slug: "root-readme-config-url" },
	{ id: "lib/utils.py", slug: "lib-python" },
	{ id: "src/server.ts", slug: "src-typescript" },
	{ id: "media/chime.wav", slug: "media-audio-pdf-image-table" },
] as const;

test("portal-type overlay sheet loads and world arches render", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors: string[] = [];
	const sheetStatuses: number[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	page.on("response", (res) => {
		if (res.url().endsWith("/portal_arch_variants_soft.png"))
			sheetStatuses.push(res.status());
	});

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 });
	// A held press, not press(): the scene polls key state per frame.
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(1500);

	expect(sheetStatuses).toContain(200);
	const overlayCount = () =>
		page.evaluate(() => {
			const game = (
				window as unknown as {
					__cabnGame: {
						scene: {
							getScene(key: string): {
								portalVariantOverlays: Map<string, { active: boolean }>;
							};
						};
					};
				}
			).__cabnGame;
			return [
				...game.scene.getScene("world").portalVariantOverlays.values(),
			].filter((overlay) => overlay.active).length;
		});
	const initialOverlayCount = await overlayCount();
	expect(initialOverlayCount).toBeGreaterThan(0);
	await page.keyboard.down("Escape");
	await page.waitForTimeout(150);
	await page.keyboard.up("Escape");
	await expect.poll(overlayCount).toBe(0);
	await walkToward(page, { x: 0, y: -480 });
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect
		.poll(overlayCount, { timeout: 10_000 })
		.toBe(initialOverlayCount);

	if (TAKE_SHOTS) {
		await mkdir(SHOTS_DIR, { recursive: true });
		for (const tod of ["day", "night"] as const) {
			await setTimeOfDay(page, tod);
			for (const shot of SHOTS) {
				await visitPortal(page, shot.id);
				await page.screenshot({
					path: join(SHOTS_DIR, `world-${shot.slug}-${tod}.png`),
				});
			}
		}
	}

	expect(pageErrors).toEqual([]);
});
