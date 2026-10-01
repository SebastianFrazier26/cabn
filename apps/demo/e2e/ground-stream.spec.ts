import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { expect, test } from "./cspGuard";

// M10 stream-bake: with the ground field/cluster ground now baked around the
// camera instead of over the whole world up front (see
// docs/testing/2026-09-29-wide-pass.md Bug 1), the risk that fix introduces
// is pop-in — the streamer's load margin failing to stay ahead of the
// camera at real walking speed. This reuses world-bounds.spec.ts's own
// void-pixel check (same BACKGROUND_RGB, same "screen-edge block must be
// entirely non-void" logic) but samples it *while walking*, continuously,
// rather than only at rest — a margin that's merely wide enough for a
// stationary camera wouldn't catch a streamer that can't keep up on foot.

interface CabnStoreSnapshot {
	mode: string;
	playerPos: { x: number; y: number };
	activeWorldBase: string | null;
}

function state(page: Page): Promise<CabnStoreSnapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as { __cabnStore?: { getState(): CabnStoreSnapshot } }
		).__cabnStore;
		return store?.getState();
	});
}

async function holdKeys(page: Page, keys: string[], ms: number): Promise<void> {
	for (const key of keys) await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	for (const key of keys) await page.keyboard.up(key);
}

// game.ts's Phaser.Game backgroundColor — same colour world-bounds.spec.ts
// checks for, but an *exact* match here rather than its distance-30
// tolerance. That tolerance is fine at a literal empty corner with nothing
// else nearby; this test instead walks through a busy world where legitimate
// dark content (e.g. archPreviews.ts's file-preview panels, "#0d0a18", or a
// blended sky/atmosphere edge) can land within 30 of this colour and
// false-positive. An exact match still reliably catches genuine void: it's
// Phaser's literal, unblended per-frame clear colour, and nothing drawn on
// top of it lands on that exact value except by the coincidence a >=20px
// contiguous run below guards against.
const BACKGROUND_RGB = { r: 0x1f, g: 0x2a, b: 0x17 };
const VOID_COLOR_DISTANCE = 0;
/** A single incidentally-exact pixel (e.g. one dark sprite texel) is noise; only a run this long is credibly "nothing was drawn here". */
const MIN_VOID_RUN = 20;

function colorDistance(r: number, g: number, b: number): number {
	return Math.hypot(
		r - BACKGROUND_RGB.r,
		g - BACKGROUND_RGB.g,
		b - BACKGROUND_RGB.b,
	);
}

/** True if any pixel in a screen-edge strip (the side the camera is moving toward, where a lagging streamer would show void first) is void-coloured. */
function edgeHasVoid(
	png: PNG,
	side: "left" | "right" | "top" | "bottom",
	thickness = 12,
): boolean {
	const xs =
		side === "left"
			? range(0, thickness)
			: side === "right"
				? range(png.width - thickness, png.width)
				: range(0, png.width);
	const ys =
		side === "top"
			? range(0, thickness)
			: side === "bottom"
				? range(png.height - thickness, png.height)
				: range(0, png.height);
	let voidPixels = 0;
	for (const y of ys) {
		for (const x of xs) {
			const idx = (png.width * y + x) * 4;
			const r = png.data[idx] ?? 0;
			const g = png.data[idx + 1] ?? 0;
			const b = png.data[idx + 2] ?? 0;
			if (colorDistance(r, g, b) <= VOID_COLOR_DISTANCE) voidPixels++;
		}
	}
	return voidPixels >= MIN_VOID_RUN;
}

