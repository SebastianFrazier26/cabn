import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";
import { WORLD_CHUNK_SIZE_PX } from "../src/render/worldChunkGrid.js";
import type {
	Footprint,
	SceneryItem,
	SceneryKind,
} from "../src/systems/edgeScenery.js";

// sceneryBaker.ts does a real (non-type-only) `import Phaser from "phaser"`
// for addWindmillSails' tween easing — shadowPolish2.test.ts already stubs
// it the same way for that reason; every function under test here never
// touches that stub, but the module-level import still has to resolve.
vi.mock("phaser", () => ({
	default: { Math: { Easing: { Linear: (v: number) => v } } },
}));
const {
	bakeScenery,
	bakeSceneryChunk,
	groupSceneryItemsByChunk,
	multiplyTint,
} = await import("../src/render/sceneryBaker.js");

interface DrawRecord {
	key: string;
	x: number;
	y: number;
	flipX: boolean;
	tint: number;
}

class FakeImage {
	flipX = false;
	tint = 0xffffff;
	originX = 0;
	originY = 0;
	constructor(readonly key: string) {}
	setOrigin(x: number, y: number): this {
		this.originX = x;
		this.originY = y;
		return this;
	}
	setFlipX(v: boolean): this {
		this.flipX = v;
		return this;
	}
	setTint(t: number): this {
		this.tint = t;
		return this;
	}
	destroy(): void {}
}

class FakeRenderTexture {
	draws: DrawRecord[] = [];
	depth = 0;
	constructor(
		readonly x: number,
		readonly y: number,
		readonly width: number,
		readonly height: number,
	) {}
	beginDraw(): void {}
	endDraw(): void {}
	batchDraw(image: FakeImage, x: number, y: number): void {
		this.draws.push({
			key: image.key,
			x,
			y,
			flipX: image.flipX,
			tint: image.tint,
		});
	}
	setDepth(d: number): this {
		this.depth = d;
		return this;
	}
	destroy(): void {}
}

