import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./cspGuard";

// The file view's inline caret end to end: click places a caret at an exact
// character, arrows move it, typing edits the store's shared buffer, Enter
// is a newline (monsters/arch are Alt+Enter or a click now), Cmd/Ctrl+S goes
// through the same save + re-annotation path as the spellbook (a fixed error
// defeats its monster, the override lands in localStorage), the spellbook
// opens on the same buffer and caret, and leaving with unsaved edits asks
// first. With CABN_REVIEW_SHOTS=1 it writes review screenshots to
// assets/generated/review/file-caret/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"file-caret",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const FILE = "config/settings.json";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	activePortalId: string | null;
	playerPos: { x: number; y: number };
	focusedPortalPreview: { portalId: string } | null;
	doc: string | null;
	anchor: number;
	head: number;
	dirty: boolean;
	fileLeavePrompt: boolean;
	defeatedMonsterIds: string[];
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		type Buf = {
			doc: { toString(): string; eq(o: unknown): boolean };
			selection: { main: { anchor: number; head: number } };
		};
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): Record<string, unknown> & {
						activeFileState: Buf | null;
						activeFileSavedDoc: unknown;
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
			activePortalId: s.activePortalId as string | null,
			playerPos: s.playerPos as { x: number; y: number },
			focusedPortalPreview: s.focusedPortalPreview as {
				portalId: string;
			} | null,
			doc: buf ? buf.doc.toString() : null,
			anchor: buf?.selection.main.anchor ?? -1,
			head: buf?.selection.main.head ?? -1,
			dirty: buf ? !buf.doc.eq(s.activeFileSavedDoc) : false,
			fileLeavePrompt: s.fileLeavePrompt as boolean,
			defeatedMonsterIds: s.defeatedMonsterIds as string[],
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
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
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

/** FileScene re-grabs keyboard focus for the caret on its next frame (after a dialog, the spellbook, a click). */
async function caretFocused(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		)
		.toBe("cabn-file-caret-input");
}

