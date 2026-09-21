import { expect, test } from "vitest";
import { CLI_VERSION, helpText } from "../src/help.js";

test("help text carries the version and both commands", () => {
	const text = helpText();
	expect(text).toContain(CLI_VERSION);
	expect(text).toContain("cabn build");
	expect(text).toContain("cabn inspect");
});
