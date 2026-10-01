import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
// Built output, not src: e2e isn't part of the demo's tsc project and runs
// under plain Node module resolution.
import { SpeciesSchema } from "../../../packages/world-schema/dist/index.js";
import { expect, test } from "./cspGuard";

// World monsters swirl around their portal arches (render/monsterOrbit.ts).
// Pixel-level orbit assertions would be flaky against the arch's own idle
// animation, so this checks the scene stays error-free with monsters on
// screen (and, once the schema lists them, the 2026-09-28 annotator species)
// — the orbit math and the sprite fallback chain have unit tests. CABN_REVIEW_SHOTS=1 writes review shots to
// assets/generated/review/monsters/; CABN_PERF=1 logs frame-time stats.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"monsters",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const MEASURE_PERF = process.env.CABN_PERF === "1";

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
	focusedPortalId: string | null;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): Omit<Snapshot, "focusedPortalId"> & {
						focusedPortalPreview: { portalId: string } | null;
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

/** walk-to-portal walks onto the portal's own anchor, so once the player stops moving their position is the arch's. */
async function settledPos(page: Page) {
	let last = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	for (let i = 0; i < 40; i++) {
		await page.waitForTimeout(150);
		const now = (await state(page))?.playerPos ?? last;
		if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return now;
		last = now;
	}
	return last;
}

/** Walks to the portal, then steps south of it so the arch and its orbit sit in the upper-middle of a clip. Returns the arch's offset from the player (≈ canvas centre). */
async function standBelowPortal(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await state(page))?.focusedPortalId, { timeout: 20_000 })
		.toBe(portalId);
	const arch = await settledPos(page);
	await walkToward(page, { x: arch.x, y: arch.y + 190 }, 12);
	await page.waitForTimeout(600);
	const at = (await state(page))?.playerPos ?? arch;
	return { x: arch.x - at.x, y: arch.y - at.y };
}

async function archClip(page: Page, archOffset: { x: number; y: number }) {
	const box = await page.locator("canvas").first().boundingBox();
	if (!box) return null;
	const w = 420;
	const h = 340;
	const cx = box.x + box.width / 2 + archOffset.x;
	const cy = box.y + box.height / 2 + archOffset.y + 20;
	return {
		x: Math.max(box.x, cx - w / 2),
		y: Math.max(box.y, cy - h / 2),
		width: w,
		height: h,
	};
}

async function shoot(
	page: Page,
	name: string,
	archOffset?: { x: number; y: number },
) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	const path = join(SHOTS_DIR, `${name}.png`);
	const clip = archOffset ? await archClip(page, archOffset) : null;
	await page.screenshot(clip ? { path, clip } : { path });
}

/** Quarter-orbit frames side by side — a single frame often catches a monster on the far half, hidden behind the arch, which is correct but useless for review. */
async function shootOrbitStrip(
	page: Page,
	name: string,
	archOffset: { x: number; y: number },
	frames = 4,
	gapMs = 2850,
) {
	if (!TAKE_SHOTS) return;
	const clip = await archClip(page, archOffset);
	if (!clip) return;
	const shots: PNG[] = [];
	for (let i = 0; i < frames; i++) {
		if (i > 0) await page.waitForTimeout(gapMs);
		shots.push(PNG.sync.read(await page.screenshot({ clip })));
	}
	const gutter = 6;
	const first = shots[0] as PNG;
	const out = new PNG({
		width: first.width * frames + gutter * (frames - 1),
		height: first.height,
	});
	out.data.fill(0x32);
	shots.forEach((shot, i) => {
		PNG.bitblt(
			shot,
			out,
			0,
			0,
			shot.width,
			shot.height,
			i * (first.width + gutter),
			0,
		);
	});
	await mkdir(SHOTS_DIR, { recursive: true });
	await writeFile(join(SHOTS_DIR, `${name}.png`), PNG.sync.write(out));
}

