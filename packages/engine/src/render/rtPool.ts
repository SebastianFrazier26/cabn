/**
 * Phaser-free recycling pool. Creating a RenderTexture calls
 * `checkFramebufferStatus`, a GPU sync that waits on every queued command, so
 * streaming chunks in and out by create/destroy stalled walking (~85 ms
 * typical, 15+ ms on 140-190 creations per run, measured 2026-11-17). A
 * released object is reused instead, after `reset` wipes whatever its last
 * owner left on it.
 */
export interface PoolConfig<T> {
	create: () => T;
	/** Runs on every take(), reused or new: must leave the object indistinguishable from a fresh one (cleared pixels, no tint, default alpha). */
	reset: (item: T) => void;
	/** Takes an idle object out of play (off the display list). */
	park: (item: T) => void;
	/** Takes a parked object back into play; runs before reset. */
	unpark: (item: T) => void;
	destroy: (item: T) => void;
	/** Idle objects kept; a release beyond this destroys the object instead of keeping it, so GPU memory stays bounded. */
	maxIdle: number;
}

export class ObjectPool<T> {
	private readonly idle: T[] = [];
	private readonly idleSet = new Set<T>();
	private readonly inUse = new Set<T>();
	created = 0;
	reused = 0;

	constructor(private readonly config: PoolConfig<T>) {}

	get idleCount(): number {
		return this.idle.length;
	}

	get inUseCount(): number {
		return this.inUse.size;
	}

	take(): T {
		const reusedItem = this.idle.pop();
		let item: T;
		if (reusedItem !== undefined) {
			this.idleSet.delete(reusedItem);
			this.config.unpark(reusedItem);
			item = reusedItem;
			this.reused++;
		} else {
			item = this.config.create();
			this.created++;
		}
		this.config.reset(item);
		this.inUse.add(item);
		return item;
	}

	/** Returns false (and does nothing) for an object that isn't currently checked out, so a double release can never put one object in the pool twice. */
	release(item: T): boolean {
		if (!this.inUse.delete(item)) return false;
		if (this.idle.length >= this.config.maxIdle) {
			this.config.destroy(item);
			return true;
		}
		this.config.park(item);
		this.idle.push(item);
		this.idleSet.add(item);
		return true;
	}

	/** Creates idle objects ahead of demand, up to `count` idle in total. Returns how many it made. */
	prewarm(count: number): number {
		let made = 0;
		const target = Math.min(count, this.config.maxIdle);
		while (this.idle.length < target) {
			const item = this.config.create();
			this.created++;
			this.config.park(item);
			this.idle.push(item);
			this.idleSet.add(item);
			made++;
		}
		return made;
	}

	/** Destroys every idle object; checked-out ones are their owners' to destroy. */
	destroy(): void {
		for (const item of this.idle) this.config.destroy(item);
		this.idle.length = 0;
		this.idleSet.clear();
		this.inUse.clear();
	}
}