/** Screen point of the boundary before character `col` on 0-based `line`, from FileScene's own camera and measured glyph width. */
async function charPoint(page: Page, line: number, col: number) {
	return page.evaluate(
		({ line, col }) => {
			const game = (
				window as unknown as {
					__cabnGame: {
						canvas: HTMLCanvasElement;
						scene: {
							getScene(k: string): {
								charWidth: number;
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
			const store = (
				window as unknown as {
					__cabnStore: {
						getState(): {
							activeFileState: {
								doc: { line(n: number): { text: string } };
							};
						};
					};
				}
			).__cabnStore;
			const text = store.getState().activeFileState.doc.line(line + 1).text;
			let cells = 0;
			for (let i = 0; i < Math.min(col, text.length); i++)
				cells += text[i] === "\t" ? 4 : 1;
			const cam = scene.cameras.main;
			const rect = game.canvas.getBoundingClientRect();
			const scale = rect.width / game.canvas.width;
			// A quarter cell in, so it rounds to this boundary, not the next.
			const wx = 64 + (cells + 0.25) * scene.charWidth;
			const wy = line * 20;
			return {
				x: rect.left + (wx - cam.worldView.x) * cam.zoom * scale,
				y: rect.top + (wy - cam.worldView.y) * cam.zoom * scale,
			};
		},
		{ line, col },
	);
}

function lineCol(doc: string, pos: number) {
	const before = doc.slice(0, pos).split("\n");
	return { line: before.length - 1, col: (before.at(-1) ?? "").length };
}

test("file view caret: click, arrows, typing, Enter, save + re-annotate, spellbook sync, leave prompt", async ({
	page,
}) => {
	test.setTimeout(150_000);
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));

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

	await enterFile(page, FILE);
	const original = (await state(page))?.doc ?? "";
	expect(original.split("\n")[3]).toBe('\t\t"maxEntriesPerCrop": 500,');

	// I-beam over the text.
	const overText = await charPoint(page, 2, 4);
	await page.mouse.move(overText.x, overText.y);
	await expect
		.poll(() =>
			page.evaluate(() => document.querySelector("canvas")?.style.cursor),
		)
		.toBe("text");

	// Click an exact character: inside the tab-indented key on line 2 (0-based).
	const p = await charPoint(page, 2, 5);
	await page.mouse.click(p.x, p.y);
	let s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({ line: 2, col: 5 });
	await shoot(page, "01-click-caret");

	// Arrows move by character and line, holding the column.
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({ line: 2, col: 7 });
	await page.keyboard.press("ArrowDown");
	s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({ line: 3, col: 7 });
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1).line).toBe(1);
	await page.keyboard.press("End");
	s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({ line: 1, col: 16 });

	// Shift-select then type over the selection; undo restores it.
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowRight");
	for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
	s = await state(page);
	expect(
		(s?.doc ?? "").slice(
			Math.min(s?.anchor ?? 0, s?.head ?? 0),
			Math.max(s?.anchor ?? 0, s?.head ?? 0),
		),
	).toBe("harvest");
	await shoot(page, "02-shift-select");
	await page.keyboard.type("crop");
	s = await state(page);
	expect(s?.doc?.split("\n")[1]).toBe('\t"cropLog": {');
	expect(s?.dirty).toBe(true);
	await expect(page.getByTestId("cabn-file-save-state")).toContainText(
		"unsaved",
	);
	await shoot(page, "03-typed-unsaved");
	await page.keyboard.press("ControlOrMeta+z");
	s = await state(page);
	expect(s?.doc).toBe(original);
	expect(s?.dirty).toBe(false);

	// Enter inserts a newline (auto-indented), it no longer fights monsters.
	const rotLine = await charPoint(page, 3, 27);
	await page.mouse.click(rotLine.x, rotLine.y);
	await page.keyboard.press("Enter");
	s = await state(page);
	expect(s?.mode).toBe("file");
	expect(s?.doc?.split("\n")[4]).toBe("\t\t");
	expect(s?.doc?.split("\n").length).toBe(original.split("\n").length + 1);
	await page.keyboard.press("ControlOrMeta+z");
	expect((await state(page))?.doc).toBe(original);

	// Fix the trailing comma in place and save: the same save path as the
	// spellbook re-annotates and the rot-sprite on line 4 is defeated.
	const endOfLine3 = await charPoint(page, 3, 999);
	await page.mouse.click(endOfLine3.x + 40, endOfLine3.y);
	s = await state(page);
	expect(lineCol(s?.doc ?? "", s?.head ?? -1)).toEqual({ line: 3, col: 27 });
	await page.keyboard.press("Backspace");
	const fixed = original.replace("500,", "500");
	expect((await state(page))?.doc).toBe(fixed);
	const defeatedBefore = (await state(page))?.defeatedMonsterIds.length ?? 0;
	await page.keyboard.press("ControlOrMeta+s");
	await expect.poll(async () => (await state(page))?.dirty).toBe(false);
	await expect
		.poll(async () => (await state(page))?.defeatedMonsterIds.length)
		.toBe(defeatedBefore + 1);
	const persisted = await page.evaluate((file) => {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i) ?? "";
			if (!k.startsWith("cabn:save:")) continue;
			const save = JSON.parse(localStorage.getItem(k) ?? "{}");
			const o = save.fileOverrides?.[file];
			if (o) return o.content as string;
		}
		return null;
	}, FILE);
	expect(persisted).toBe(fixed);
	await page.waitForTimeout(700);
	await shoot(page, "04-saved-monster-defeated");

	// The spellbook opens on the same buffer at the same caret; its edits
	// come back to the page, still unsaved.
	const q = await charPoint(page, 2, 3);
	await page.mouse.click(q.x, q.y);
	const beforeBook = await state(page);
	await page.keyboard.press("Alt+KeyQ");
	await expect.poll(async () => (await state(page))?.mode).toBe("editor");
	await expect(page.locator(".cm-content")).toBeFocused();
	s = await state(page);
	expect(s?.head).toBe(beforeBook?.head);
	await page.keyboard.type("Z");
	await page.waitForTimeout(300);
	await shoot(page, "05-spellbook-same-caret");
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	s = await state(page);
	expect(s?.doc?.split("\n")[2]).toBe('\t\t"Ztimezone": "UTC",');
	expect(s?.head).toBe((beforeBook?.head ?? 0) + 1);
	expect(s?.dirty).toBe(true);
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		)
		.toBe("cabn-file-caret-input");
	await page.keyboard.type("!");
	expect((await state(page))?.doc?.split("\n")[2]).toBe(
		'\t\t"Z!timezone": "UTC",',
	);

	// Leaving with unsaved edits asks first; Keep writing stays, Discard leaves
	// and the saved (fixed) text is what the file reopens with.
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await state(page))?.fileLeavePrompt)
		.toBe(true);
	await shoot(page, "06-leave-prompt");
	await page.getByRole("button", { name: "Keep writing" }).click();
	s = await state(page);
	expect(s?.mode).toBe("file");
	expect(s?.fileLeavePrompt).toBe(false);
	await caretFocused(page);
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Discard" }).click();
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	await page.waitForTimeout(600);

	await enterFile(page, FILE);
	expect((await state(page))?.doc).toBe(fixed);
	// A clean file leaves on Esc straight away, as before.
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");

	if (TAKE_SHOTS) {
		// Markdown: the caret's line shows raw source, the rest stays enchanted.
		await page.waitForTimeout(600);
		await enterFile(page, "docs/models.md");
		const md = await charPoint(page, 2, 0);
		await page.mouse.click(md.x, md.y);
		await page.waitForTimeout(400);
		await shoot(page, "07-markdown-live-preview");
		await page.keyboard.press("Escape");
		await expect.poll(async () => (await state(page))?.mode).toBe("world");
	}

	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});