function range(start: number, end: number): number[] {
	return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

/**
 * A raw snapshot of just the Phaser canvas's own drawn pixels, via Phaser's
 * renderer (not `page.screenshot`/element `.screenshot()`, both of which
 * capture the *composited* page — the React HUD (toolbar, file-preview
 * docks, the minimap panel) sits on top of the canvas in the DOM and would
 * paint into any edge-strip check, false-positiving on its own dark panel
 * backgrounds long before any real ground/void pixel is involved).
 */
async function snapshotCanvas(page: Page): Promise<PNG> {
	const dataUrl = await page.evaluate(
		() =>
			new Promise<string>((resolve) => {
				const game = (
					window as unknown as {
						__cabnGame: {
							renderer: {
								snapshot: (cb: (image: { src: string }) => void) => void;
							};
						};
					}
				).__cabnGame;
				game.renderer.snapshot((image) => resolve(image.src));
			}),
	);
	const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
	return PNG.sync.read(Buffer.from(base64, "base64"));
}

async function farthestClusterPos(
	page: Page,
): Promise<{ x: number; y: number }> {
	return page.evaluate(async () => {
		const s = (
			window as unknown as {
				__cabnStore: {
					getState(): {
						activeWorldBase: string;
						playerPos: { x: number; y: number };
					};
				};
			}
		).__cabnStore.getState();
		const manifest = await (
			await fetch(`${s.activeWorldBase}world.json`)
		).json();
		const from = s.playerPos;
		let best = manifest.clusters[0].pos;
		let bestDist = -1;
		for (const c of manifest.clusters as { pos: { x: number; y: number } }[]) {
			const d = Math.hypot(c.pos.x - from.x, c.pos.y - from.y);
			if (d > bestDist) {
				bestDist = d;
				best = c.pos;
			}
		}
		return best;
	});
}

async function setDay(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Day" }).click();
	await page.waitForTimeout(500);
}

// worldChunkGrid.ts's WORLD_CHUNK_SIZE_PX — a shared, stable grid constant
// (groundField.ts, sceneryBaker.ts and pathBaker.ts all key off it), not a
// per-test magic number. Not imported directly: e2e specs only ever reach
// the engine through the built demo bundle (see this file's own `state()`
// and world-bounds.spec.ts), never `@cabn/engine` itself.
const CHUNK_SIZE_PX = 512;
/**
 * How much slack to give the streamer's own per-frame budget (WorldScene.ts's
 * GROUND_STREAM_BUDGET_MS/MAX_CHUNKS_PER_FRAME) before a chunk still outside
 * the loaded set counts as a real gap rather than one frame's worth of
 * catch-up — one chunk's width. This shrinks the *radius* read live from the
 * scene (see sceneStreamSample's `loadRadius`), not a flat rectangular
 * margin added to the camera's view rect: the streamer's own candidate
 * window (worldChunkGrid.ts's worldChunkCandidatesNear) is a circle around
 * the camera center, and a view-rect-plus-flat-margin box reaches
 * meaningfully farther than that circle at its own diagonal corners — box
 * coverage at a generous-looking margin still intermittently demanded chunks
 * the real streamer was never going to load, because they were genuinely
 * outside its circular loadRadius.
 */
const COVERAGE_RADIUS_SHRINK_PX = CHUNK_SIZE_PX;
/** Perpendicular offset from a path's centerline used to find a "definitely not path" control pixel nearby — bigger than the ribbon's own half-width plus edge-scenery's path clearance (EDGE_SCENERY_PATH_HALF_WIDTH=20 + its clearance=14 in WorldScene.ts/edgeScenery.ts), small enough to likely still land in the same screen-visible area. */
const PATH_CONTROL_OFFSET_PX = 90;
/** A pixel block's inset from a path/control point — several pixels so a single stray anti-aliased edge pixel can't decide the sample either way. */
const SAMPLE_BLOCK = 3;

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface PathSamplePoint {
	/** Screen-space (canvas pixel) coordinates. */
	onPath: { x: number; y: number };
	control: { x: number; y: number };
}

interface StreamGeometrySample {
	worldView: Rect;
	cameraCenter: { x: number; y: number };
	/** WorldScene's own `streamLoadRadiusPx()` — the exact circular radius its streamers use, read live rather than recomputed independently (see COVERAGE_RADIUS_SHRINK_PX's doc comment). */
	loadRadius: number;
	/** Null when no currently-visible path segment has room for a same-view control point — the walk loop just skips the path assertion that iteration (see its own "sampled" counter requiring at least one real sample over the whole walk, not every iteration). */
	pathSample: PathSamplePoint | null;
	/** Every chunk key edgeSceneryStreamer currently considers loaded (baked or checked-empty — see sceneryBaker.ts's own doc comment on why a chunk with nothing in it still counts as loaded). */
	loadedEdgeChunkKeys: string[];
	/** Total scenery items across every chunk current loaded — plumbing coverage alone (a key existing) doesn't prove anything actually got planned there. */
	totalEdgeSceneryItems: number;
}

/**
 * Pulls everything ground-stream's path/edge-scenery checks need out of the
 * live WorldScene in one evaluate call: the camera's current view (for the
 * chunk-coverage check below), a path point currently on screen paired with
 * a same-screen "definitely not on a path" control point (for the pixel
 * check), and the edge-scenery streamer's own loaded-chunk bookkeeping.
 * Reaches private WorldScene fields via a cast, the same way
 * clearing-fit.spec.ts and world-bounds.spec.ts already do — TypeScript's
 * `private` has no runtime effect, and this is still the scene's own
 * geometry, not a value the test recomputes independently.
 */
function sceneStreamSample(page: Page): Promise<StreamGeometrySample> {
	return page.evaluate((controlOffset: number) => {
		type Pos = { x: number; y: number };
		const scene = (
			window as unknown as {
				__cabnGame: { scene: { getScene(k: string): unknown } };
			}
		).__cabnGame.scene.getScene("world") as {
			cameras: { main: { worldView: Rect } };
			manifest: {
				clusters: { id: string; pos: Pos }[];
				paths: { from: string; to: string }[];
			};
			pathPolyline(
				path: { from: string; to: string },
				from: { pos: Pos },
				to: { pos: Pos },
			): Pos[];
			streamLoadRadiusPx(): number;
			edgeSceneryStreamer: { loadedKeys: Set<string> } | null;
			edgeSceneryLoadedItems: Map<string, unknown[]>;
		};

		const view = scene.cameras.main.worldView;
		const worldView = {
			x: view.x,
			y: view.y,
			width: view.width,
			height: view.height,
		};
		const cameraCenter = {
			x: worldView.x + worldView.width / 2,
			y: worldView.y + worldView.height / 2,
		};
		const loadRadius = scene.streamLoadRadiusPx();

		const clustersById = new Map(scene.manifest.clusters.map((c) => [c.id, c]));
		const inset = 40; // keep sample points off the very edge of the canvas
		const innerMinX = worldView.x + inset;
		const innerMaxX = worldView.x + worldView.width - inset;
		const innerMinY = worldView.y + inset;
		const innerMaxY = worldView.y + worldView.height - inset;
		const inView = (x: number, y: number) =>
			x >= innerMinX && x <= innerMaxX && y >= innerMinY && y <= innerMaxY;

		let pathSample: PathSamplePoint | null = null;
		outer: for (const path of scene.manifest.paths) {
			const from = clustersById.get(path.from);
			const to = clustersById.get(path.to);
			if (!from || !to) continue;
			const points = scene.pathPolyline(path, from, to);
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				if (!a || !b) continue;
				const mx = (a.x + b.x) / 2;
				const my = (a.y + b.y) / 2;
				if (!inView(mx, my)) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const len = Math.hypot(dx, dy) || 1;
				const nx = -dy / len;
				const ny = dx / len;
				for (const side of [1, -1]) {
					const cx = mx + nx * controlOffset * side;
					const cy = my + ny * controlOffset * side;
					if (!inView(cx, cy)) continue;
					pathSample = {
						onPath: { x: mx - worldView.x, y: my - worldView.y },
						control: { x: cx - worldView.x, y: cy - worldView.y },
					};
					break outer;
				}
			}
		}

		const loadedEdgeChunkKeys = scene.edgeSceneryStreamer
			? [...scene.edgeSceneryStreamer.loadedKeys]
			: [];
		let totalEdgeSceneryItems = 0;
		for (const items of scene.edgeSceneryLoadedItems.values())
			totalEdgeSceneryItems += items.length;

		return {
			worldView,
			cameraCenter,
			loadRadius,
			pathSample,
			loadedEdgeChunkKeys,
			totalEdgeSceneryItems,
		};
	}, PATH_CONTROL_OFFSET_PX);
}

