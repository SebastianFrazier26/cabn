import { describe, expect, it } from "vitest";
import { touchChunk } from "../src/systems/chunkCache.js";

describe("touchChunk", () => {
	it("appends a new id to the end of the order", () => {
		const { order, evicted } = touchChunk(["a", "b"], "c", 8);
		expect(order).toEqual(["a", "b", "c"]);
		expect(evicted).toEqual([]);
	});

	it("moves an already-present id to the end instead of duplicating it", () => {
		const { order, evicted } = touchChunk(["a", "b", "c"], "a", 8);
		expect(order).toEqual(["b", "c", "a"]);
		expect(evicted).toEqual([]);
	});

	it("evicts the oldest entries once maxSize is exceeded", () => {
		const { order, evicted } = touchChunk(
			["a", "b", "c", "d", "e", "f", "g", "h"],
			"i",
			8,
		);
		expect(order).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
		expect(evicted).toEqual(["a"]);
	});

	it("evicts multiple entries if maxSize shrinks below current length", () => {
		const { order, evicted } = touchChunk(["a", "b", "c", "d"], "e", 2);
		expect(order).toEqual(["d", "e"]);
		expect(evicted).toEqual(["a", "b", "c"]);
	});

	it("never evicts the just-touched id even at maxSize 1", () => {
		const { order, evicted } = touchChunk(["a"], "b", 1);
		expect(order).toEqual(["b"]);
		expect(evicted).toEqual(["a"]);
	});
});