/** Stops (or restarts) Phaser's loop, so FileScene gets no frame to re-grab focus in. */
async function setLoopAsleep(page: Page, asleep: boolean) {
	await page.evaluate((asleep) => {
		const loop = (
			window as unknown as {
				__cabnGame: { loop: { sleep(): void; wake(): void } };
			}
		).__cabnGame.loop;
		if (asleep) loop.sleep();
		else loop.wake();
	}, asleep);
}

test("file view: an Esc right after a panel closes still leaves, with no frame in between", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));

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

	// The spellbook: closing it and pressing Esc before FileScene's next frame.
	await enterFile(page, FILE);
	await page.keyboard.press("Alt+KeyQ");
	await expect.poll(async () => (await state(page))?.mode).toBe("editor");
	await expect(page.locator(".cm-content")).toBeFocused();
	await setLoopAsleep(page, true);
	await page.keyboard.press("Escape");
	await expect(page.locator(".cabn-spellbook-frame")).toBeHidden();
	expect((await state(page))?.mode).toBe("file");
	await page.keyboard.press("Escape");
	await setLoopAsleep(page, false);
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");
	await page.waitForTimeout(600);

	// The orb (find): same, its input unmounting takes focus with it.
	await enterFile(page, FILE);
	await page.keyboard.press("ControlOrMeta+f");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as {
							__cabnStore: { getState(): { searchOpen: boolean } };
						}
					).__cabnStore.getState().searchOpen,
			),
		)
		.toBe(true);
	await setLoopAsleep(page, true);
	await page.keyboard.press("Escape");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as {
							__cabnStore: { getState(): { searchOpen: boolean } };
						}
					).__cabnStore.getState().searchOpen,
			),
		)
		.toBe(false);
	await page.keyboard.press("Escape");
	await setLoopAsleep(page, false);
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("world");

	expect(pageErrors).toEqual([]);
});
