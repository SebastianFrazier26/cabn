/**
 * Generic incremental-bake scheduler shared by the ground field's grid
 * chunks (groundField.ts) and per-cluster ground bakes (WorldScene's
 * clusterGroundStreamer) — both need the same three decisions ("what's
 * close enough to load", "what's far enough to drop", "how much can we
 * afford to do this frame") over otherwise unrelated candidate shapes (a
 * fixed-size world grid vs. a small fixed list of clusters). Kept
 * Phaser-free so `planStream`/`takeWithinBudget` are unit-testable without a
 * scene, canvas, or WebGL context — only the caller's `bake`/`evict`
 * closures touch Phaser.
 */

export interface Point {
	x: number;
	y: number;
}

export interface StreamCandidate<K> {
	key: K;
	x: number;
	y: number;
}

export interface StreamPlan<K> {
	/** Nearest/most-urgent first. */
	toLoad: K[];
	toEvict: K[];
}

// A chunk exactly in the direction of travel effectively counts as this much
// closer than its raw distance — small enough that a chunk already loaded
// (and thus outside toLoad entirely) is never disturbed by it, and that a
// chunk near evictRadius can never out-rank one actually inside loadRadius
// (see PlanStreamParams's loadRadius/evictRadius gap requirement below).
const AHEAD_BONUS_PX = 220;

// Below this speed, "direction of travel" is noise (a player standing still
// still has some tiny residual velocity from physics damping) — treat it as
// stationary rather than let a near-zero vector's arbitrary direction bias
// the queue.
const MIN_SPEED_FOR_AHEAD_PXPS = 4;

export interface PlanStreamParams<K> {
	/** Candidates worth considering for loading — the caller's own bounded window (e.g. camera view + margin), not the whole world/candidate set. Distances outside loadRadius are ignored, so an over-wide window costs nothing but a few extra distance checks. */
	loadCandidates: readonly StreamCandidate<K>[];
	loaded: ReadonlySet<K>;
	/** Must return a real position for ANY loaded key, not just ones inside loadCandidates — eviction distance can't depend on a key still being in this frame's load window (see this module's doc comment on why toEvict is computed separately). */
	positionOf: (key: K) => Point;
	camera: Point;
	velocity: Point;
	loadRadius: number;
	evictRadius: number;
}

/**
 * Pure planning step: which not-yet-loaded candidates are close enough to
 * start baking (nearest and most in-the-direction-of-travel first), and
 * which currently-loaded chunks are now far enough to drop. Never mutates
 * `loaded` — the caller applies the plan and updates its own loaded set.
 */
export function planStream<K>(params: PlanStreamParams<K>): StreamPlan<K> {
	const speed = Math.hypot(params.velocity.x, params.velocity.y);
	const vx = speed > MIN_SPEED_FOR_AHEAD_PXPS ? params.velocity.x / speed : 0;
	const vy = speed > MIN_SPEED_FOR_AHEAD_PXPS ? params.velocity.y / speed : 0;

	const ranked: { key: K; priority: number }[] = [];
	for (const c of params.loadCandidates) {
		if (params.loaded.has(c.key)) continue;
		const dx = c.x - params.camera.x;
		const dy = c.y - params.camera.y;
		const distance = Math.hypot(dx, dy);
		if (distance > params.loadRadius) continue;
		// dot of the unit travel direction with the unit direction to the
		// candidate — 1 when dead ahead, -1 when directly behind, 0 standing still.
		const ahead = distance > 0 ? (dx * vx + dy * vy) / distance : 0;
		ranked.push({
			key: c.key,
			priority: distance - AHEAD_BONUS_PX * Math.max(0, ahead),
		});
	}
	ranked.sort((a, b) => a.priority - b.priority);

	const toEvict: K[] = [];
	for (const key of params.loaded) {
		const pos = params.positionOf(key);
		const distance = Math.hypot(
			pos.x - params.camera.x,
			pos.y - params.camera.y,
		);
		if (distance > params.evictRadius) toEvict.push(key);
	}

	return { toLoad: ranked.map((r) => r.key), toEvict };
}

