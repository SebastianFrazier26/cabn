import { expect } from "vitest";

// walk.ts's per-file content cap: the most an attacker-supplied file can hold.
export const FILE_CAP = 512 * 1024;
// Every payload timed with this took seconds to minutes before its fix.
const BUDGET_MS = 3000;
// A fixed budget alone flakes when `pnpm -r test` loads the machine, so each
// payload must also scale like linear code: every 4x step up in size in under
// 8x the time (quadratic takes ~16x). Climbing from size / 64 makes a
// quadratic regression fail on a small rung in about a second instead of
// hanging on the full size, and the floor keeps sub-millisecond timer noise
// from failing a ratio.
const MAX_RATIO = 8;
const FLOOR_MS = 10;

export function fill(unit: string, bytes = FILE_CAP): string {
	return unit.repeat(Math.floor(bytes / unit.length));
}

export function timed<T>(fn: () => T): { value: T; ms: number } {
	const start = performance.now();
	const value = fn();
	return { value, ms: performance.now() - start };
}

/** `run(build(size))`, after checking it scales linearly up to `size`; a rung that misses gets two more tries. */
export function expectLinear<I, T>(
	build: (size: number) => I,
	run: (input: I) => T,
	size = FILE_CAP,
): T {
	let prevMs = 0;
	let value: T | undefined;
	for (const n of [size / 64, size / 16, size / 4, size].map(Math.floor)) {
		const input = build(n);
		const limit = MAX_RATIO * Math.max(prevMs, FLOOR_MS);
		let ms = Number.POSITIVE_INFINITY;
		for (let attempt = 0; attempt < 3 && ms >= limit; attempt++) {
			const result = timed(() => run(input));
			value = result.value;
			ms = Math.min(ms, result.ms);
		}
		expect(ms, `size ${n}`).toBeLessThan(limit);
		prevMs = ms;
	}
	expect(prevMs).toBeLessThan(BUDGET_MS);
	return value as T;
}
