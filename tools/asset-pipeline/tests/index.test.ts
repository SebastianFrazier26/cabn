import { expect, test } from "vitest";
import { assetPipelineStatus } from "../src/index.js";

test("asset pipeline reports stub status", () => {
	expect(assetPipelineStatus()).toContain("not yet implemented");
});
