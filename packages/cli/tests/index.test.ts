import { expect, test } from "vitest";
import { CLI_VERSION, helpText } from "../src/index.js";

test("help text carries the version", () => {
	expect(helpText()).toContain(CLI_VERSION);
	expect(helpText()).toContain("Usage:");
});
