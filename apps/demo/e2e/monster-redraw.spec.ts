import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

// 2026-09-28 monster redraw: the five legacy species' new sprites orbit
// without errors, and fixing a file plays the hit flash + three-frame defeat
// poof (not just the old fade) before the sprite goes away.
// CABN_REVIEW_SHOTS=1 writes review shots to
// assets/generated/review/monster-redraw/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"monster-redraw",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalId: string | null;
	defeated: number;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): {
						mode: string;
						activeWorldBase: string | null;
						playerPos: { x: number; y: number };
						focusedPortalPreview: { portalId: string } | null;
						defeatedMonsterIds: string[];
					};
				};
			}
		).__cabnStore;
		const s = store?.getState();
		return s
			? {
					mode: s.mode,
					activeWorldBase: s.activeWorldBase,
					playerPos: s.playerPos,
					focusedPortalId: s.focusedPortalPreview?.portalId ?? null,
					defeated: s.defeatedMonsterIds.length,
				}
			: undefined;
	});
}

async function holdKeys(page: Page, keys: string[], ms: number) {
	for (const k of keys) await page.keyboard.down(k);
	await page.waitForTimeout(ms);
	for (const k of keys) await page.keyboard.up(k);
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
		await holdKeys(page, keys, 150);
	}
	throw new Error("walkToward timed out");
}

async function enterSampleWorld(page: Page) {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await state(page))?.activeWorldBase, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(1500);
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
	await page.waitForTimeout(400);
}

async function walkToPortal(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focusedPortalId, { timeout: 20_000 })
		.toBe(portalId);
	let last = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	for (let i = 0; i < 40; i++) {
		await page.waitForTimeout(150);
		const now = (await state(page))?.playerPos ?? last;
		if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return now;
		last = now;
	}
	return last;
}

/** Steps south of the arch so it and its orbit sit mid-clip; returns the arch's offset from the player (≈ canvas centre). */
async function standBelowPortal(page: Page, portalId: string) {
	const arch = await walkToPortal(page, portalId);
	await walkToward(page, { x: arch.x, y: arch.y + 190 }, 12);
	await page.waitForTimeout(600);
	const at = (await state(page))?.playerPos ?? arch;
	return { x: arch.x - at.x, y: arch.y - at.y };
}

type Clip = { x: number; y: number; width: number; height: number };

async function clipAround(
	page: Page,
	offset: { x: number; y: number },
	w: number,
	h: number,
): Promise<Clip | null> {
	const box = await page.locator("canvas").first().boundingBox();
	if (!box) return null;
	const cx = box.x + box.width / 2 + offset.x;
	const cy = box.y + box.height / 2 + offset.y;
	return {
		x: Math.max(box.x, cx - w / 2),
		y: Math.max(box.y, cy - h / 2),
		width: w,
		height: h,
	};
}

/** The in-file monster is ~20px on screen — nearest-neighbour blow-up so the review strip shows the actual frames. */
function upscale(src: PNG, k: number): PNG {
	const out = new PNG({ width: src.width * k, height: src.height * k });
	for (let y = 0; y < out.height; y++) {
		for (let x = 0; x < out.width; x++) {
			const si = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
			const di = (y * out.width + x) * 4;
			src.data.copy(out.data, di, si, si + 4);
		}
	}
	return out;
}

function stitch(rows: PNG[][], gutter = 6): PNG {
	const cell = rows[0]?.[0] as PNG;
	const cols = Math.max(...rows.map((r) => r.length));
	const out = new PNG({
		width: cell.width * cols + gutter * (cols - 1),
		height: cell.height * rows.length + gutter * (rows.length - 1),
	});
	out.data.fill(0x32);
	rows.forEach((row, r) => {
		row.forEach((shot, c) => {
			PNG.bitblt(
				shot,
				out,
				0,
				0,
				Math.min(shot.width, cell.width),
				Math.min(shot.height, cell.height),
				c * (cell.width + gutter),
				r * (cell.height + gutter),
			);
		});
	});
	return out;
}

async function save(name: string, png: PNG) {
	await mkdir(SHOTS_DIR, { recursive: true });
	await writeFile(join(SHOTS_DIR, `${name}.png`), PNG.sync.write(png));
}

function collectErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	page.on("pageerror", (err) => errors.push(err.message));
	return errors;
}

// Legacy species in the sample world (see monsters.spec.ts's SPECIES_SWAP):
// ouroboros + wisp share gardeners.ts, gremlin utils.py, rot-sprite
// settings.json, warded-mimic legacy-notes.txt.
const ORBIT_PORTALS = [
	"src/routes/gardeners.ts",
	"lib/utils.py",
	"config/settings.json",
	"data/legacy-notes.txt",
] as const;

