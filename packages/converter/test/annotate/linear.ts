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
//
// Times are this process's CPU time (`process.cpuUsage()`, user + system), not
// wall-clock: other processes pushing the load past the core count stretch
// wall time but not ours, which flaked the ratio. Vitest's default forks pool
// gives each test file its own process, so other files don't count either.
// CPU time can't see a run that blocks without computing, so the full-size
// rung also gets a generous wall-clock backstop.
//
// Kept in step with the copy in packages/engine/tests/redos.test.ts: no package
// both test suites can import a test helper from.
const MAX_RATIO = 8;
const FLOOR_MS = 10;
const WALL_BACKSTOP_MS = 30_000;

export function fill(unit: string, bytes = FILE_CAP): string {
	return unit.repeat(Math.floor(bytes / unit.length));
}

export function timed<T>(fn: () => T): {
	value: T;
	ms: number;
	wallMs: number;
} {
	const wallStart = performance.now();
	const cpuStart = process.cpuUsage();
	const value = fn();
	const cpu = process.cpuUsage(cpuStart);
	return {
		value,
		ms: (cpu.user + cpu.system) / 1000,
		wallMs: performance.now() - wallStart,
	};
}

/** `run(build(size))`, after checking its CPU time scales linearly up to `size`; a rung that misses gets two more tries. */
export function expectLinear<I, T>(
	build: (size: number) => I,
	run: (input: I) => T,
	size = FILE_CAP,
): T {
	let prevMs = 0;
	let wallMs = 0;
	let value: T | undefined;
	for (const n of [size / 64, size / 16, size / 4, size].map(Math.floor)) {
		const input = build(n);
		const limit = MAX_RATIO * Math.max(prevMs, FLOOR_MS);
		let ms = Number.POSITIVE_INFINITY;
		for (let attempt = 0; attempt < 3 && ms >= limit; attempt++) {
			const result = timed(() => run(input));
			value = result.value;
			if (result.ms < ms) {
				ms = result.ms;
				wallMs = result.wallMs;
			}
		}
		expect(ms, `size ${n} (CPU ms)`).toBeLessThan(limit);
		prevMs = ms;
	}
	expect(prevMs, "full size (CPU ms)").toBeLessThan(BUDGET_MS);
	expect(wallMs, "full size (wall ms)").toBeLessThan(WALL_BACKSTOP_MS);
	return value as T;
}
