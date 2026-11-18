import { describe, expect, test } from "vitest";
import {
	HERO_RELEASE_RADIUS,
	HERO_UNMOUNT_DELAY_MS,
	type HeroMountInput,
	type HeroMountState,
	INITIAL_HERO_MOUNT,
	stepHeroMount,
} from "../src/systems/heroMount.js";

const far = HERO_RELEASE_RADIUS + 10;
const mid = HERO_RELEASE_RADIUS - 10;

function run(
	state: HeroMountState,
	input: Partial<HeroMountInput> & { now: number },
): HeroMountState {
	return stepHeroMount(state, {
		ready: true,
		nearest: null,
		heldDistance: null,
		...input,
	});
}

describe("stepHeroMount", () => {
	test("nothing mounts before the world is ready", () => {
		const s = run(INITIAL_HERO_MOUNT, { now: 0, ready: false, nearest: "a" });
		expect(s.mounted).toBeNull();
		expect(run(s, { now: 10, nearest: "a" }).mounted).toBe("a");
	});

	test("losing readiness drops a mounted page", () => {
		const s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		expect(run(s, { now: 1, ready: false, nearest: "a" }).mounted).toBeNull();
	});

	test("stays mounted between mount and release radius", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 100_000, heldDistance: mid });
		expect(s.mounted).toBe("a");
		expect(s.outsideSince).toBeNull();
	});

	test("unmounts only after the delay beyond the release radius", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 1000, heldDistance: far });
		s = run(s, { now: 1000 + HERO_UNMOUNT_DELAY_MS - 1, heldDistance: far });
		expect(s.mounted).toBe("a");
		s = run(s, { now: 1000 + HERO_UNMOUNT_DELAY_MS, heldDistance: far });
		expect(s.mounted).toBeNull();
	});

	test("re-approaching within the delay keeps the same mount and cancels the timer", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 1000, heldDistance: far });
		const before = s;
		s = run(s, { now: 3000, nearest: "a" });
		expect(s.mounted).toBe("a");
		expect(s.outsideSince).toBeNull();
		expect(before.mounted).toBe("a");
		s = run(s, { now: 3500, heldDistance: far });
		s = run(s, { now: 3500 + HERO_UNMOUNT_DELAY_MS - 1, heldDistance: far });
		expect(s.mounted).toBe("a");
	});

	test("coming back inside the release radius resets the timer", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 1000, heldDistance: far });
		s = run(s, { now: 2000, heldDistance: mid });
		expect(s.outsideSince).toBeNull();
		s = run(s, { now: 2500, heldDistance: far });
		s = run(s, { now: 2500 + HERO_UNMOUNT_DELAY_MS - 1, heldDistance: far });
		expect(s.mounted).toBe("a");
	});

	test("a different nearest arch swaps immediately, never two at once", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 1000, heldDistance: far });
		s = run(s, { now: 1500, nearest: "b" });
		expect(s).toEqual({ mounted: "b", outsideSince: null });
	});

	test("a vanished arch unmounts at once", () => {
		let s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		s = run(s, { now: 10, heldDistance: null });
		expect(s.mounted).toBeNull();
	});

	test("steady state returns the same object (no store churn)", () => {
		const s = run(INITIAL_HERO_MOUNT, { now: 0, nearest: "a" });
		expect(run(s, { now: 5, nearest: "a" })).toBe(s);
		expect(run(s, { now: 6, heldDistance: mid })).toBe(s);
	});
});
