import { expect, type Page, test } from "@playwright/test";

// 2026-09-29: re-entering a file whose saved edit moved code used to put its
// monsters back on their build-time lines (the live-edit anchors only last a
// visit). WorldScene now re-checks them against the saved text on entry.

const PORTAL = "lib/models.py";
// monsters.json's skeleton for `unused-import:datetime` — a content-keyed
// rule, so it survives blank lines inserted above it.
const RULE = "unused-import:datetime";
const INSERTED = 3;

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalId: string | null;
	dirty: boolean;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: { getState(): Record<string, unknown> };
			}
		).__cabnStore;
		const s = store?.getState();
		if (!s) return undefined;
		const buf = s.activeFileState as { doc: { toString(): string } } | null;
		return {
			mode: s.mode as string,
			activeWorldBase: s.activeWorldBase as string | null,
			playerPos: s.playerPos as { x: number; y: number },
			focusedPortalId:
				(s.focusedPortalPreview as { portalId: string } | null)?.portalId ??
				null,
			dirty:
				buf !== null &&
				buf.doc.toString() !== (s.activePortalContent as string | null),
		};
	});
}

async function holdKey(page: Page, key: string, ms = 150) {
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

async function openWorld(page: Page) {
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
}

async function enterFile(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focusedPortalId, {
			timeout: 20_000,
		})
		.toBe(portalId);
	await page.waitForTimeout(900);
	await holdKey(page, "Enter");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		)
		.toBe("cabn-file-caret-input");
	await page.waitForTimeout(600);
}

async function leaveFile(page: Page) {
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	await page.waitForTimeout(600);
}

/** The monster's line as FileScene tracks it, and the row its sprite is drawn on. */
function monsterView(page: Page, rule: string) {
	return page.evaluate((rule) => {
		const scene = (
			window as unknown as {
				__cabnGame: {
					scene: {
						getScene(k: string): {
							monsters: { id: string; error: { rule: string } }[];
							monsterSprites: Map<string, { y: number }>;
							monsterLine(m: unknown): number;
						};
					};
				};
			}
		).__cabnGame.scene.getScene("file");
		const m = scene.monsters.find((x) => x.error.rule === rule);
		if (!m) return null;
		return {
			line: scene.monsterLine(m),
			// The hover bob moves the sprite a few px off its line.
			row: Math.round((scene.monsterSprites.get(m.id)?.y ?? Number.NaN) / 20),
		};
	}, rule);
}

test("a monster stays on its moved line after save, leave, re-enter and reload", async ({
	page,
}) => {
	test.setTimeout(150_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));

	await openWorld(page);
	await enterFile(page, PORTAL);
	const before = await monsterView(page, RULE);
	expect(before).not.toBeNull();
	const original = before?.line ?? -1;
	expect(before?.row).toBe(original);

	await page.keyboard.press("ControlOrMeta+Home");
	for (let i = 0; i < INSERTED; i++) await page.keyboard.press("Enter");
	await page.waitForTimeout(300);
	expect((await monsterView(page, RULE))?.line).toBe(original + INSERTED);
	await page.keyboard.press("ControlOrMeta+s");
	await expect.poll(async () => (await state(page))?.dirty).toBe(false);
	// The save re-check keeps it: blank lines don't fix an unused import.
	expect(await monsterView(page, RULE)).not.toBeNull();
	await leaveFile(page);

	await enterFile(page, PORTAL);
	expect(await monsterView(page, RULE)).toEqual({
		line: original + INSERTED,
		row: original + INSERTED,
	});
	await leaveFile(page);

	await page.reload();
	await openWorld(page);
	await enterFile(page, PORTAL);
	expect(await monsterView(page, RULE)).toEqual({
		line: original + INSERTED,
		row: original + INSERTED,
	});
	await leaveFile(page);
	expect(pageErrors).toEqual([]);
});
