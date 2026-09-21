import { describe, expect, it } from "vitest";
import { shouldBuild } from "../scripts/build-world.mjs";

describe("shouldBuild", () => {
	it("builds when the output doesn't exist yet", () => {
		expect(shouldBuild(false, false)).toBe(true);
	});

	it("skips when the output exists and a rebuild wasn't forced", () => {
		expect(shouldBuild(true, false)).toBe(false);
	});

	it("rebuilds when forced even if the output already exists", () => {
		expect(shouldBuild(true, true)).toBe(true);
	});

	it("builds when forced and the output is also missing", () => {
		expect(shouldBuild(false, true)).toBe(true);
	});
});
