import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CLI_VERSION, helpText } from "../src/help.js";

test("help text carries the version and both commands", () => {
	const text = helpText();
	expect(text).toContain(CLI_VERSION);
	expect(text).toContain("cabn build");
	expect(text).toContain("cabn inspect");
	expect(text).toContain("cabn shelf");
});

test("CLI_VERSION is the package version", () => {
	const pkg = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string };
	expect(CLI_VERSION).toBe(pkg.version);
	expect(CLI_VERSION).not.toBe("0.0.0");
});
