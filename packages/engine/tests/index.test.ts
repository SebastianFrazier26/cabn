import { expect, test } from "vitest";
import { engineStatus } from "../src/index.js";

test("engine reports stub status", () => {
	expect(engineStatus()).toContain("not yet implemented");
});
