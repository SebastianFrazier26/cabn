import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { PressLatch } from "../src/systems/pressLatch.js";

describe("PressLatch", () => {
	it("reports a press once, even when the key-up came before the read", () => {
		const key = new EventEmitter();
		const latch = new PressLatch(key as never);
		key.emit("down");
		key.emit("up");
		expect(latch.consume()).toBe(true);
		expect(latch.consume()).toBe(false);
	});

	it("is false with no press and counts separate presses separately", () => {
		const key = new EventEmitter();
		const latch = new PressLatch(key as never);
		expect(latch.consume()).toBe(false);
		key.emit("down");
		expect(latch.consume()).toBe(true);
		key.emit("down");
		expect(latch.consume()).toBe(true);
	});

	it("collapses two presses between reads into one", () => {
		const key = new EventEmitter();
		const latch = new PressLatch(key as never);
		key.emit("down");
		key.emit("down");
		expect(latch.consume()).toBe(true);
		expect(latch.consume()).toBe(false);
	});
});