test("redrawn monsters orbit their arches by day and night", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	const times = TAKE_SHOTS ? (["day", "night"] as const) : (["day"] as const);
	for (const tod of times) {
		await setTimeOfDay(page, tod);
		const rows: PNG[][] = [];
		for (const portalId of ORBIT_PORTALS) {
			const offset = await standBelowPortal(page, portalId);
			if (!TAKE_SHOTS) continue;
			const clip = await clipAround(
				page,
				{ x: offset.x, y: offset.y + 20 },
				360,
				300,
			);
			if (!clip) continue;
			const row: PNG[] = [];
			for (let i = 0; i < 3; i++) {
				if (i > 0) await page.waitForTimeout(1900);
				row.push(PNG.sync.read(await page.screenshot({ clip })));
			}
			rows.push(row);
		}
		if (TAKE_SHOTS && rows.length) await save(`orbit-${tod}`, stitch(rows));
	}
	expect(errors).toEqual([]);
});

test("fixing the file plays the gremlin's defeat poof", async ({ page }) => {
	test.setTimeout(120_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	await walkToPortal(page, "lib/utils.py");
	await page.waitForTimeout(600);
	await holdKeys(page, ["Enter"], 150);
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await page.waitForTimeout(1200);

	// Records every texture the in-file gremlin shows until it's destroyed,
	// and where it sits on screen for the review clip.
	const where = await page.evaluate(() => {
		type Spr = {
			x: number;
			y: number;
			active: boolean;
			texture: { key: string };
			getData(k: string): unknown;
		};
		const w = window as unknown as {
			__cabnGame: {
				scene: {
					getScene(k: string): {
						monsterSprites: Map<string, Spr>;
						cameras: {
							main: { scrollX: number; scrollY: number; zoom: number };
						};
					};
				};
			};
			__seen: string[];
		};
		const scene = w.__cabnGame.scene.getScene("file");
		const sprite = [...scene.monsterSprites.values()].find(
			(s) => s.getData("monsterDrawnSpecies") === "gremlin",
		);
		if (!sprite) return null;
		w.__seen = [];
		const tick = () => {
			const key = sprite.texture.key;
			if (w.__seen[w.__seen.length - 1] !== key) w.__seen.push(key);
			if (sprite.active) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		const cam = scene.cameras.main;
		return {
			x: (sprite.x - cam.scrollX) * cam.zoom,
			y: (sprite.y - cam.scrollY) * cam.zoom,
		};
	});
	expect(where).not.toBeNull();

	const defeatedBefore = (await state(page))?.defeated ?? 0;
	await page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore: {
					getState(): {
						activeFileState: {
							doc: { length: number; toString(): string };
							update(spec: unknown): { state: unknown };
						};
						setActiveFileState(s: unknown): void;
					};
				};
			}
		).__cabnStore.getState();
		const buf = store.activeFileState;
		const fixed = buf.doc
			.toString()
			.replace(".append(record\n", ".append(record)\n");
		store.setActiveFileState(
			buf.update({ changes: { from: 0, to: buf.doc.length, insert: fixed } })
				.state,
		);
	});

	const box = await page.locator("canvas").first().boundingBox();
	const clip =
		box && where
			? {
					x: Math.max(box.x, box.x + where.x - 40),
					y: Math.max(box.y, box.y + where.y - 34),
					width: 80,
					height: 68,
				}
			: null;
	const frames: PNG[] = [];
	if (TAKE_SHOTS && clip)
		frames.push(PNG.sync.read(await page.screenshot({ clip })));
	await page.keyboard.press("ControlOrMeta+s");
	if (TAKE_SHOTS && clip) {
		for (let i = 0; i < 7; i++) {
			frames.push(PNG.sync.read(await page.screenshot({ clip })));
			await page.waitForTimeout(40);
		}
	}
	await expect
		.poll(async () => (await state(page))?.defeated)
		.toBe(defeatedBefore + 1);
	await page.waitForTimeout(800);
	const seen = await page.evaluate(
		() => (window as unknown as { __seen: string[] }).__seen,
	);
	expect(seen).toEqual(
		expect.arrayContaining([
			"monster-gremlin-hit",
			"monster-gremlin-defeat0",
			"monster-gremlin-defeat1",
			"monster-gremlin-defeat2",
		]),
	);
	if (TAKE_SHOTS && frames.length)
		await save("defeat-sequence", stitch([frames.map((f) => upscale(f, 4))]));
	expect(errors).toEqual([]);
});