export interface BudgetParams<K> {
	queue: readonly K[];
	bake: (key: K) => void;
	now: () => number;
	budgetMs: number;
	maxPerFrame: number;
}

/**
 * Bakes greedily off the front of `queue` until either budget runs out (an
 * elapsed-time check, not an estimate — the whole point is to adapt to
 * however slow one bake actually is on this machine) or maxPerFrame chunks
 * have gone in, whichever comes first. Always bakes at least one entry when
 * the queue is non-empty, so a single unusually slow bake can't make the
 * budget check itself starve the queue forever.
 */
export function takeWithinBudget<K>(params: BudgetParams<K>): K[] {
	const baked: K[] = [];
	const start = params.now();
	for (const key of params.queue) {
		if (baked.length >= params.maxPerFrame) break;
		if (baked.length > 0 && params.now() - start >= params.budgetMs) break;
		params.bake(key);
		baked.push(key);
	}
	return baked;
}

export interface ChunkStreamerConfig<K, T> {
	loadRadius: number;
	evictRadius: number;
	budgetMs: number;
	maxPerFrame: number;
	bake: (key: K) => T;
	evict: (key: K, payload: T) => void;
	positionOf: (key: K) => Point;
	now?: () => number;
}

/**
 * Stateful wrapper around planStream/takeWithinBudget for the two real call
 * sites (ground field grid chunks, per-cluster ground) — holds the loaded
 * set and its baked payloads so WorldScene doesn't have to.
 */
export class ChunkStreamer<K, T> {
	private readonly loaded = new Map<K, T>();
	private readonly now: () => number;

	constructor(private readonly config: ChunkStreamerConfig<K, T>) {
		this.now = config.now ?? (() => performance.now());
	}

	get loadedKeys(): ReadonlySet<K> {
		return new Set(this.loaded.keys());
	}

	has(key: K): boolean {
		return this.loaded.has(key);
	}

	/** Bakes every given key immediately, no budget — for the entry set, which is deliberately kept small (viewport + margin only) so a synchronous bake of it is cheap. */
	loadNowSync(keys: readonly K[]): void {
		for (const key of keys) {
			if (this.loaded.has(key)) continue;
			this.loaded.set(key, this.config.bake(key));
		}
	}

	/**
	 * One frame's worth of streaming: plans against the current camera/
	 * velocity, evicts anything now out of range, then bakes as much of the
	 * load queue as this frame's budget allows.
	 */
	step(
		loadCandidates: readonly StreamCandidate<K>[],
		camera: Point,
		velocity: Point,
	): { baked: K[]; evicted: K[] } {
		const plan = planStream({
			loadCandidates,
			loaded: this.loadedKeys,
			positionOf: this.config.positionOf,
			camera,
			velocity,
			loadRadius: this.config.loadRadius,
			evictRadius: this.config.evictRadius,
		});
		for (const key of plan.toEvict) {
			const payload = this.loaded.get(key);
			if (payload === undefined) continue;
			this.loaded.delete(key);
			this.config.evict(key, payload);
		}
		const baked = takeWithinBudget({
			queue: plan.toLoad,
			bake: (key) => {
				this.loaded.set(key, this.config.bake(key));
			},
			now: this.now,
			budgetMs: this.config.budgetMs,
			maxPerFrame: this.config.maxPerFrame,
		});
		return { baked, evicted: plan.toEvict };
	}

	/** Scene shutdown: hand back every remaining payload for disposal (destroy()) without going through the plan/evict machinery. */
	destroyAll(destroy: (key: K, payload: T) => void): void {
		for (const [key, payload] of this.loaded) destroy(key, payload);
		this.loaded.clear();
	}
}
