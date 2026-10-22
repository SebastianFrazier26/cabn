import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectWorldEmbedOrigins } from "@cabn/cli";
import { describe, expect, it } from "vitest";
import { DEMO_CSP_DIRECTIVES } from "../csp-policy.mjs";

const worldsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"public",
	"worlds",
);
const WORLDS = ["sample", "notes"].map((name) => join(worldsDir, name));

describe("demo CSP frame-src", () => {
	// From the built world.json files, not the cabn.json inputs: what a page
	// can actually frame is whatever the converter wrote after merging an
	// injected config, so that is what the policy has to match.
	it("is the union of every built demo world's allowedEmbedOrigins", async () => {
		for (const dir of WORLDS) {
			await stat(join(dir, "world.json")).catch(() => {
				throw new Error(
					`${dir}/world.json is missing: run \`pnpm -r build\` (or \`pnpm -F @cabn/demo build:world\`) first`,
				);
			});
		}
		expect([...DEMO_CSP_DIRECTIVES["frame-src"]].sort()).toEqual(
			await collectWorldEmbedOrigins(WORLDS),
		);
	});
});
