import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Regressions for two file-view bugs (2026-09-28):
// - clicking an enchanted markdown line placed the caret by the raw-source
//   monospace grid, so it landed columns away from the glyph clicked (the
//   hidden `#`, backticks, `**` and list marker shifted everything);
// - monsters stayed on their entry-time line while lines were inserted or
//   deleted above them, in the file view and in the spellbook.
// CABN_REVIEW_SHOTS=1 writes review shots to assets/generated/review/file-bugs/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"file-bugs",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const SHOT_SUFFIX = process.env.CABN_SHOT_SUFFIX ?? "";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalPreview: { portalId: string } | null;
	doc: string | null;
	head: number;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		type Buf = {
			doc: { toString(): string };
			selection: { main: { head: number } };
		};
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): Record<string, unknown> & {
						activeFileState: Buf | null;
					};
				};
			}
		).__cabnStore;
		const s = store?.getState();
		if (!s) return undefined;
		const buf = s.activeFileState;
		return {
			mode: s.mode as string,
			activeWorldBase: s.activeWorldBase as string | null,
			playerPos: s.playerPos as { x: number; y: number },
			focusedPortalPreview: s.focusedPortalPreview as {
				portalId: string;
			} | null,
			doc: buf ? buf.doc.toString() : null,
			head: buf?.selection.main.head ?? -1,
		};
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

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}${SHOT_SUFFIX}.png`) });
}

async function caretFocused(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		)
		.toBe("cabn-file-caret-input");
}

async function enterFile(page: Page, portalId: string) {
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
	await page.waitForTimeout(900);
	await holdKey(page, "Enter");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await caretFocused(page);
	await page.waitForTimeout(600);
}

async function leaveFile(page: Page, discard: boolean) {
	await page.keyboard.press("Escape");
	if (discard) await page.getByRole("button", { name: "Discard" }).click();
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	await page.waitForTimeout(600);
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

/**
 * Screen point of the painted glyph that starts `needle` on 0-based `line`,
 * read off the Phaser Text objects FileScene actually drew for that line (so
 * it's where the player sees the characters, enchanted or raw) — a quarter
 * glyph in, so the click rounds to the boundary before it.
 */
async function paintedGlyphPoint(page: Page, line: number, needle: string) {
	return page.evaluate(
		({ line, needle }) => {
			type TextObj = {
				type: string;
				text: string;
				x: number;
				width: number;
			};
			const game = (
				window as unknown as {
					__cabnGame: {
						canvas: HTMLCanvasElement;
						scene: {
							getScene(k: string): {
								activeLines: Map<
									number,
									{ container: { y: number; list: TextObj[] } }
								>;
								cameras: {
									main: {
										zoom: number;
										worldView: { x: number; y: number };
									};
								};
							};
						};
					};
				}
			).__cabnGame;
			const scene = game.scene.getScene("file");
			const rendered = scene.activeLines.get(line);
			if (!rendered) throw new Error(`line ${line} not rendered`);
			// The first Text is the gutter's line number.
			const texts = rendered.container.list.filter((o) => o.type === "Text");
			for (const t of texts.slice(1)) {
				const at = t.text.indexOf(needle);
				if (at < 0) continue;
				const glyph = t.width / t.text.length;
				const wx = t.x + (at + 0.25) * glyph;
				const wy = line * 20;
				const cam = scene.cameras.main;
				const rect = game.canvas.getBoundingClientRect();
				const scale = rect.width / game.canvas.width;
				return {
					x: rect.left + (wx - cam.worldView.x) * cam.zoom * scale,
					y: rect.top + (wy - cam.worldView.y) * cam.zoom * scale,
				};
			}
			throw new Error(`"${needle}" not painted on line ${line}`);
		},
		{ line, needle },
	);
}

function lineCol(doc: string, pos: number) {
	const before = doc.slice(0, pos).split("\n");
	return { line: before.length - 1, col: (before.at(-1) ?? "").length };
}

/** Marks where the click landed so the review shot shows click vs caret. */
async function markClick(page: Page, p: { x: number; y: number }) {
	if (!TAKE_SHOTS) return;
	await page.evaluate(({ x, y }) => {
		const dot = document.createElement("div");
		dot.dataset.clickMark = "1";
		Object.assign(dot.style, {
			position: "fixed",
			left: `${x - 4}px`,
			top: `${y - 4}px`,
			width: "8px",
			height: "8px",
			borderRadius: "50%",
			background: "rgba(220, 30, 60, 0.85)",
			pointerEvents: "none",
			zIndex: "9999",
		});
		document.body.appendChild(dot);
	}, p);
}

async function clearClickMarks(page: Page) {
	await page.evaluate(() => {
		for (const el of document.querySelectorAll("[data-click-mark]"))
			el.remove();
	});
}

test("enchanted markdown: a click lands the caret on the glyph that was clicked", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));

	await openWorld(page);
	await enterFile(page, "docs/models.md");
	const doc = (await state(page))?.doc ?? "";
	const lines = doc.split("\n");
	expect(lines[0]).toBe("# Data models");
	// Park the caret far from the lines under test so they render enchanted.
	await page.keyboard.press("ControlOrMeta+End");
	await page.waitForTimeout(300);
	await page.keyboard.press("ControlOrMeta+Home");
	await page.keyboard.press("ArrowDown");
	await page.waitForTimeout(300);

	const cases: { line: number; needle: string; col: number }[] = [
		// Inline code: the backticks aren't painted.
		{
			line: 2,
			needle: "is the one",
			col: lines[2]?.indexOf("is the one") ?? -1,
		},
		// Heading: the `## ` isn't painted and the glyphs are wider.
		{ line: 4, needle: "Fields", col: lines[4]?.indexOf("Fields") ?? -1 },
		// List item: a dot replaces `- `, then inline code.
		{ line: 6, needle: "plain", col: lines[6]?.indexOf("plain") ?? -1 },
	];
	let shot = 1;
	for (const c of cases) {
		expect(c.col).toBeGreaterThan(0);
		const p = await paintedGlyphPoint(page, c.line, c.needle);
		await markClick(page, p);
		await page.mouse.click(p.x, p.y);
		await page.waitForTimeout(250);
		await shoot(page, `0${shot++}-md-click-${c.needle.split(" ")[0]}`);
		await clearClickMarks(page);
		const s = await state(page);
		expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({
			line: c.line,
			col: c.col,
		});
		// Park again so the next line is enchanted when clicked.
		await page.keyboard.press("ControlOrMeta+Home");
		await page.keyboard.press("ArrowDown");
		await page.waitForTimeout(250);
	}

	await leaveFile(page, false);
	expect(pageErrors).toEqual([]);
});

