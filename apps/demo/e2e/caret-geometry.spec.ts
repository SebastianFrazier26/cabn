import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";
// Built output, not src: e2e isn't part of the demo's tsc project and runs
// under plain Node module resolution (see monsters.spec.ts's world-schema
// import for the same pattern). Importing the pure formula rather than
// hardcoding an expected width in this test is what makes it an actual
// regression guard on FileScene's caretGeometry call, not just a loose
// "not too wide" sanity check both the old and new geometry would pass.
import { caretGeometry } from "../../../packages/engine/dist/systems/caretMotion.js";

// Pixel-level regression for the file view's inline caret (2026-09-29: it
// used to sit on top of the glyph beside a clicked boundary instead of in
// the gap before/after it — see systems/caretMotion.ts's caretGeometry and
// FileScene's measureCharWidth for the actual fix). Runs at DPR 1 and 2, the
// two `deviceScaleFactor`s the task called out, against the same tab-indented
// JSON fixture file-caret.spec.ts already exercises for click/arrow
// behaviour. With CABN_REVIEW_SHOTS=1 it writes before/after-style caret
// crops to assets/generated/review/caret-geometry/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"caret-geometry",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const FILE = "config/settings.json";

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

interface Geom {
	charWidth: number;
	zoom: number;
	worldViewX: number;
	worldViewY: number;
	rectLeft: number;
	rectTop: number;
	scale: number;
}

function readGeom(page: Page): Promise<Geom> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: {
					canvas: HTMLCanvasElement;
					scene: {
						getScene(k: string): {
							charWidth: number;
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
			charWidth: scene.charWidth,
			zoom: cam.zoom,
			worldViewX: cam.worldView.x,
			worldViewY: cam.worldView.y,
			rectLeft: rect.left,
			rectTop: rect.top,
			scale: rect.width / game.canvas.width,
		};
	});
}

/** World -> CSS screen point, same mapping FileScene uses to park the caret's textarea (positionCaretInput). */
function toScreen(geom: Geom, worldX: number, worldY: number) {
	return {
		x: geom.rectLeft + (worldX - geom.worldViewX) * geom.zoom * geom.scale,
		y: geom.rectTop + (worldY - geom.worldViewY) * geom.zoom * geom.scale,
	};
}

function headOf(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			(
				window as unknown as {
					__cabnStore: {
						getState(): {
							activeFileState: { selection: { main: { head: number } } };
						};
					};
				}
			).__cabnStore.getState().activeFileState.selection.main.head,
	);
}

function docOf(page: Page): Promise<string> {
	return page.evaluate(() =>
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
}

async function shoot(page: Page, name: string, clip: PNG.PNGOptions["clip"]) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), clip });
}

/** Cells-before-column `col` (tabs count 4, like caretMotion's displayColumn) for a raw monospace line. */
function cellsBefore(text: string, col: number): number {
	let cells = 0;
	for (let i = 0; i < Math.min(col, text.length); i++)
		cells += text[i] === "\t" ? 4 : 1;
	return cells;
}

