import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { repoRoot } from "./paths.js";

const biomeBin = createRequire(import.meta.url).resolve(
	"@biomejs/biome/bin/biome",
);

/**
 * JSON.stringify expands every array one item per line, but `biome check`
 * (pnpm lint) collapses short ones — so a generator writing raw stringify
 * output leaves a file that either fails lint or gets reformatted, and the
 * next `generate` rewrites it again (tile-index.json's baseVariantFrames did
 * exactly that). Piping through the repo's own Biome, with the target's path
 * so its config applies, is the only way to match it exactly.
 */
export function formatJson(value: unknown, filePath: string): string {
	return execFileSync(
		process.execPath,
		[biomeBin, "format", `--stdin-file-path=${filePath}`],
		{
			cwd: repoRoot,
			input: `${JSON.stringify(value, null, "\t")}\n`,
			encoding: "utf8",
		},
	);
}

export async function writeJsonFile(
	filePath: string,
	value: unknown,
): Promise<void> {
	await writeFile(filePath, formatJson(value, filePath));
}
