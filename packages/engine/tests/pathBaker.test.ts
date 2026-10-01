import type Phaser from "phaser";
import { describe, expect, it } from "vitest";
import {
	PATH_BED_DISC_KEY,
	PATH_COBBLE_COUNT,
	PATH_EDGE_DISC_KEY,
	PATH_STAMP_COUNT,
	pathCobbleKey,
	pathStampKey,
} from "../src/assetPaths.js";
import {
	bakePathChunk,
	bakePathRibbonChunk,
	MAX_SAFE_RENDER_TEXTURE_PX,
	type PathSegment,
	planPathRibbonChunks,
	planPathStamps,
} from "../src/render/pathBaker.js";
import { WORLD_CHUNK_SIZE_PX } from "../src/render/worldChunkGrid.js";

// pathBaker.ts only ever type-imports "phaser" (`import type Phaser from
// "phaser"`), so unlike sceneryBaker.test.ts this file needs no `vi.mock` —
// a plain fake scene is enough.

interface DrawRecord {
	key: string;
	x: number;
	y: number;
	rotation: number;
}

class FakeImage {
	rotation = 0;
	constructor(readonly key: string) {}
	setRotation(r: number): this {
		this.rotation = r;
		return this;
	}
	destroy(): void {}
}

class FakeRenderTexture {
	draws: DrawRecord[] = [];
	constructor(
		readonly x: number,
		readonly y: number,
		readonly width: number,
		readonly height: number,
	) {}
	beginDraw(): void {}
	endDraw(): void {}
	batchDraw(image: FakeImage, x: number, y: number): void {
		this.draws.push({ key: image.key, x, y, rotation: image.rotation });
	}
	draw(image: FakeImage, x: number, y: number): void {
		this.batchDraw(image, x, y);
	}
	setDepth(): this {
		return this;
	}
	setTint(): this {
		return this;
	}
	destroy(): void {}
}

/** A fake `Phaser.Scene` exposing only what pathBaker.ts reads: texture sizes (`textures.get(key).getSourceImage()`), throwaway images (`make.image`) and RenderTextures (`add.renderTexture`) — recorded so a test can inspect exactly what a bake drew without a real canvas/WebGL context. */
function createFakeScene(
	sizes: Record<string, { width: number; height: number }>,
) {
	const rts: FakeRenderTexture[] = [];
	const scene = {
		textures: {
			get: (key: string) => ({
				getSourceImage: () => sizes[key] ?? { width: 32, height: 32 },
			}),
		},
		make: {
			image: ({ key }: { key: string }) => new FakeImage(key),
		},
		add: {
			renderTexture: (x: number, y: number, w: number, h: number) => {
				const rt = new FakeRenderTexture(x, y, w, h);
				rts.push(rt);
				return rt;
			},
		},
	};
	return { scene: scene as unknown as Phaser.Scene, rts };
}

function seg(
	id: string,
	from: { x: number; y: number },
	to: { x: number; y: number },
): PathSegment {
	return { id, from, to };
}

const STAMP_WIDTH = 32;
const STAMP_SIZES = Object.fromEntries(
	Array.from({ length: PATH_STAMP_COUNT }, (_, i) => [
		pathStampKey(i),
		{ width: STAMP_WIDTH, height: STAMP_WIDTH },
	]),
);

const RIBBON_SIZES = {
	[PATH_EDGE_DISC_KEY]: { width: 40, height: 40 },
	[PATH_BED_DISC_KEY]: { width: 24, height: 24 },
	...Object.fromEntries(
		Array.from({ length: PATH_COBBLE_COUNT }, (_, i) => [
			pathCobbleKey(i),
			{ width: 10, height: 10 },
		]),
	),
};