for (const dpr of [1, 2]) {
	test.describe(`caret geometry at DPR ${dpr}`, () => {
		test.use({
			viewport: { width: 1280, height: 800 },
			deviceScaleFactor: dpr,
		});

		test(`click lands exactly on the boundary and the caret paints in the inter-glyph gap (DPR ${dpr})`, async ({
			page,
		}) => {
			test.setTimeout(60_000);
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));
			await enterSampleFile(page);

			const doc = await docOf(page);
			const line = doc.split("\n")[2] ?? "";
			expect(line).toBe('\t\t"timezone": "UTC",');

			// Click the boundary between 'i' and 'm' in "timezone" (col 5: after \t\t"ti).
			const geom = await readGeom(page);
			const col = 5;
			const cells = cellsBefore(line, col);
			const clickWorldX = 64 + (cells + 0.25) * geom.charWidth;
			const clickPoint = toScreen(geom, clickWorldX, 2 * 20);
			await page.mouse.click(clickPoint.x, clickPoint.y);

			const lineFrom = doc.split("\n").slice(0, 2).join("\n").length + 1;
			await expect.poll(async () => (await headOf(page)) - lineFrom).toBe(col);

			// The caret's own math for where it painted this boundary.
			const boundaryWorldX = 64 + cells * geom.charWidth;
			const boundaryScreen = toScreen(geom, boundaryWorldX, 2 * 20);

			const clip = {
				x: Math.max(0, Math.round(boundaryScreen.x - 3 * geom.charWidth)),
				y: Math.max(0, Math.round(boundaryScreen.y - 12)),
				width: Math.round(6 * geom.charWidth),
				height: 24,
			};
			const shot = PNG.sync.read(await page.screenshot({ clip }));
			await shoot(page, `caret-dpr${dpr}`, clip);

			// PALETTE.gold (0xe99b33) never appears in plain code text, only in
			// the caret's own accent — so its x-extent is the caret's footprint,
			// uncontaminated by same-colour (ink) text pixels underneath it.
			let minX = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			for (let y = 0; y < shot.height; y++) {
				for (let x = 0; x < shot.width; x++) {
					const i = (shot.width * y + x) << 2;
					const r = shot.data[i];
					const g = shot.data[i + 1];
					const b = shot.data[i + 2];
					const isGold =
						Math.abs(r - 0xe9) < 30 &&
						Math.abs(g - 0x9b) < 30 &&
						Math.abs(b - 0x33) < 30;
					if (isGold) {
						minX = Math.min(minX, x);
						maxX = Math.max(maxX, x);
					}
				}
			}
			expect(minX).toBeLessThan(maxX);
			const physicalPxPerCss = shot.width / clip.width;
			const footprintCenterCss =
				clip.x + (minX + maxX + 1) / 2 / physicalPxPerCss;
			const footprintWidthCss = (maxX - minX + 1) / physicalPxPerCss;

			// Ties the render straight to caretGeometry's own formula — this is
			// what actually caught the regression: the old flat 6px gold cap
			// stayed under any charWidth-relative threshold even after halving
			// it, because it was never really proportional to charWidth to
			// begin with.
			const expectedGoldWidth =
				caretGeometry(geom.charWidth).capInnerHalfWidth * 2;
			expect(footprintWidthCss).toBeLessThanOrEqual(expectedGoldWidth + 1.5);
			// The caret's visual center sits within 1 CSS px of the exact
			// boundary math (pixelArt/roundPixels snaps both to the device grid).
			expect(
				Math.abs(footprintCenterCss - boundaryScreen.x),
			).toBeLessThanOrEqual(1);

			expect(errors).toEqual([]);
		});

		test(`arrow keys move the caret by exactly one column (DPR ${dpr})`, async ({
			page,
		}) => {
			test.setTimeout(60_000);
			await enterSampleFile(page);
			const doc = await docOf(page);
			const geom = await readGeom(page);
			const point = toScreen(geom, 64 + 10 * geom.charWidth, 2 * 20);
			await page.mouse.click(point.x, point.y);
			const lineFrom = doc.split("\n").slice(0, 2).join("\n").length + 1;
			const start = (await headOf(page)) - lineFrom;

			await page.keyboard.press("ArrowRight");
			expect((await headOf(page)) - lineFrom).toBe(start + 1);
			await page.keyboard.press("ArrowRight");
			expect((await headOf(page)) - lineFrom).toBe(start + 2);
			await page.keyboard.press("ArrowLeft");
			expect((await headOf(page)) - lineFrom).toBe(start + 1);

			await page.keyboard.press("ArrowDown");
			const afterDown = await headOf(page);
			const nextLineFrom = doc.split("\n").slice(0, 3).join("\n").length + 1;
			expect(afterDown).toBeGreaterThanOrEqual(nextLineFrom);
			await page.keyboard.press("ArrowUp");
			expect((await headOf(page)) - lineFrom).toBe(start + 1);
		});
	});
}
