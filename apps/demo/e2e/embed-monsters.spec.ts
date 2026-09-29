import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// A url arch's live mini-page is a DOM layer over the canvas, so monsters on
// that arch fly a wider orbit that never passes under it; the docked page
// narrows or changes sides so it doesn't cover the arch at narrow widths,
// and the minimap yields the dock's header. The sample world has no
// monsters on a web portal, so world.json is rewritten in the browser to
// move three onto docs/threejs.md. CABN_REVIEW_SHOTS=1 writes screenshots
// to assets/generated/review/embed-monsters/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"embed-monsters",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

const WEB_PORTAL = "docs/threejs.md";
const MOVED_MONSTERS = [
	"monster:af1a5cd4",
	"monster:9c82fc16",
	"monster:6ea2657a",
];
const ARCH_HALF = 96;
const STUB_PAGE = `<!doctype html><html><head><title>stub</title>
<style>body{margin:0;font:16px sans-serif}section{height:600px;padding:16px}</style>
</head><body><section><h1>Stub framable site</h1></section></body></html>`;

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function state(page: Page) {
	return page.evaluate(() => {
		const s = (
			window as unknown as {
				__cabnStore?: {
					getState(): {
						activeWorldBase: string | null;
						playerPos: { x: number; y: number };
						focusedPortalPreview: { portalId: string } | null;
						nearWebPortal: { portalId: string } | null;
					};
				};
			}
		).__cabnStore?.getState();
		return s
			? {
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					focused: s.focusedPortalPreview?.portalId ?? null,
					near: s.nearWebPortal?.portalId ?? null,
				}
			: undefined;
	});
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
		await page.waitForTimeout(60);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error("walkToward timed out");
}

async function enterSampleWorld(page: Page) {
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect
		.poll(async () => (await state(page))?.activeWorldBase, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(1500);
}

async function walkToPortal(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focused, { timeout: 20_000 })
		.toBe(portalId);
	await page.waitForTimeout(1200);
}

/** The arch's world position and every moved monster's drawn bounds, in page CSS px. */
function screenGeometry(page: Page, portalId: string, monsterIds: string[]) {
	return page.evaluate(
		({ portalId, monsterIds, half }) => {
			type B = { x: number; y: number; width: number; height: number };
			const w = window as unknown as {
				__cabnGame: {
					canvas: HTMLCanvasElement;
					scale: { width: number };
					scene: {
						getScene(k: string): {
							cameras: {
								main: { worldView: { x: number; y: number }; zoom: number };
							};
							portalWorldPos: Map<string, { x: number; y: number }>;
							monsterSprites: Map<string, { visible: boolean; getBounds(): B }>;
						};
					};
				};
			};
			const game = w.__cabnGame;
			const scene = game.scene.getScene("world");
			const cam = scene.cameras.main;
			const c = game.canvas.getBoundingClientRect();
			const k = (c.width / game.scale.width) * cam.zoom;
			const toScreen = (b: B) => ({
				x: c.left + (b.x - cam.worldView.x) * k,
				y: c.top + (b.y - cam.worldView.y) * k,
				w: b.width * k,
				h: b.height * k,
			});
			const pos = scene.portalWorldPos.get(portalId);
			const arch = pos
				? toScreen({
						x: pos.x - half,
						y: pos.y - half,
						width: half * 2,
						height: half * 2,
					})
				: null;
			const monsters = monsterIds.flatMap((id) => {
				const s = scene.monsterSprites.get(id);
				return s?.visible ? [toScreen(s.getBounds())] : [];
			});
			return { world: pos ?? null, arch, monsters };
		},
		{ portalId, monsterIds, half: ARCH_HALF },
	);
}

