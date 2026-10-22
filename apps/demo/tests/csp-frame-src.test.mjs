import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEmbedOrigins } from "@cabn/cli";
import { describe, expect, it } from "vitest";
import { DEMO_CSP_DIRECTIVES } from "../csp-policy.mjs";

const demoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) =>
	JSON.parse(await readFile(join(demoRoot, path), "utf8"));

describe("demo CSP frame-src", () => {
	// Each world's cabn.json (in the tree or injected with --config) names
	// the origins its portals may frame; the policy is exactly their union.
	it("is the union of every demo world's allowedEmbedOrigins", async () => {
		const configs = [
			await readJson("sample-project/cabn.json"),
			await readJson("notes-showcase.json"),
		];
		expect([...DEMO_CSP_DIRECTIVES["frame-src"]].sort()).toEqual(
			collectEmbedOrigins(configs),
		);
	});
});