/** rAF deltas alone just read the display's vsync while under budget, so CPU busy time per frame (CDP TaskDuration/ScriptDuration) is what actually shows a change in per-frame cost. */
async function recordFrames(page: Page, drive: () => Promise<void>) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	const metric = async () => {
		const { metrics } = await cdp.send("Performance.getMetrics");
		const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
		return { task: get("TaskDuration"), script: get("ScriptDuration") };
	};
	const before = await metric();
	await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __rec: boolean };
		w.__frames = [];
		w.__rec = true;
		let last = performance.now();
		const tick = (now: number) => {
			w.__frames.push(now - last);
			last = now;
			if (w.__rec) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await drive();
	const frames = await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __rec: boolean };
		w.__rec = false;
		return w.__frames.slice(2);
	});
	const after = await metric();
	const sorted = [...frames].sort((a, b) => a - b);
	const pct = (p: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
	const mean = frames.reduce((a, b) => a + b, 0) / Math.max(frames.length, 1);
	return {
		frames: frames.length,
		meanMs: +mean.toFixed(2),
		p95Ms: +pct(0.95).toFixed(2),
		p99Ms: +pct(0.99).toFixed(2),
		over20ms: frames.filter((f) => f > 20).length,
		cpuTaskMsPerFrame: +(
			((after.task - before.task) * 1000) /
			Math.max(frames.length, 1)
		).toFixed(3),
		cpuScriptMsPerFrame: +(
			((after.script - before.script) * 1000) /
			Math.max(frames.length, 1)
		).toFixed(3),
	};
}

function collectErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	page.on("pageerror", (err) => errors.push(err.message));
	return errors;
}

test("world monsters swirl around their arches without errors", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const errors = collectErrors(page);
	await enterSampleWorld(page);

	if (MEASURE_PERF) {
		const rootWalk = await recordFrames(page, async () => {
			for (const keys of [
				["ArrowRight"],
				["ArrowDown"],
				["ArrowLeft"],
				["ArrowLeft"],
				["ArrowUp"],
				["ArrowUp"],
				["ArrowRight"],
				["ArrowRight"],
				["ArrowDown"],
			])
				await holdKeys(page, keys, 1100);
		});
		console.log(`PERF root-walk-10s ${JSON.stringify(rootWalk)}`);
	}

	const times = TAKE_SHOTS ? (["day", "night"] as const) : (["day"] as const);
	for (const tod of times) {
		await setTimeOfDay(page, tod);
		// Two monsters (a wisp and the ouroboros) share this arch.
		const offset = await standBelowPortal(page, "src/routes/gardeners.ts");
		await shootOrbitStrip(page, `multi-portal-${tod}`, offset);
		if (tod === "day" && MEASURE_PERF) {
			const idle = await recordFrames(page, () => page.waitForTimeout(10_000));
			console.log(`PERF gardeners-idle-10s ${JSON.stringify(idle)}`);
		}
		const single = await standBelowPortal(page, "lib/utils.py");
		await shootOrbitStrip(page, `gremlin-portal-${tod}`, single);
	}

	// Entry is still the arch's own hit target: walk back onto it, Enter, and
	// the file (with its in-file gremlin) opens.
	await page.evaluate(() => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: "lib/utils.py" });
	});
	await settledPos(page);
	await holdKeys(page, ["Enter"], 150);
	await expect.poll(async () => (await state(page))?.mode).toBe("file");
	await page.waitForTimeout(1200);
	await shoot(page, "file-view-gremlin");
	expect(errors).toEqual([]);
});

// Swaps the sample world's species for the 2026-09-28 annotator species so
// their sprites render in-world. validateManifest rejects species the schema
// doesn't list, so only accepted ones are swapped in (the enum is owned by
// the converter work, not this spec) and the test skips until any are.
const SPECIES_SWAP: Record<string, string> = {
	"rot-sprite": "imp",
	"warded-mimic": "magpie",
	gremlin: "skeleton",
	ghost: "bramble",
	"will-o-wisp": "shade",
};

test("annotator species render in the world", async ({ page }) => {
	test.setTimeout(120_000);
	const accepted = new Set<string>(SpeciesSchema.options);
	const swap = Object.fromEntries(
		Object.entries(SPECIES_SWAP).filter(([, to]) => accepted.has(to)),
	);
	test.skip(
		Object.keys(swap).length === 0,
		"@cabn/world-schema doesn't list the annotator species yet",
	);
	const errors = collectErrors(page);
	await page.route("**/worlds/sample/world.json", async (route) => {
		const res = await route.fetch();
		const world = await res.json();
		for (const m of world.monsters) m.species = swap[m.species] ?? m.species;
		await route.fulfill({ response: res, json: world });
	});
	await enterSampleWorld(page);
	for (const [portalId, name] of [
		["src/routes/gardeners.ts", "shade"],
		["lib/utils.py", "skeleton"],
		["config/settings.json", "imp"],
		["data/legacy-notes.txt", "magpie"],
		["src/routes/health.ts", "bramble"],
	] as const) {
		const offset = await standBelowPortal(page, portalId);
		await shootOrbitStrip(page, `species-${name}`, offset);
	}
	expect(errors).toEqual([]);
});