/**
 * Every chunk key within `radius` of `center` — the same circular window
 * worldChunkGrid.ts's worldChunkCandidatesNear scans (chunk centers, not
 * corners, compared by straight-line distance), reproduced here rather than
 * imported (see this file's own note on why e2e specs never import
 * `@cabn/engine` directly) so the coverage check actually matches what the
 * streamer itself considers "close enough," not an approximation of it.
 */
function chunkKeysWithinRadius(
	center: { x: number; y: number },
	radius: number,
): string[] {
	const chunkRadius = Math.ceil(radius / CHUNK_SIZE_PX) + 1;
	const centerCol = Math.floor(center.x / CHUNK_SIZE_PX);
	const centerRow = Math.floor(center.y / CHUNK_SIZE_PX);
	const keys: string[] = [];
	for (
		let row = centerRow - chunkRadius;
		row <= centerRow + chunkRadius;
		row++
	) {
		for (
			let col = centerCol - chunkRadius;
			col <= centerCol + chunkRadius;
			col++
		) {
			const cx = col * CHUNK_SIZE_PX + CHUNK_SIZE_PX / 2;
			const cy = row * CHUNK_SIZE_PX + CHUNK_SIZE_PX / 2;
			if (Math.hypot(cx - center.x, cy - center.y) <= radius) {
				keys.push(`${col},${row}`);
			}
		}
	}
	return keys;
}

