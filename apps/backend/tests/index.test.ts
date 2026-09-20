import { expect, test } from "vitest";
import { backendStatus } from "../src/index.js";

test("backend reports stub status", () => {
	expect(backendStatus()).toContain("not yet implemented");
});
