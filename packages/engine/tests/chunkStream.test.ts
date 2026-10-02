import { describe, expect, it } from "vitest";
import {
	ChunkStreamer,
	planStream,
	takeWithinBudget,
} from "../src/render/chunkStream.js";

describe("planStream", () => {
	it("loads nothing beyond loadRadius", () => {
		const plan = planStream({
			loadCandidates: [{ key: "far", x: 1000, y: 0 }],
			loaded: new Set(),
			positionOf: () => ({ x: 0, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toLoad).toEqual([]);
	});

	it("orders load candidates nearest-first when standing still", () => {
		const plan = planStream({
			loadCandidates: [
				{ key: "far", x: 400, y: 0 },
				{ key: "near", x: 100, y: 0 },
				{ key: "mid", x: 250, y: 0 },
			],
			loaded: new Set(),
			positionOf: () => ({ x: 0, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toLoad).toEqual(["near", "mid", "far"]);
	});

	it("biases the same-distance candidate ahead of travel over one behind", () => {
		const plan = planStream({
			loadCandidates: [
				{ key: "ahead", x: 300, y: 0 },
				{ key: "behind", x: -300, y: 0 },
			],
			loaded: new Set(),
			positionOf: () => ({ x: 0, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 100, y: 0 }, // moving toward +x
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toLoad).toEqual(["ahead", "behind"]);
	});

	it("ignores velocity direction below the minimum-speed threshold (no spurious bias while stationary)", () => {
		const plan = planStream({
			loadCandidates: [
				{ key: "a", x: 300, y: 0 },
				{ key: "b", x: -300, y: 0 },
			],
			loaded: new Set(),
			positionOf: () => ({ x: 0, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 0.001, y: 0 }, // residual/noise, well under the threshold
			loadRadius: 500,
			evictRadius: 700,
		});
		// Equal distance, no ahead bias applied -> stable sort keeps input order.
		expect(plan.toLoad).toEqual(["a", "b"]);
	});

	it("never re-loads an already-loaded key", () => {
		const plan = planStream({
			loadCandidates: [{ key: "here", x: 10, y: 0 }],
			loaded: new Set(["here"]),
			positionOf: () => ({ x: 10, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toLoad).toEqual([]);
	});

	it("evicts only loaded keys beyond evictRadius, not ones still inside it", () => {
		const plan = planStream({
			loadCandidates: [],
			loaded: new Set(["close", "justInsideEvict", "farOut"]),
			positionOf: (key) =>
				key === "close"
					? { x: 100, y: 0 }
					: key === "justInsideEvict"
						? { x: 690, y: 0 }
						: { x: 900, y: 0 },
			camera: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toEvict).toEqual(["farOut"]);
	});

	it("has hysteresis: a chunk just past loadRadius but still inside evictRadius is neither reloaded nor evicted", () => {
		// The gap between loadRadius and evictRadius is the whole point of
		// hysteresis — without it, a chunk sitting exactly on the load boundary
		// would load, evict, reload, evict every frame as floating-point camera
		// motion nudges it back and forth across one threshold.
		const plan = planStream({
			loadCandidates: [{ key: "edge", x: 550, y: 0 }],
			loaded: new Set(["edge"]),
			positionOf: () => ({ x: 550, y: 0 }),
			camera: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			loadRadius: 500,
			evictRadius: 700,
		});
		expect(plan.toLoad).toEqual([]);
		expect(plan.toEvict).toEqual([]);
	});
});

describe("takeWithinBudget", () => {
	it("bakes up to maxPerFrame even with budget to spare", () => {
		const baked: string[] = [];
		const result = takeWithinBudget({
			queue: ["a", "b", "c", "d"],
			bake: (k) => baked.push(k),
			now: () => 0,
			budgetMs: 1000,
			maxPerFrame: 2,
		});
		expect(result).toEqual(["a", "b"]);
		expect(baked).toEqual(["a", "b"]);
	});

	it("stops once elapsed time crosses the budget", () => {
		let t = 0;
		const clock = () => t;
		const result = takeWithinBudget({
			queue: ["a", "b", "c"],
			bake: () => {
				t += 5; // each bake "costs" 5ms of wall time
			},
			now: clock,
			budgetMs: 8,
			maxPerFrame: 10,
		});
		// First bake always happens regardless of budget; the check after it
		// (5ms elapsed < 8ms) lets a second one in; after that (10ms >= 8ms) stop.
		expect(result).toEqual(["a", "b"]);
	});

	it("always bakes at least one entry even if a single bake would blow the whole budget", () => {
		let t = 0;
		const result = takeWithinBudget({
			queue: ["only"],
			bake: () => {
				t += 1000;
			},
			now: () => t,
			budgetMs: 4,
			maxPerFrame: 10,
		});
		expect(result).toEqual(["only"]);
	});

	it("does nothing on an empty queue", () => {
		const result = takeWithinBudget({
			queue: [],
			bake: () => {
				throw new Error("should never be called");
			},
			now: () => 0,
			budgetMs: 4,
			maxPerFrame: 10,
		});
		expect(result).toEqual([]);
	});
});

describe("ChunkStreamer", () => {
	function makeStreamer() {
		const baked: string[] = [];
		const evicted: string[] = [];
		let t = 0;
		const positions = new Map<string, { x: number; y: number }>();
		const streamer = new ChunkStreamer<string, string>({
			loadRadius: 500,
			evictRadius: 700,
			budgetMs: 4,
			maxPerFrame: 8,
			bake: (key) => {
				baked.push(key);
				return `payload:${key}`;
			},
			evict: (key) => {
				evicted.push(key);
			},
			positionOf: (key) => positions.get(key) ?? { x: 0, y: 0 },
			now: () => t,
		});
		return {
			streamer,
			baked,
			evicted,
			positions,
			advance: (ms: number) => (t += ms),
		};
	}

	it("loadNowSync bakes every given key immediately, ignoring budget", () => {
		const { streamer, baked } = makeStreamer();
		streamer.loadNowSync(["a", "b", "c"]);
		expect(baked).toEqual(["a", "b", "c"]);
		expect(streamer.has("b")).toBe(true);
	});

	it("loadNowSync never re-bakes a key that's already loaded", () => {
		const { streamer, baked } = makeStreamer();
		streamer.loadNowSync(["a"]);
		streamer.loadNowSync(["a", "b"]);
		expect(baked).toEqual(["a", "b"]);
	});

	it("step loads nearby candidates and evicts far-out loaded ones in the same call", () => {
		const { streamer, baked, evicted, positions } = makeStreamer();
		positions.set("stale", { x: 900, y: 0 });
		streamer.loadNowSync(["stale"]);
		const result = streamer.step(
			[{ key: "new", x: 50, y: 0 }],
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		);
		expect(result.baked).toEqual(["new"]);
		expect(result.evicted).toEqual(["stale"]);
		expect(baked).toEqual(["stale", "new"]);
		expect(evicted).toEqual(["stale"]);
		expect(streamer.has("stale")).toBe(false);
		expect(streamer.has("new")).toBe(true);
	});

	it("destroyAll hands back every remaining payload and clears the loaded set", () => {
		const { streamer } = makeStreamer();
		streamer.loadNowSync(["a", "b"]);
		const destroyed: string[] = [];
		streamer.destroyAll((key, payload) => destroyed.push(`${key}=${payload}`));
		expect(destroyed.sort()).toEqual(["a=payload:a", "b=payload:b"]);
		expect(streamer.has("a")).toBe(false);
	});
});