describe("planPathStamps / bakePathChunk (fallback dirt-stamp bake)", () => {
	it("indexes a stamp straddling a vertical chunk seam into both neighboring chunks, clipped to each chunk's own local origin", () => {
		// Zero-length segment (stampPointsAlongSegment's single-point branch, no
		// jitter) placed a few px off the x=512 seam — its footprint radius
		// (stampWidth * sqrt(2) / 2 ~= 22.6) reaches past the boundary on both
		// sides without also touching the y=512 row seam.
		const { scene, rts } = createFakeScene(STAMP_SIZES);
		const segments = [seg("seam", { x: 507, y: 300 }, { x: 507, y: 300 })];
		const { stamps, index } = planPathStamps(scene, segments);
		expect(stamps).toHaveLength(1);
		expect(new Set(index.keys())).toEqual(new Set(["0,0", "1,0"]));

		const chunkA = bakePathChunk(scene, 0, 0, "0,0", stamps, index);
		const chunkB = bakePathChunk(scene, 1, 0, "1,0", stamps, index);
		expect(chunkA?.draws).toEqual([
			{ key: stamps[0]?.key, x: 507, y: 300, rotation: 0 },
		]);
		// Chunk (1,0)'s own origin is x=512, so the same world point is negative
		// in its local space — still a valid batchDraw call, left for Phaser's
		// own RenderTexture to clip off-canvas at render time.
		expect(chunkB?.draws).toEqual([
			{ key: stamps[0]?.key, x: -5, y: 300, rotation: 0 },
		]);
		expect(rts).toHaveLength(2);
	});

	it("indexes a stamp sitting exactly on a chunk corner into all four neighboring chunks", () => {
		const { scene } = createFakeScene(STAMP_SIZES);
		const segments = [seg("corner", { x: 512, y: 512 }, { x: 512, y: 512 })];
		const { index } = planPathStamps(scene, segments);
		expect(new Set(index.keys())).toEqual(
			new Set(["0,0", "1,0", "0,1", "1,1"]),
		);
		for (const list of index.values()) expect(list).toEqual([0]);
	});

	it("produces no draws, and no RenderTexture at all, for a chunk the plan assigned nothing to", () => {
		const { scene, rts } = createFakeScene(STAMP_SIZES);
		const segments = [seg("far", { x: 0, y: 0 }, { x: 0, y: 0 })];
		const { stamps, index } = planPathStamps(scene, segments);
		const result = bakePathChunk(scene, 50, 50, "50,50", stamps, index);
		expect(result).toBeNull();
		expect(rts).toHaveLength(0);
	});

	it("every chunk's own draws are identical however many other chunks were baked first, or in what order — streamed chunks collectively cover exactly the plan's index, same as one whole-bounds bake would have", () => {
		const segments = [
			seg("diag", { x: 10, y: 10 }, { x: 2000, y: 1500 }),
			seg("spur", { x: 2000, y: 1500 }, { x: 2600, y: 1500 }),
		];
		const { scene: planScene } = createFakeScene(STAMP_SIZES);
		const { stamps, index } = planPathStamps(planScene, segments);
		const keys = [...index.keys()];
		expect(keys.length).toBeGreaterThan(3); // a real multi-chunk spread, not a degenerate single-chunk case

		const bakeAllInOrder = (order: string[]) => {
			const { scene } = createFakeScene(STAMP_SIZES);
			const draws = new Map<string, DrawRecord[]>();
			for (const key of order) {
				const [col, row] = key.split(",").map(Number);
				const rt = bakePathChunk(scene, col ?? 0, row ?? 0, key, stamps, index);
				draws.set(key, rt?.draws ?? []);
			}
			return draws;
		};

		const rowMajor = bakeAllInOrder([...keys].sort());
		const shuffled = bakeAllInOrder([...keys].reverse());
		for (const key of keys) {
			expect(shuffled.get(key), key).toEqual(rowMajor.get(key));
			// Every chunk's draw count matches exactly how many stamp indices the
			// pure plan assigned it — nothing dropped, nothing duplicated.
			expect(rowMajor.get(key)).toHaveLength(index.get(key)?.length ?? 0);
		}
	});

	it("never requests a chunk RenderTexture bigger than the fixed chunk size, regardless of how far a single segment spans", () => {
		const { scene } = createFakeScene(STAMP_SIZES);
		const segments = [seg("huge", { x: 0, y: 0 }, { x: 100_000, y: 0 })];
		const { stamps, index } = planPathStamps(scene, segments);
		const sampleKeys = [...index.keys()].slice(0, 5);
		expect(sampleKeys.length).toBeGreaterThan(0);
		const { scene: bakeScene, rts } = createFakeScene(STAMP_SIZES);
		for (const key of sampleKeys) {
			const [col, row] = key.split(",").map(Number);
			bakePathChunk(bakeScene, col ?? 0, row ?? 0, key, stamps, index);
		}
		expect(rts.length).toBe(sampleKeys.length);
		for (const rt of rts) {
			expect(rt.width).toBe(WORLD_CHUNK_SIZE_PX);
			expect(rt.height).toBe(WORLD_CHUNK_SIZE_PX);
			expect(rt.width).toBeLessThanOrEqual(MAX_SAFE_RENDER_TEXTURE_PX);
		}
	});
});

