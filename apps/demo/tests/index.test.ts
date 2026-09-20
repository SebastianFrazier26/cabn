import { expect, test } from "vitest";
import { demoStatus } from "../src/index.js";

test("demo reports stub status", () => {
	expect(demoStatus()).toContain("not yet implemented");
});
