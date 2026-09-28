import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Web portals end to end: a site whose headers refuse framing never gets an
// iframe (title card + "Open in browser" instead), and a framable site's one
// live page moves from the arch into the dock, is scrollable there, and
// hands the keyboard back to the world on a click outside it.
//
// External sites are stubbed with page.route so the run is deterministic
// and offline; embeds.json is patched to the verdict a networked build
// records for github.com (the converter's own tests cover the header
// check). CABN_E2E_LIVE_WEB=1 lets the frames load the real sites instead,
// and CABN_REVIEW_SHOTS=1 writes screenshots to
// assets/generated/review/embed-fixes/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"embed-fixes",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const LIVE_WEB = process.env.CABN_E2E_LIVE_WEB === "1";

const FRAMABLE = "docs/threejs.md";
const BLOCKED = "docs/code-host.md";
const BLOCKED_ORIGIN = "https://github.com";

const STUB_PAGE = `<!doctype html><html><head><title>stub</title>
<style>body{margin:0;font:16px sans-serif}section{height:600px;padding:16px;border-bottom:4px solid #ccc}</style>
</head><body>
<section id="top"><h1>Stub framable site</h1><input id="q" placeholder="search"></section>
<section><h2>Section two</h2></section><section><h2>Section three</h2></section>
</body></html>`;

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalPreview: {
		portalId: string;
		preview: { kind: string; embedBlocked?: string };
	} | null;
	nearWebPortal: { portalId: string } | null;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore?: { getState(): Snapshot } }
		).__cabnStore?.getState();
		return s
			? {
					mode: s.mode,
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					focusedPortalPreview: s.focusedPortalPreview,
					nearWebPortal: s.nearWebPortal,
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
		await page.waitForTimeout(80);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error("walkToward timed out");
}

async function walkToPortal(page: Page, portalId: string) {
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
	// Let the summoned walk finish so the player stands at the arch.
	await page.waitForTimeout(1200);
	return (await state(page))?.playerPos ?? { x: 0, y: 0 };
}

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

const activeTag = (page: Page) =>
	page.evaluate(() => document.activeElement?.tagName ?? null);