function createFakeScene() {
	const rts: FakeRenderTexture[] = [];
	const scene = {
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

const FOOTPRINTS = {
	pine: { w: 40, h: 60 },
	oak: { w: 50, h: 70 },
} as Partial<Record<SceneryKind, Footprint>> as Record<SceneryKind, Footprint>;

function item(
	kind: SceneryKind,
	x: number,
	y: number,
	tint = 0xffffff,
	flipX = false,
): SceneryItem {
	return { kind, x, y, tint, flipX };
}

describe("groupSceneryItemsByChunk", () => {
	it("bins an item entirely inside one chunk into only that chunk", () => {
		const chunks = groupSceneryItemsByChunk(
			[item("pine", 100, 100)],
			FOOTPRINTS,
		);
		expect([...chunks.keys()]).toEqual(["0,0"]);
		expect(chunks.get("0,0")).toHaveLength(1);
	});

	it("bins an item whose footprint straddles a vertical seam into both neighboring chunks", () => {
		// pine footprint is 40 wide, so a trunk at x=505 spans [485, 525],
		// crossing the x=512 chunk boundary (y=300 stays well inside row 0).
		const pine = item("pine", 505, 300);
		const chunks = groupSceneryItemsByChunk([pine], FOOTPRINTS);
		expect(new Set(chunks.keys())).toEqual(new Set(["0,0", "1,0"]));
		expect(chunks.get("0,0")).toEqual([pine]);
		expect(chunks.get("1,0")).toEqual([pine]);
	});

	it("bins an item whose footprint sits exactly on a chunk corner into all four neighboring chunks", () => {
		// oak footprint 50x70, anchored bottom-center at (512, 512): spans
		// x in [487, 537] and y in [442, 512] — crosses both the x=512 and
		// y=512 seams at once.
		const oak = item("oak", 512, 512);
		const chunks = groupSceneryItemsByChunk([oak], FOOTPRINTS);
		expect(new Set(chunks.keys())).toEqual(
			new Set(["0,0", "1,0", "0,1", "1,1"]),
		);
	});

	it("produces an empty map for an empty item list", () => {
		expect(groupSceneryItemsByChunk([], FOOTPRINTS).size).toBe(0);
	});

	it("respects a custom chunk size", () => {
		const pine = item("pine", 95, 65);
		const chunks = groupSceneryItemsByChunk([pine], FOOTPRINTS, 100);
		// Footprint [75,115] x [5,65] at chunkSize 100 crosses only the x=100
		// seam, staying inside row 0.
		expect(new Set(chunks.keys())).toEqual(new Set(["0,0", "1,0"]));
	});
});

describe("bakeSceneryChunk", () => {
	it("draws every item at its position local to the chunk's own origin, with its own flip and tint", () => {
		const { scene, rts } = createFakeScene();
		const pine = item("pine", 600, 300, 0xff0000, false);
		const oak = item("oak", 620, 310, 0x00ff00, true);
		const rt = bakeSceneryChunk(scene, 1, 0, [pine, oak], 2);
		expect(rt).not.toBeNull();
		expect(rt?.draws).toEqual([
			{ key: "scenery-pine", x: 88, y: 300, flipX: false, tint: 0xff0000 },
			{ key: "scenery-oak", x: 108, y: 310, flipX: true, tint: 0x00ff00 },
		]);
		expect(rt?.depth).toBe(2);
		expect(rts).toHaveLength(1);
	});

	it("produces no draws, and no RenderTexture at all, for an empty item list", () => {
		const { scene, rts } = createFakeScene();
		const result = bakeSceneryChunk(scene, 0, 0, [], 2);
		expect(result).toBeNull();
		expect(rts).toHaveLength(0);
	});

	it("a world skin's textureFor swap wins over the item's own kind, drawn at the item's own (unmultiplied) tint", () => {
		const { scene } = createFakeScene();
		const pine = item("pine", 100, 100, 0x8080ff);
		const rt = bakeSceneryChunk(scene, 0, 0, [pine], 2, {
			textureFor: (kind) => (kind === "pine" ? "nether-pine" : undefined),
			tint: 0xff0000,
		});
		expect(rt?.draws).toEqual([
			{ key: "nether-pine", x: 100, y: 100, flipX: false, tint: 0x8080ff },
		]);
	});

	it("a world skin's tint multiplies the item's own tint when no texture swap applies", () => {
		const { scene } = createFakeScene();
		const pine = item("pine", 100, 100, 0x8080ff);
		const rt = bakeSceneryChunk(scene, 0, 0, [pine], 2, { tint: 0x804040 });
		expect(rt?.draws[0]?.tint).toBe(multiplyTint(0x8080ff, 0x804040));
	});

	it("every chunk's own draws are identical however many other chunks were baked first, or in what order", () => {
		const items = [
			item("pine", 10, 10),
			item("oak", 700, 50),
			item("pine", 1500, 1500),
			item("oak", 1505, 300),
		];
		const chunkItems = groupSceneryItemsByChunk(items, FOOTPRINTS);
		const keys = [...chunkItems.keys()];
		expect(keys.length).toBeGreaterThan(1);

		const bakeAllInOrder = (order: string[]) => {
			const { scene } = createFakeScene();
			const draws = new Map<string, DrawRecord[] | null>();
			for (const key of order) {
				const [col, row] = key.split(",").map(Number);
				const rt = bakeSceneryChunk(
					scene,
					col ?? 0,
					row ?? 0,
					chunkItems.get(key) ?? [],
					2,
				);
				draws.set(key, rt?.draws ?? null);
			}
			return draws;
		};

		const forward = bakeAllInOrder([...keys].sort());
		const backward = bakeAllInOrder([...keys].sort().reverse());
		for (const key of keys)
			expect(backward.get(key), key).toEqual(forward.get(key));
	});

	it("never requests a chunk RenderTexture bigger than the fixed chunk size", () => {
		const { scene, rts } = createFakeScene();
		bakeSceneryChunk(scene, 123, -45, [item("pine", 0, 0)], 2);
		expect(rts).toHaveLength(1);
		expect(rts[0]?.width).toBe(WORLD_CHUNK_SIZE_PX);
		expect(rts[0]?.height).toBe(WORLD_CHUNK_SIZE_PX);
	});
});

describe("bakeScenery (whole-bounds) vs. streaming bakeSceneryChunk directly", () => {
	it("baking every chunk independently, in any order, draws exactly what the whole-bounds bake draws — same positions, keys, flips and tints, just reached a different way", () => {
		const items = [
			item("pine", 10, 10, 0x111111),
			item("oak", 700, 50, 0x222222, true),
			item("pine", 1500, 1500, 0x333333),
			item("oak", 1505, 300, 0x444444),
			item("pine", 505, 300, 0x555555), // straddles a seam, drawn into two chunks
		];
		const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };

		const { scene: wholeScene, rts: wholeRts } = createFakeScene();
		bakeScenery(wholeScene, bounds, items, FOOTPRINTS, 2);
		const wholeDraws = wholeRts.flatMap((rt) =>
			rt.draws.map((d) => ({
				key: d.key,
				x: d.x + (rt.x - WORLD_CHUNK_SIZE_PX / 2),
				y: d.y + (rt.y - WORLD_CHUNK_SIZE_PX / 2),
				flipX: d.flipX,
				tint: d.tint,
			})),
		);

		const chunkItems = groupSceneryItemsByChunk(items, FOOTPRINTS);
		const { scene: streamScene, rts: streamRts } = createFakeScene();
		// Reverse insertion order — a streamer bakes whichever chunk the camera
		// is nearest first, never the whole-bounds loop's own Map iteration order.
		for (const key of [...chunkItems.keys()].reverse()) {
			const [col, row] = key.split(",").map(Number);
			bakeSceneryChunk(
				streamScene,
				col ?? 0,
				row ?? 0,
				chunkItems.get(key) ?? [],
				2,
			);
		}
		const streamDraws = streamRts.flatMap((rt) =>
			rt.draws.map((d) => ({
				key: d.key,
				x: d.x + (rt.x - WORLD_CHUNK_SIZE_PX / 2),
				y: d.y + (rt.y - WORLD_CHUNK_SIZE_PX / 2),
				flipX: d.flipX,
				tint: d.tint,
			})),
		);

		const byPos = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			a.x - b.x || a.y - b.y;
		expect(streamDraws.sort(byPos)).toEqual(wholeDraws.sort(byPos));
		// The seam item must really have been drawn twice (once per chunk it
		// overlaps) in both bakes, not deduplicated away.
		expect(wholeDraws.filter((d) => d.tint === 0x555555)).toHaveLength(2);
	});
});
