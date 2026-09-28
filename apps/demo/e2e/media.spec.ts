import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Media previews end to end: the converter shipped media/<hash> files and
// media.json, the engine decodes/renders them in the dock and file view, and
// pdf.js's worker comes from this build's own origin. With
// CABN_REVIEW_SHOTS=1 it also writes review screenshots (arch/dock/file,
// day+night) to assets/generated/review/media/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"media",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalPreview: { portalId: string; preview: { kind: string } } | null;
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
					focusedPortalPreview: s.focusedPortalPreview,
				}
			: undefined;
	});
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
	const deadline = Date.now() + 20_000;
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
		await page.waitForTimeout(150);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error("walkToward timed out");
}

async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page.evaluate((t) => {
		const store = (
			window as unknown as {
				__cabnStore: { getState(): { setTimeOfDayOverride(t: string): void } };
			}
		).__cabnStore;
		store.getState().setTimeOfDayOverride(t);
	}, tod);
	await page.waitForTimeout(400);
}

async function clusterPosOf(page: Page, portalId: string) {
	return page.evaluate(async (id) => {
		const store = (
			window as unknown as {
				__cabnStore: { getState(): { activeWorldBase: string } };
			}
		).__cabnStore;
		const manifest = await (
			await fetch(`${store.getState().activeWorldBase}world.json`)
		).json();
		const portal = manifest.portals.find((p: { id: string }) => p.id === id);
		return manifest.clusters.find(
			(c: { id: string }) => c.id === portal.clusterId,
		).pos as { x: number; y: number };
	}, portalId);
}

/** Walks to the portal, then steps outward (away from its cluster's centre, so away from neighbouring arches) so the player isn't standing over the arch preview. Returns where the arch is relative to the player now. */
async function focusPortal(page: Page, portalId: string) {
	await page.evaluate((id) => {
		const bus = (
			window as unknown as {
				__cabnBus: { emit(e: string, p: unknown): void };
			}
		).__cabnBus;
		bus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focusedPortalPreview?.portalId, {
			timeout: 20_000,
		})
		.toBe(portalId);
	await page.waitForTimeout(1200);
	const at = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	const centre = await clusterPosOf(page, portalId);
	const keys: string[] = [];
	const dx = at.x - centre.x;
	const dy = at.y - centre.y;
	if (Math.abs(dx) > Math.abs(dy) * 0.4)
		keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
	if (Math.abs(dy) > Math.abs(dx) * 0.4)
		keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
	for (const k of keys) await page.keyboard.down(k);
	await page.waitForTimeout(300);
	for (const k of keys) await page.keyboard.up(k);
	await page.waitForTimeout(900);
	await expect
		.poll(async () => (await state(page))?.focusedPortalPreview?.portalId)
		.toBe(portalId);
	const now = (await state(page))?.playerPos ?? at;
	return { x: at.x - now.x, y: at.y - now.y };
}

async function shoot(
	page: Page,
	name: string,
	archOffset?: { x: number; y: number },
) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	const path = join(SHOTS_DIR, `${name}.png`);
	if (!archOffset) {
		await page.screenshot({ path });
		return;
	}
	const box = await page.locator("canvas").first().boundingBox();
	if (!box) return;
	// The camera follows the player, so the arch sits at the canvas centre
	// plus the arch-minus-player offset (preview opening a little above the
	// portal's anchor).
	const size = 300;
	const cx = box.x + box.width / 2 + archOffset.x;
	const cy = box.y + box.height / 2 + archOffset.y - 30;
	await page.screenshot({
		path,
		clip: {
			x: Math.max(box.x, cx - size / 2),
			y: Math.max(box.y, cy - size / 2),
			width: size,
			height: size,
		},
	});
}

const MEDIA = [
	{ id: "media/meadow.png", kind: "image", slug: "image-png" },
	{ id: "media/meadow-photo.jpg", kind: "image", slug: "image-jpeg" },
	{ id: "media/chime.wav", kind: "audio", slug: "audio-wav" },
	{ id: "media/field-guide.pdf", kind: "pdf", slug: "pdf" },
	{ id: "media/harvest.csv", kind: "table", slug: "csv" },
	{ id: "media/not-a-picture.png", kind: "sealed", slug: "sealed-mismatch" },
] as const;