function samplePixel(png: PNG, x: number, y: number): [number, number, number] {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let dy = -SAMPLE_BLOCK; dy <= SAMPLE_BLOCK; dy++) {
		for (let dx = -SAMPLE_BLOCK; dx <= SAMPLE_BLOCK; dx++) {
			const px = Math.round(x) + dx;
			const py = Math.round(y) + dy;
			if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
			const idx = (png.width * py + px) * 4;
			r += png.data[idx] ?? 0;
			g += png.data[idx + 1] ?? 0;
			b += png.data[idx + 2] ?? 0;
			n++;
		}
	}
	return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
}

function pixelDistance(
	a: [number, number, number],
	b: [number, number, number],
): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test("walking to a far corner never shows unbaked ground at the leading screen edge", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/?e2e=1");
	await page.locator("canvas").first().waitFor({ state: "visible" });
	await page.waitForTimeout(1500);
	await setDay(page);

	// Into the world (same cabin the perf harness and world-bounds.spec both
	// use — see apps/demo/scripts/perf-measure.mjs's CABIN_POS.world0).
	const target = { x: 0, y: -480 };
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= 50) break;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		await holdKeys(page, keys, 150);
	}
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await state(page))?.activeWorldBase ?? null, {
			timeout: 10_000,
		})
		.not.toBeNull();
	await page.waitForTimeout(500);
	await setDay(page);

	const corner = await farthestClusterPos(page);

	const deadlineWalk = Date.now() + 30_000;
	let sampled = 0;
	let pathPixelSamples = 0;
	let maxEdgeSceneryItemsSeen = 0;
	while (Date.now() < deadlineWalk) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = corner.x - pos.x;
		const dy = corner.y - pos.y;
		if (Math.hypot(dx, dy) <= 60) break;
		const keys: string[] = [];
		let side: "left" | "right" | "top" | "bottom" = "right";
		if (Math.abs(dx) >= Math.abs(dy)) {
			keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
			side = dx > 0 ? "right" : "left";
		} else {
			keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
			side = dy > 0 ? "bottom" : "top";
		}
		await holdKeys(page, keys, 200);
		const png = await snapshotCanvas(page);
		expect(
			edgeHasVoid(png, side),
			`unbaked void at the ${side} edge while walking toward (${corner.x}, ${corner.y}), player currently at (${pos.x}, ${pos.y})`,
		).toBe(false);
		sampled++;

		// The margin chunk furthest from the direction of travel (a view
		// corner, usually) is the streamer's own lowest priority within its
		// per-frame budget (planStream's AHEAD_BONUS_PX in chunkStream.ts) — it
		// can lag the rest of the margin by a frame or two even though it's
		// well within loadRadius. Poll briefly for coverage to catch up rather
		// than demanding it land in the exact frame right after one holdKeys
		// burst; a margin still missing after this window is a real regression,
		// not a timing fluke.
		const coverageOk = (g: StreamGeometrySample) =>
			chunkKeysWithinRadius(
				g.cameraCenter,
				g.loadRadius - COVERAGE_RADIUS_SHRINK_PX,
			).every((key) => g.loadedEdgeChunkKeys.includes(key));
		let geometry = await sceneStreamSample(page);
		const coverageDeadline = Date.now() + 1000;
		while (Date.now() < coverageDeadline && !coverageOk(geometry)) {
			await page.waitForTimeout(50);
			geometry = await sceneStreamSample(page);
		}
		const expectedChunks = chunkKeysWithinRadius(
			geometry.cameraCenter,
			geometry.loadRadius - COVERAGE_RADIUS_SHRINK_PX,
		);
		const loaded = new Set(geometry.loadedEdgeChunkKeys);
		for (const key of expectedChunks) {
			expect(
				loaded.has(key),
				`edge-scenery chunk ${key} (within the streamer's own load radius, minus a ${COVERAGE_RADIUS_SHRINK_PX}px catch-up allowance) still hasn't streamed in a full second after walking toward (${corner.x}, ${corner.y}), player currently at (${pos.x}, ${pos.y})`,
			).toBe(true);
		}
		maxEdgeSceneryItemsSeen = Math.max(
			maxEdgeSceneryItemsSeen,
			geometry.totalEdgeSceneryItems,
		);

		// Re-snapshot: the coverage poll above may have let the camera drift a
		// little further (residual player velocity), so match the path-pixel
		// check's screen coordinates to a canvas frame taken at the same moment
		// as the geometry they came from, not the pre-poll `png` above.
		if (geometry.pathSample) {
			const pathPng = await snapshotCanvas(page);
			const onPath = samplePixel(
				pathPng,
				geometry.pathSample.onPath.x,
				geometry.pathSample.onPath.y,
			);
			const control = samplePixel(
				pathPng,
				geometry.pathSample.control.x,
				geometry.pathSample.control.y,
			);
			expect(
				pixelDistance(onPath, control),
				`path pixel at screen (${geometry.pathSample.onPath.x}, ${geometry.pathSample.onPath.y}) looks the same as bare field ${PATH_CONTROL_OFFSET_PX}px off the path's centerline — ribbon/stamp art hasn't streamed in yet`,
			).toBeGreaterThan(18);
			pathPixelSamples++;
		}
	}
	// The walk itself must actually have happened (and been sampled) for this
	// test to mean anything — a world small enough to start already inside
	// the load radius would make every check trivially true.
	expect(sampled).toBeGreaterThan(3);
	// At least one sample must have found a visible path to check against —
	// otherwise the pixel assertion above never ran at all.
	expect(pathPixelSamples).toBeGreaterThan(0);
	// And at least one loaded chunk along the way must have had real scenery
	// in it — chunk-key bookkeeping alone doesn't prove anything was planted.
	expect(maxEdgeSceneryItemsSeen).toBeGreaterThan(0);
});