describe("planPathRibbonChunks / bakePathRibbonChunk (atmosphere-art ribbon bake)", () => {
	it("indexes a disc straddling a vertical chunk seam into both neighboring chunks and bakes each clipped to its own origin", () => {
		const { scene } = createFakeScene(RIBBON_SIZES);
		// A zero-length segment's discsAlong emits the same point twice (n=1,
		// i=0 and i=1) — both land in the same chunk pair, which is fine: the
		// index just carries two references to one position, same as a real
		// path whose edge-step happens to land two discs on top of each other.
		const segments = [seg("seam", { x: 507, y: 300 }, { x: 507, y: 300 })];
		const chunkPlan = planPathRibbonChunks(scene, segments);
		expect(new Set(chunkPlan.edgeIndex.keys())).toEqual(
			new Set(["0,0", "1,0"]),
		);
		expect(new Set(chunkPlan.bedIndex.keys())).toEqual(new Set(["0,0", "1,0"]));

		const chunkA = bakePathRibbonChunk(scene, 0, 0, "0,0", chunkPlan);
		const chunkB = bakePathRibbonChunk(scene, 1, 0, "1,0", chunkPlan);
		expect(chunkA).not.toBeNull();
		expect(chunkB).not.toBeNull();
		// 2 edge discs + 2 bed discs per chunk (the duplicate point above).
		expect(chunkA?.draws).toHaveLength(4);
		expect(chunkB?.draws).toHaveLength(4);
		for (const d of chunkA?.draws ?? []) expect(d.x).toBeCloseTo(507, 5);
		for (const d of chunkB?.draws ?? []) expect(d.x).toBeCloseTo(507 - 512, 5);
	});

	it("indexes a disc sitting exactly on a chunk corner into all four neighboring chunks", () => {
		const { scene } = createFakeScene(RIBBON_SIZES);
		const segments = [seg("corner", { x: 512, y: 512 }, { x: 512, y: 512 })];
		const chunkPlan = planPathRibbonChunks(scene, segments);
		expect(new Set(chunkPlan.edgeIndex.keys())).toEqual(
			new Set(["0,0", "1,0", "0,1", "1,1"]),
		);
	});

	it("produces no draws, and no RenderTexture at all, for a chunk with no edge/bed/cobble stamps", () => {
		const { scene, rts } = createFakeScene(RIBBON_SIZES);
		const segments = [seg("far", { x: 0, y: 0 }, { x: 0, y: 0 })];
		const chunkPlan = planPathRibbonChunks(scene, segments);
		const result = bakePathRibbonChunk(scene, 50, 50, "50,50", chunkPlan);
		expect(result).toBeNull();
		expect(rts).toHaveLength(0);
	});

	it("every chunk's own draws are identical however many other chunks were baked first, or in what order", () => {
		const segments = [
			seg("ring", { x: 0, y: 0 }, { x: 1200, y: 0 }),
			seg("spur", { x: 1200, y: 0 }, { x: 1200, y: 1200 }),
			seg("spur2", { x: 1200, y: 1200 }, { x: 0, y: 1200 }),
		];
		const { scene: planScene } = createFakeScene(RIBBON_SIZES);
		const chunkPlan = planPathRibbonChunks(planScene, segments);
		const keys = new Set<string>([
			...chunkPlan.edgeIndex.keys(),
			...chunkPlan.bedIndex.keys(),
			...chunkPlan.cobbleIndex.keys(),
		]);
		const keyList = [...keys];
		expect(keyList.length).toBeGreaterThan(3);

		const bakeAllInOrder = (order: string[]) => {
			const { scene } = createFakeScene(RIBBON_SIZES);
			const draws = new Map<string, DrawRecord[] | null>();
			for (const key of order) {
				const [col, row] = key.split(",").map(Number);
				const rt = bakePathRibbonChunk(
					scene,
					col ?? 0,
					row ?? 0,
					key,
					chunkPlan,
				);
				draws.set(key, rt?.draws ?? null);
			}
			return draws;
		};

		const forward = bakeAllInOrder([...keyList].sort());
		const backward = bakeAllInOrder([...keyList].sort().reverse());
		for (const key of keyList) {
			expect(backward.get(key), key).toEqual(forward.get(key));
		}
	});

	it("never requests a chunk RenderTexture bigger than the fixed chunk size, regardless of how far a single segment spans", () => {
		const { scene } = createFakeScene(RIBBON_SIZES);
		const segments = [seg("huge", { x: 0, y: 0 }, { x: 100_000, y: 0 })];
		const chunkPlan = planPathRibbonChunks(scene, segments);
		const sampleKeys = [...chunkPlan.edgeIndex.keys()].slice(0, 5);
		expect(sampleKeys.length).toBeGreaterThan(0);
		const { scene: bakeScene, rts } = createFakeScene(RIBBON_SIZES);
		for (const key of sampleKeys) {
			const [col, row] = key.split(",").map(Number);
			bakePathRibbonChunk(bakeScene, col ?? 0, row ?? 0, key, chunkPlan);
		}
		for (const rt of rts) {
			expect(rt.width).toBe(WORLD_CHUNK_SIZE_PX);
			expect(rt.height).toBe(WORLD_CHUNK_SIZE_PX);
			expect(rt.width).toBeLessThanOrEqual(MAX_SAFE_RENDER_TEXTURE_PX);
		}
	});
});
