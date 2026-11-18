import { describe, expect, it } from "vitest";
import { ObjectPool } from "../src/render/rtPool.js";

interface Fake {
	id: number;
	pixels: string;
	tint: number | null;
	parked: boolean;
	destroyed: boolean;
}

function makePool(maxIdle = 2) {
	let next = 0;
	const all: Fake[] = [];
	const pool = new ObjectPool<Fake>({
		create: () => {
			const f: Fake = {
				id: next++,
				pixels: "",
				tint: null,
				parked: false,
				destroyed: false,
			};
			all.push(f);
			return f;
		},
		reset: (f) => {
			f.pixels = "";
			f.tint = null;
		},
		park: (f) => {
			f.parked = true;
		},
		unpark: (f) => {
			f.parked = false;
		},
		destroy: (f) => {
			f.destroyed = true;
		},
		maxIdle,
	});
	return { pool, all };
}

describe("ObjectPool", () => {
	it("reuses a released object instead of creating a new one", () => {
		const { pool, all } = makePool();
		const a = pool.take();
		pool.release(a);
		const b = pool.take();
		expect(b).toBe(a);
		expect(all).toHaveLength(1);
		expect(pool.reused).toBe(1);
	});

	it("wipes the previous owner's content and tint on take", () => {
		const { pool } = makePool();
		const a = pool.take();
		a.pixels = "old";
		a.tint = 0xff0000;
		pool.release(a);
		const b = pool.take();
		expect(b.pixels).toBe("");
		expect(b.tint).toBeNull();
		expect(b.parked).toBe(false);
	});

	it("never hands one object to two owners", () => {
		const { pool } = makePool();
		const a = pool.take();
		pool.release(a);
		expect(pool.release(a)).toBe(false);
		const b = pool.take();
		const c = pool.take();
		expect(c).not.toBe(b);
	});

	it("ignores a release of something it never lent", () => {
		const { pool } = makePool();
		const stranger: Fake = {
			id: 99,
			pixels: "",
			tint: null,
			parked: false,
			destroyed: false,
		};
		expect(pool.release(stranger)).toBe(false);
		expect(pool.idleCount).toBe(0);
	});

	it("bounds idle objects: the overflow is destroyed, not kept", () => {
		const { pool, all } = makePool(2);
		const taken = [pool.take(), pool.take(), pool.take()];
		for (const t of taken) pool.release(t);
		expect(pool.idleCount).toBe(2);
		expect(all.filter((f) => f.destroyed)).toHaveLength(1);
	});

	it("prewarm fills up to the target without exceeding maxIdle, and take uses them", () => {
		const { pool, all } = makePool(3);
		expect(pool.prewarm(10)).toBe(3);
		expect(pool.prewarm(10)).toBe(0);
		expect(all.every((f) => f.parked)).toBe(true);
		pool.take();
		expect(all).toHaveLength(3);
		expect(pool.idleCount).toBe(2);
	});

	it("destroy() disposes idle objects and forgets lent ones", () => {
		const { pool, all } = makePool();
		const a = pool.take();
		const b = pool.take();
		pool.release(b);
		pool.destroy();
		expect(b.destroyed).toBe(true);
		expect(a.destroyed).toBe(false);
		expect(pool.idleCount).toBe(0);
		expect(all).toHaveLength(2);
	});
});
