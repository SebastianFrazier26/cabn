import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	followLerp,
	MAX_FRAME_MS,
	PHASER_FPS_CONFIG,
} from "../src/systems/frameTiming.js";

// Phaser's UMD entry needs a browser, but these modules load in node, so the
// tests drive the real TimeStep + arcade World rather than a re-model.
const require = createRequire(import.meta.url);
const TimeStep = require("phaser/src/core/TimeStep.js");
const World = require("phaser/src/physics/arcade/World.js");
const Body = require("phaser/src/physics/arcade/Body.js");
const StaticBody = require("phaser/src/physics/arcade/StaticBody.js");

const SPEED = 220;

interface FakeObject {
	x: number;
	y: number;
	// biome-ignore lint/suspicious/noExplicitAny: Phaser's untyped CJS classes
	[key: string]: any;
}

function fakeObject(
	scene: unknown,
	x: number,
	y: number,
	width: number,
	height: number,
): FakeObject {
	return {
		x,
		y,
		width,
		height,
		displayWidth: width,
		displayHeight: height,
		scaleX: 1,
		scaleY: 1,
		originX: 0,
		originY: 0,
		displayOriginX: 0,
		displayOriginY: 0,
		rotation: 0,
		angle: 0,
		scene,
		parentContainer: null,
		getTopLeft(out: { x: number; y: number } = { x: 0, y: 0 }) {
			out.x = this.x;
			out.y = this.y;
			return out;
		},
		getWorldTransformMatrix: () => ({}),
		getBounds: () => ({}),
	};
}

interface Rig {
	step(time: number): void;
	player: FakeObject;
}

function makeRig(
	fpsConfig: Record<string, unknown>,
	wall?: { x: number; width: number },
): Rig {
	const scene = {
		sys: {
			events: { on() {}, once() {}, off() {}, emit() {} },
			game: { config: {} },
			scale: { width: 100000, height: 100000 },
		},
	};
	const world = new World(scene, { gravity: { x: 0, y: 0 } });
	const player = fakeObject(scene, 0, 0, 24, 16);
	player.body = new Body(world, player);
	world.bodies.set(player.body);
	if (wall) {
		const w = fakeObject(scene, wall.x, -500, wall.width, 1000);
		w.body = new StaticBody(world, w);
		world.staticBodies.set(w.body);
		world.addCollider(player, w);
	}
	player.body.setVelocity(SPEED, 0);

	const ts = new TimeStep({ config: {} }, fpsConfig);
	for (let i = 0; i < ts.deltaSmoothingMax; i++) {
		ts.deltaHistory[i] = ts._target;
	}
	ts.resetDelta();
	ts.lastTime = 0;
	ts.callback = (time: number, delta: number) => {
		world.update(time, delta);
		world.postUpdate();
	};
	return { step: (time) => ts.step(time), player };
}

function walkedBetween(
	fpsConfig: Record<string, unknown>,
	fps: number,
	fromSeconds: number,
	toSeconds: number,
): number {
	const rig = makeRig(fpsConfig);
	let at = 0;
	for (let i = 1; i <= Math.round(fps * toSeconds); i++) {
		rig.step((i * 1000) / fps);
		if (i === Math.round(fps * fromSeconds)) at = rig.player.x;
	}
	return rig.player.x - at;
}

beforeEach(() => {
	(globalThis as { window?: unknown }).window = { performance };
});
afterEach(() => {
	delete (globalThis as { window?: unknown }).window;
});

describe("walking distance is frame-rate independent", () => {
	for (const fps of [3, 4, 5, 10, 30, 60, 144]) {
		it(`${fps} fps covers ~${SPEED} px per second once running`, () => {
			const walked = walkedBetween(PHASER_FPS_CONFIG, fps, 10, 30);
			expect(walked / 20).toBeGreaterThan(SPEED * 0.99);
			expect(walked / 20).toBeLessThan(SPEED * 1.01);
		});

		it(`${fps} fps loses under 3.5 s of walking to the start-up ramp`, () => {
			const walked = walkedBetween(PHASER_FPS_CONFIG, fps, 0, 20);
			expect(walked).toBeGreaterThan(SPEED * 16.5);
		});
	}

	it("Phaser's defaults crawl below 5 fps (the bug this config fixes)", () => {
		const walked = walkedBetween({ min: 5 }, 4, 10, 30);
		expect(walked / 20).toBeLessThan(SPEED * 0.15);
	});
});

describe("stall protection", () => {
	it("a multi-second stalled frame does not teleport the player", () => {
		const rig = makeRig(PHASER_FPS_CONFIG);
		for (let i = 1; i <= 60; i++) rig.step((i * 1000) / 60);
		const before = rig.player.x;
		rig.step(1000 + 8000);
		expect(rig.player.x - before).toBeLessThanOrEqual(
			(SPEED * MAX_FRAME_MS) / 1000 + 1,
		);
	});
});

describe("colliders still hold at low fps", () => {
	for (const fps of [2.5, 4, 5, 30, 60]) {
		it(`no tunnelling through a 20 px wall at ${fps} fps`, () => {
			const rig = makeRig(PHASER_FPS_CONFIG, { x: 400, width: 20 });
			for (let i = 1; i <= Math.ceil(fps * 12); i++) {
				rig.step((i * 1000) / fps);
				expect(rig.player.x + 24).toBeLessThanOrEqual(400.001);
			}
			expect(rig.player.x + 24).toBeGreaterThan(395);
		});
	}
});

describe("followLerp", () => {
	it("equals the tuned factor at a 60 fps frame", () => {
		expect(followLerp(0.1, 1000 / 60)).toBeCloseTo(0.1, 10);
	});

	it("covers the same fraction of the gap per second at any frame rate", () => {
		const remaining = (fps: number) => (1 - followLerp(0.1, 1000 / fps)) ** fps;
		for (const fps of [5, 30, 144]) {
			expect(remaining(fps)).toBeCloseTo(remaining(60), 6);
		}
	});

	it("clamps negative and stalled deltas", () => {
		expect(followLerp(0.1, -5)).toBe(0);
		expect(followLerp(0.1, 60_000)).toBe(followLerp(0.1, MAX_FRAME_MS));
	});
});