test("media previews: image, audio, PDF, CSV and a sealed mismatch in the dock and file view", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const requests: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));
	page.on("request", (req) => requests.push(req.url()));

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(1500);

	// Night only matters for the review shots (the viewers are token-themed,
	// same code path) — skipping it keeps the CI run to one pass.
	const times = TAKE_SHOTS ? (["day", "night"] as const) : (["day"] as const);
	for (const tod of times) {
		await setTimeOfDay(page, tod);
		for (const media of MEDIA) {
			const archOffset = await focusPortal(page, media.id);
			expect((await state(page))?.focusedPortalPreview?.preview.kind).toBe(
				media.kind,
			);
			const dock = page.getByTestId("portal-preview-dock");
			await expect(dock).toBeVisible();
			if (media.kind === "image")
				await expect(dock.locator("img")).toHaveJSProperty("complete", true);
			if (media.kind === "audio")
				await expect(dock.locator("canvas.cabn-wave")).toBeVisible({
					timeout: 10_000,
				});
			if (media.kind === "pdf")
				await expect(dock.locator(".cabn-pdf-scroll canvas")).toBeVisible({
					timeout: 15_000,
				});
			if (media.kind === "table")
				await expect(dock.locator(".cabn-table tbody tr")).toHaveCount(24);
			if (media.kind === "sealed")
				await expect(dock.getByTestId("cabn-sealed-card")).toContainText(
					"type mismatch",
				);
			// Arch textures repaint on the LOD tick after async media resolves.
			await page.waitForTimeout(800);
			await shoot(page, `${media.slug}-arch-${tod}`, archOffset);
			await shoot(page, `${media.slug}-dock-${tod}`);

			// Stepped back past Enter's reach for the arch shot — walk up again.
			await page.evaluate((id) => {
				const bus = (
					window as unknown as {
						__cabnBus: { emit(e: string, p: unknown): void };
					}
				).__cabnBus;
				bus.emit("tool:walk-to-portal", { portalId: id });
			}, media.id);
			await page.waitForTimeout(900);
			await holdKey(page, "Enter");
			await expect.poll(async () => (await state(page))?.mode).toBe("file");
			if (media.kind === "table") {
				await expect(page.getByTestId("cabn-file-table-panel")).toBeVisible();
				await page.waitForTimeout(1200);
			} else {
				const view = page.getByTestId("cabn-file-media-view");
				await expect(view).toBeVisible();
				if (media.kind === "audio") {
					await expect(view.locator("canvas.cabn-wave")).toBeVisible();
					await view.getByRole("button", { name: "Play" }).click();
					await expect(
						view.getByRole("button", { name: "Pause" }),
					).toBeVisible();
					await page.waitForTimeout(500);
				}
				if (media.kind === "pdf") {
					await expect(view.locator(".cabn-pdf-scroll canvas")).toBeVisible({
						timeout: 15_000,
					});
					await view.getByRole("button", { name: "Next page" }).click();
					await expect(view).toContainText("page 2 / 2");
					await page.waitForTimeout(500);
				}
			}
			await page.waitForTimeout(900);
			await shoot(page, `${media.slug}-file-${tod}`);
			await holdKey(page, "Escape");
			await expect
				.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
				.toBe("world");
			await page.waitForTimeout(600);
		}
	}

	const origin = new URL(page.url()).origin;
	const worker = requests.find((u) => u.includes("pdf.worker"));
	expect(worker, "pdf.js worker was requested").toBeDefined();
	expect(new URL(worker as string).origin).toBe(origin);
	// The sample world's one allowlisted url-preview embed (pyproject.toml ->
	// example.com) can load when a walk passes its arch; nothing media-related
	// may touch any other origin (no CDN for pdf.js, fonts, or wasm).
	const allowedEmbeds = ["https://example.com", "https://threejs.org"];
	expect(
		requests.filter(
			(u) => ![origin, ...allowedEmbeds].includes(new URL(u).origin),
		),
	).toEqual([]);
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
