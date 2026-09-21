import { describe, expect, test } from "vitest";
import {
	CABN_VERSION,
	ShelfManifestValidationError,
	validateShelf,
} from "../src/index.js";

function baseWorld() {
	return {
		id: "sample",
		name: "sample",
		worldUrl: "sample/world.json",
		themeSeed: 12345,
		fileCount: 15,
		totalBytes: 4096,
	};
}

function validShelf() {
	return {
		cabnVersion: CABN_VERSION,
		meta: { name: "My Worlds", generatedAt: new Date().toISOString() },
		worlds: [baseWorld()],
	};
}

describe("validateShelf", () => {
	test("accepts a well-formed shelf and returns it typed", () => {
		const shelf = validateShelf(validShelf());
		expect(shelf.cabnVersion).toBe(1);
		expect(shelf.worlds[0]?.id).toBe("sample");
	});

	test("rejects the wrong cabnVersion literal", () => {
		const bad = { ...validShelf(), cabnVersion: 2 };
		expect(() => validateShelf(bad)).toThrow(ShelfManifestValidationError);
	});

	test("rejects an unknown top-level key (strict object)", () => {
		const bad = { ...validShelf(), somethingExtra: true };
		expect(() => validateShelf(bad)).toThrow();
	});

	test("rejects an unknown key on a world entry (strict object)", () => {
		const bad = validShelf();
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input for the test
		(bad.worlds[0] as any).extra = "nope";
		expect(() => validateShelf(bad)).toThrow();
	});

	test("rejects a non-integer themeSeed", () => {
		const bad = validShelf();
		bad.worlds[0].themeSeed = 1.5;
		expect(() => validateShelf(bad)).toThrow();
	});

	test("rejects duplicate world ids", () => {
		const shelf = validShelf();
		shelf.worlds.push(baseWorld());
		expect(() => validateShelf(shelf)).toThrow(/duplicate world id/);
	});

	test("accepts an empty worlds array (a shelf with nothing converted yet)", () => {
		const shelf = { ...validShelf(), worlds: [] };
		expect(() => validateShelf(shelf)).not.toThrow();
	});
});