async function box(page: Page, testId: string): Promise<Box | null> {
	const b = await page.getByTestId(testId).boundingBox();
	return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

async function stubSites(page: Page) {
	for (const origin of ["https://threejs.org", "https://example.com"]) {
		await page.route(`${origin}/**`, (route) =>
			route.fulfill({ contentType: "text/html", body: STUB_PAGE }),
		);
	}
}

for (const viewport of [
	{ width: 1024, height: 768 },
	{ width: 1280, height: 800 },
]) {
	test(`web arch at ${viewport.width}: monsters stay clear of the live page, the dock clears the arch, the minimap yields`, async ({
		page,
	}) => {
		test.setTimeout(150_000);
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await stubSites(page);
		await page.route("**/worlds/sample/world.json", async (route) => {
			const res = await route.fetch();
			const world = await res.json();
			for (const m of world.monsters)
				if (MOVED_MONSTERS.includes(m.id)) m.portalId = WEB_PORTAL;
			await route.fulfill({ response: res, json: world });
		});
		await page.setViewportSize(viewport);
		await enterSampleWorld(page);

		// --- mini-page on the arch: sample the orbit over several frames ------
		await walkToPortal(page, WEB_PORTAL);
		const { world: archWorld } = await screenGeometry(page, WEB_PORTAL, []);
		expect(archWorld).not.toBeNull();
		if (!archWorld) return;
		// Inside the live page's approach radius (150), outside the dock's (100).
		await walkToward(page, { x: archWorld.x, y: archWorld.y + 128 }, 8);
		await expect
			.poll(async () => (await state(page))?.focused ?? null)
			.toBeNull();
		const live = page.getByTestId("portal-live-page");
		await expect(live).toHaveAttribute("data-docked", "false");
		await expect(live).toBeVisible();
		let seen = 0;
		for (let i = 0; i < 16; i++) {
			const geo = await screenGeometry(page, WEB_PORTAL, MOVED_MONSTERS);
			const page0 = await box(page, "portal-live-page");
			expect(page0).not.toBeNull();
			if (!page0) return;
			for (const m of geo.monsters) {
				expect(
					overlaps(m, page0),
					`monster ${JSON.stringify(m)} vs mini-page ${JSON.stringify(page0)} (frame ${i})`,
				).toBe(false);
			}
			seen += geo.monsters.length;
			if (i === 6) await shoot(page, `${viewport.width}-mini-page-orbit`);
			await page.waitForTimeout(180);
		}
		expect(seen).toBeGreaterThan(0);

		// --- docked: the page clears the arch, the minimap yields its header --
		await walkToPortal(page, WEB_PORTAL);
		await expect(live).toHaveAttribute("data-docked", "true", {
			timeout: 5000,
		});
		await page.waitForTimeout(700);
		const dock = await box(page, "portal-preview-dock");
		const docked = await box(page, "portal-live-page");
		const { arch } = await screenGeometry(page, WEB_PORTAL, []);
		expect(dock && docked && arch).toBeTruthy();
		if (!dock || !docked || !arch) return;
		expect(overlaps(docked, arch), "docked page covers the arch").toBe(false);
		expect(overlaps(dock, arch), "dock covers the arch").toBe(false);
		expect(dock.w).toBeGreaterThanOrEqual(320);

		await expect(page.getByTestId("world-minimap")).toBeHidden();
		const header = page
			.getByTestId("portal-preview-dock")
			.locator(".cabn-panel-title");
		const hb = await header.boundingBox();
		expect(hb).not.toBeNull();
		if (!hb) return;
		const topmostIsHeader = await page.evaluate(
			({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				return !!el?.closest(".cabn-panel-title");
			},
			{ x: hb.x + hb.width - 12, y: hb.y + hb.height / 2 },
		);
		expect(topmostIsHeader, "the dock header's right end is on top").toBe(true);
		await shoot(page, `${viewport.width}-docked`);

		// Leaving the portal brings the minimap back.
		await walkToward(page, { x: archWorld.x, y: archWorld.y + 190 }, 10);
		await expect(page.getByTestId("world-minimap")).toBeVisible();
		expect(errors).toEqual([]);
	});
}

test("at 1280 with no monsters on the web arch the dock keeps today's spot and width", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await stubSites(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await enterSampleWorld(page);
	await walkToPortal(page, WEB_PORTAL);
	await expect(page.getByTestId("portal-live-page")).toHaveAttribute(
		"data-docked",
		"true",
		{ timeout: 5000 },
	);
	await page.waitForTimeout(500);
	const dock = page.getByTestId("portal-preview-dock");
	await expect(dock).toHaveAttribute("data-dock-side", "right");
	const b = await box(page, "portal-preview-dock");
	expect(b?.w).toBeCloseTo(480, 0);
	expect((b?.x ?? 0) + (b?.w ?? 0)).toBeCloseTo(1280 - 16, 0);
});
