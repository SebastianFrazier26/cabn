import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { expect, test } from "./cspGuard";

// 2026-09-28 art polish 2: the paler wisp, poof-only defeats, pet night
// glow, the ferret redraw, the warm fountain and the root clearing.
// CABN_REVIEW_SHOTS=1 writes shots to assets/generated/review/art-polish-2/,
// prefixed with CABN_REVIEW_PREFIX (default "after").

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"art-polish-2",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PREFIX = process.env.CABN_REVIEW_PREFIX ?? "after";
const FAKE_KEY = "sk-test-not-a-real-key-000000";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalId: string | null;
	defeated: number;
	petNpc: { pos: { x: number; y: number } } | null;
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
						petNpc: { pos: { x: number; y: number } } | null;
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
					petNpc: s.petNpc,
				}
			: undefined;
	});
}

async function storeCall(page: Page, method: string, ...args: unknown[]) {
	await page.evaluate(
		({ method, args }) => {
			const store = (
				window as unknown as {
					__cabnStore: {
						getState(): Record<string, (...a: unknown[]) => void>;
					};
				}
			).__cabnStore;
			store.getState()[method]?.(...args);
		},
		{ method, args },
	);
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
	await storeCall(page, "setTimeOfDayOverride", tod);
	await page.waitForTimeout(800);
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

type Clip = { x: number; y: number; width: number; height: number };

/** A clip centred on a world point, assuming the camera is centred on the player at zoom `zoom`. */
async function clipAt(
	page: Page,
	world: { x: number; y: number },
	w: number,
	h: number,
	zoom = 1,
): Promise<Clip | null> {
	const box = await page.locator("canvas").first().boundingBox();
	const pos = (await state(page))?.playerPos;
	if (!box || !pos) return null;
	const cx = box.x + box.width / 2 + (world.x - pos.x) * zoom;
	const cy = box.y + box.height / 2 + (world.y - pos.y) * zoom;
	const x = Math.min(Math.max(box.x, cx - w / 2), box.x + box.width - w);
	const y = Math.min(Math.max(box.y, cy - h / 2), box.y + box.height - h);
	return { x, y, width: w, height: h };
}

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
	await writeFile(
		join(SHOTS_DIR, `${PREFIX}-${name}.png`),
		PNG.sync.write(png),
	);
}

async function grab(page: Page, clip: Clip | null): Promise<PNG | null> {
	if (!clip) return null;
	return PNG.sync.read(await page.screenshot({ clip }));
}

function collectErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	page.on("pageerror", (err) => errors.push(err.message));
	return errors;
}

/** World-space position of the first world-scene sprite whose texture key contains `needle`. */
function spritePos(page: Page, needle: string) {
	return page.evaluate((n) => {
		type Obj = { x: number; y: number; texture?: { key: string } };
		const w = window as unknown as {
			__cabnGame: {
				scene: { getScene(k: string): { children: { list: Obj[] } } };
			};
		};
		const hit = w.__cabnGame.scene
			.getScene("world")
			.children.list.find((o) => o.texture?.key.includes(n));
		return hit ? { x: hit.x, y: hit.y } : null;
	}, needle);
}

function setZoom(page: Page, zoom: number) {
	return page.evaluate((z) => {
		(
			window as unknown as {
				__cabnGame: {
					scene: {
						getScene(k: string): {
							cameras: { main: { setZoom(z: number): void } };
						};
					};
				};
			}
		).__cabnGame.scene
			.getScene("world")
			.cameras.main.setZoom(z);
	}, zoom);
}