test("web portals: blocked site falls back, framable page docks and returns the keyboard", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const requests: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));
	page.on("request", (req) => requests.push(req.url()));

	if (!LIVE_WEB) {
		for (const origin of ["https://threejs.org", "https://example.com"]) {
			await page.route(`${origin}/**`, (route) =>
				route.fulfill({ contentType: "text/html", body: STUB_PAGE }),
			);
		}
	}
	await page.route(`${BLOCKED_ORIGIN}/**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			headers: { "x-frame-options": "DENY" },
			body: "<h1>should never be framed</h1>",
		}),
	);
	await page.route("**/worlds/sample/embeds.json", async (route) => {
		const res = await route.fetch();
		const json = await res.json();
		json.entries[BLOCKED] = {
			url: `${BLOCKED_ORIGIN}/`,
			framable: false,
			basis: "headers",
			detail: "X-Frame-Options: deny",
		};
		await route.fulfill({ response: res, json });
	});

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

	// --- blocked site: no iframe anywhere, fallback card in the dock --------
	await walkToPortal(page, BLOCKED);
	expect((await state(page))?.focusedPortalPreview?.preview).toMatchObject({
		kind: "url",
		embedBlocked: "X-Frame-Options: deny",
	});
	const card = page.getByTestId("portal-web-card");
	await expect(card).toHaveAttribute("data-blocked", "true");
	await expect(card).toHaveAttribute("data-live", "false");
	await expect(page.getByTestId("portal-web-hint")).toContainText(
		"doesn't allow itself to be shown",
	);
	await expect(page.getByTestId("portal-web-open")).toBeVisible();
	await expect(page.getByTestId("portal-live-page")).toHaveCount(0);
	await expect(page.locator("iframe")).toHaveCount(0);
	// The compact card: no big empty picture area without a fallback image.
	const dockBox = await page.getByTestId("portal-preview-dock").boundingBox();
	expect(dockBox?.height ?? 999).toBeLessThan(300);
	await page.waitForTimeout(600);
	await shoot(page, "blocked-dock");

	// --- framable site: the one live page moves into the dock --------------
	const archPos = await walkToPortal(page, FRAMABLE);
	const live = page.getByTestId("portal-live-page");
	await expect(live).toHaveAttribute("data-docked", "true", { timeout: 5000 });
	await expect(page.locator("iframe")).toHaveCount(1);
	const iframe = page.locator("iframe");
	await expect(iframe).toHaveAttribute(
		"sandbox",
		"allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
	);
	await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
	await expect(iframe).toHaveAttribute("allow", "");
	await expect(iframe).toHaveAttribute("src", "https://threejs.org/");
	await expect(page.locator(".cabn-live-page-frame")).not.toHaveAttribute(
		"inert",
		/.*/,
	);
	const liveBox = await live.boundingBox();
	const slotBox = await page.getByTestId("portal-web-live-slot").boundingBox();
	expect(liveBox && slotBox).toBeTruthy();
	if (!liveBox || !slotBox) return;
	expect(liveBox.width).toBeGreaterThan(380);
	expect(liveBox.height).toBeGreaterThan(300);
	expect(Math.abs(liveBox.x - slotBox.x)).toBeLessThan(2);
	expect(Math.abs(liveBox.y - slotBox.y)).toBeLessThan(2);
	await page.waitForTimeout(LIVE_WEB ? 4000 : 800);
	await shoot(page, "live-dock");

	const frame = page
		.frames()
		.find((f) => f.url().startsWith("https://threejs.org"));
	expect(frame, "the framed page loaded").toBeDefined();
	if (!LIVE_WEB && frame) {
		// Scrolls inside the page (wheel over the docked frame).
		await page.mouse.move(
			liveBox.x + liveBox.width / 2,
			liveBox.y + liveBox.height / 2,
		);
		await page.mouse.wheel(0, 500);
		await expect
			.poll(() => frame.evaluate(() => window.scrollY))
			.toBeGreaterThan(0);
	}

	// Clicking into the page gives it the keyboard...
	await page.mouse.click(liveBox.x + 60, liveBox.y + 60);
	await expect.poll(() => activeTag(page)).toBe("IFRAME");
	await expect(page.getByTestId("portal-live-page-focus-chip")).toBeVisible();
	await expect(live).toHaveAttribute("data-page-focused", "true");
	await shoot(page, "live-dock-page-focused");

	// ...and a click outside it (on the world, next to the player) takes it back.
	const canvasBox = await page.locator("canvas").first().boundingBox();
	if (!canvasBox) throw new Error("no canvas");
	await page.mouse.click(
		canvasBox.x + canvasBox.width / 2,
		canvasBox.y + canvasBox.height / 2 + 4,
	);
	await expect.poll(() => activeTag(page)).not.toBe("IFRAME");
	await expect(page.getByTestId("portal-live-page-focus-chip")).toHaveCount(0);
	await page.waitForTimeout(500);

	// WASD reaches the world again.
	const before = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await holdKey(page, "a", 350);
	await page.waitForTimeout(150);
	const after = (await state(page))?.playerPos ?? before;
	expect(after.x).toBeLessThan(before.x - 10);

	// Enter reaches the world too: back at the arch, it enters the portal.
	await walkToPortal(page, FRAMABLE);
	await holdKey(page, "Enter");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await expect(page.locator("iframe")).toHaveCount(0);
	await holdKey(page, "Escape");
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	await page.waitForTimeout(800);

	// Stepping back out of dock range (but inside the approach radius) returns
	// the same page to the arch as a thumbnail, still exactly one iframe.
	await walkToPortal(page, FRAMABLE);
	await expect(live).toHaveAttribute("data-docked", "true", { timeout: 5000 });
	await walkToward(page, { x: archPos.x, y: archPos.y + 125 }, 12);
	await expect
		.poll(
			async () => (await state(page))?.focusedPortalPreview?.portalId ?? null,
		)
		.not.toBe(FRAMABLE);
	await expect(live).toHaveAttribute("data-docked", "false");
	await expect(page.locator("iframe")).toHaveCount(1);
	await expect(page.locator(".cabn-live-page-frame")).toHaveAttribute(
		"inert",
		"",
	);
	await page.waitForTimeout(600);
	await shoot(page, "live-arch-thumbnail");

	// The blocked site's arch: title card with the "opens in browser" note.
	await walkToPortal(page, BLOCKED);
	const blockedArch = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await walkToward(page, { x: blockedArch.x, y: blockedArch.y + 125 }, 12);
	await page.waitForTimeout(900);
	await shoot(page, "blocked-arch");

	const origin = new URL(page.url()).origin;
	expect(requests.some((u) => u.startsWith(BLOCKED_ORIGIN))).toBe(false);
	expect(
		requests.filter(
			(u) =>
				![origin, "https://threejs.org", "https://example.com"].includes(
					new URL(u).origin,
				),
		),
	).toEqual(LIVE_WEB ? expect.any(Array) : []);
	if (!LIVE_WEB) {
		expect(consoleErrors).toEqual([]);
		expect(pageErrors).toEqual([]);
	}
});