interface MonsterView {
	id: string;
	y: number;
	line: number | undefined;
}

function monsterViews(page: Page): Promise<MonsterView[]> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: {
					scene: {
						getScene(k: string): {
							monsters: { id: string; species: string }[];
							monsterSprites: Map<string, { y: number }>;
							monsterBobTweens: Map<string, { stop(): void }>;
							monsterLine?: (m: unknown) => number;
						};
					};
				};
			}
		).__cabnGame;
		const scene = game.scene.getScene("file");
		return scene.monsters.map((m) => ({
			id: m.id,
			// The hover bob moves the sprite up to a few px off its line.
			y: Math.round((scene.monsterSprites.get(m.id)?.y ?? Number.NaN) / 20),
			line: scene.monsterLine?.(m),
		}));
	});
}

test("monsters follow their code as lines are inserted and deleted above them", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));

	await openWorld(page);
	await enterFile(page, "config/settings.json");
	const before = await monsterViews(page);
	expect(before.length).toBeGreaterThan(0);
	await shoot(page, "04-monster-before-edit");

	// Two new lines at the very top (the caret starts at offset 0).
	await page.keyboard.press("ControlOrMeta+Home");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	await page.waitForTimeout(400);
	await shoot(page, "05-monster-after-two-newlines");
	let after = await monsterViews(page);
	for (const m of before) {
		const moved = after.find((a) => a.id === m.id);
		expect(moved?.y).toBe(m.y + 2);
		expect(moved?.line).toBe(m.y + 2);
	}

	// Deleting one of them in the spellbook moves the monster back up a line.
	await page.keyboard.press("Alt+KeyQ");
	await expect.poll(async () => (await state(page))?.mode).toBe("editor");
	await expect(page.locator(".cm-content")).toBeFocused();
	// Past CodeMirror's 500ms history grouping delay, so the Backspace is its
	// own undo step instead of merging into the Enter it deletes.
	await page.waitForTimeout(600);
	await page.keyboard.press("Backspace");
	await page.waitForTimeout(200);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await page.waitForTimeout(400);
	after = await monsterViews(page);
	for (const m of before) {
		const moved = after.find((a) => a.id === m.id);
		expect(moved?.y).toBe(m.y + 1);
	}
	await shoot(page, "06-monster-after-spellbook-backspace");

	// Undo in the file view restores the second line — and the monster.
	await caretFocused(page);
	const linesBeforeUndo = (await state(page))?.doc?.split("\n").length ?? 0;
	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(async () => (await state(page))?.doc?.split("\n").length)
		.toBe(linesBeforeUndo + 1);
	await page.waitForTimeout(400);
	after = await monsterViews(page);
	for (const m of before) {
		expect(after.find((a) => a.id === m.id)?.y).toBe(m.y + 2);
	}

	await leaveFile(page, true);
	expect(pageErrors).toEqual([]);
});