test("the wisp reads by day and night", async ({ page }) => {
	test.setTimeout(120_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	const arch = await walkToPortal(page, "src/routes/gardeners.ts");
	await walkToward(page, { x: arch.x, y: arch.y + 190 }, 12);
	await page.waitForTimeout(600);
	expect(await spritePos(page, "wisp")).not.toBeNull();
	if (TAKE_SHOTS) {
		for (const tod of ["day", "night"] as const) {
			await setTimeOfDay(page, tod);
			const row: PNG[] = [];
			for (let i = 0; i < 4; i++) {
				if (i > 0) await page.waitForTimeout(1400);
				const wisp = await spritePos(page, "wisp");
				const shot =
					wisp && (await grab(page, await clipAt(page, wisp, 90, 70)));
				if (shot) row.push(upscale(shot, 3));
			}
			if (row.length) await save(`wisp-${tod}`, stitch([row]));
		}
	}
	expect(errors).toEqual([]);
});

test("a fixed monster leaves with the poof alone", async ({ page }) => {
	test.setTimeout(120_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	await walkToPortal(page, "lib/utils.py");
	await page.waitForTimeout(600);
	await holdKeys(page, ["Enter"], 150);
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await page.waitForTimeout(1200);

	// Watches the file scene every frame for any text object saying "Fixed!"
	// and for stray gold sparkle circles, until the gremlin is gone.
	const where = await page.evaluate(() => {
		type Obj = { type: string; text?: string; active: boolean };
		type Spr = {
			x: number;
			y: number;
			active: boolean;
			getData(k: string): unknown;
		};
		const w = window as unknown as {
			__cabnGame: {
				scene: {
					getScene(k: string): {
						monsterSprites: Map<string, Spr>;
						children: { list: Obj[] };
						cameras: {
							main: { scrollX: number; scrollY: number; zoom: number };
						};
					};
				};
			};
			__oldFx: string[];
		};
		const scene = w.__cabnGame.scene.getScene("file");
		const sprite = [...scene.monsterSprites.values()].find(
			(s) => s.getData("monsterDrawnSpecies") === "gremlin",
		);
		if (!sprite) return null;
		w.__oldFx = [];
		const tick = () => {
			for (const o of scene.children.list) {
				if (o.type === "Text" && o.text === "Fixed!") w.__oldFx.push("text");
				if (o.type === "Arc") w.__oldFx.push("sparkle");
			}
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
	if (TAKE_SHOTS && frames.length)
		await save("defeat-sequence", stitch([frames.map((f) => upscale(f, 4))]));
	if (PREFIX !== "before") {
		const oldFx = await page.evaluate(
			() => (window as unknown as { __oldFx: string[] }).__oldFx,
		);
		expect(oldFx).toEqual([]);
	}
	expect(errors).toEqual([]);
});

const PETS = [
	"anthropic",
	"openai",
	"gemini",
	"ollama",
	"qwen",
	"deepseek",
] as const;

test("pets stay readable at night", async ({ page }) => {
	test.setTimeout(180_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	const start = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await walkToward(page, { x: start.x + 90, y: start.y + 40 }, 12);
	const rows: Record<"day" | "night", PNG[]> = { day: [], night: [] };
	for (const provider of PETS) {
		if (provider !== "ollama") {
			await page.evaluate(
				([p, k]) => sessionStorage.setItem(`cabn:pet-key:${p}`, k),
				[provider, FAKE_KEY] as const,
			);
		}
		await storeCall(page, "setPetProvider", provider);
		await expect
			.poll(async () => (await state(page))?.petNpc ?? null, {
				timeout: 10_000,
			})
			.not.toBeNull();
		const at = (await state(page))?.playerPos ?? start;
		await walkToward(page, { x: at.x + 30, y: at.y }, 8);
		await page.waitForTimeout(900);
		const pet = (await state(page))?.petNpc;
		if (!TAKE_SHOTS || !pet) continue;
		for (const tod of ["day", "night"] as const) {
			await setTimeOfDay(page, tod);
			const shot = await grab(page, await clipAt(page, pet.pos, 110, 80));
			if (shot) rows[tod].push(upscale(shot, 3));
		}
		await setTimeOfDay(page, "day");
	}
	if (TAKE_SHOTS) {
		for (const tod of ["day", "night"] as const)
			if (rows[tod].length) await save(`pets-${tod}`, stitch([rows[tod]]));
	}
	await storeCall(page, "setPetProvider", null);
	expect(errors).toEqual([]);
});

test("fountain close-up and the root clearing, day and night", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);
	if (TAKE_SHOTS) {
		// Root clearing, zoomed out so the whole arch ring fits. Day only: the
		// night grade is a viewport-sized screen-space layer that never
		// expects a zoomed camera, so a zoomed night shot is not what a player
		// sees (and the layout is the same at night).
		await setTimeOfDay(page, "day");
		await setZoom(page, 0.55);
		await page.waitForTimeout(600);
		const shot = await grab(page, { x: 0, y: 0, width: 1280, height: 800 });
		if (shot) await save("root-clearing-day", shot);
		await setZoom(page, 1);
	}
	await walkToPortal(page, "lib/utils.py");
	const fountain = await spritePos(page, "world-fountain");
	expect(fountain).not.toBeNull();
	if (TAKE_SHOTS && fountain) {
		await walkToward(page, { x: fountain.x + 70, y: fountain.y + 30 }, 12);
		await page.waitForTimeout(600);
		const row: PNG[] = [];
		for (const tod of ["day", "night"] as const) {
			await setTimeOfDay(page, tod);
			const shot = await grab(page, await clipAt(page, fountain, 200, 150));
			if (shot) row.push(upscale(shot, 2));
		}
		if (row.length) await save("fountain-day-night", stitch([row]));
	}
	expect(errors).toEqual([]);
});
