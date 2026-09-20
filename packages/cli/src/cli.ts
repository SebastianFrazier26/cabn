import { parseArgs } from "node:util";
import { runBuild } from "./build.js";
import { CLI_VERSION, helpText } from "./help.js";
import { formatSummary, runInspect } from "./inspect.js";

async function build(rest: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: rest,
		options: { out: { type: "string", short: "o" } },
		allowPositionals: true,
	});
	const input = positionals[0];
	if (!input) {
		console.error("cabn build: missing <dir|zipfile>");
		return 1;
	}
	try {
		const summary = await runBuild(input, { outDir: values.out });
		console.log(`Built world at ${summary.outDir}`);
		console.log(
			`${summary.clusters} clusters, ${summary.portals} portals, ${summary.bytes} bytes in ${summary.elapsedMs}ms`,
		);
		return 0;
	} catch (err) {
		console.error(`cabn build failed: ${(err as Error).message}`);
		return 1;
	}
}

async function inspect(rest: string[]): Promise<number> {
	const { positionals } = parseArgs({ args: rest, allowPositionals: true });
	const bundleDir = positionals[0];
	if (!bundleDir) {
		console.error("cabn inspect: missing <bundleDir>");
		return 1;
	}
	try {
		const manifest = await runInspect(bundleDir);
		console.log(formatSummary(manifest));
		return 0;
	} catch (err) {
		console.error(`cabn inspect failed: ${(err as Error).message}`);
		return 1;
	}
}

export async function run(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;

	if (!command || command === "--help" || command === "-h") {
		console.log(helpText());
		return 0;
	}
	if (command === "--version" || command === "-v") {
		console.log(CLI_VERSION);
		return 0;
	}
	if (command === "build") return build(rest);
	if (command === "inspect") return inspect(rest);

	console.error(`cabn: unknown command "${command}"`);
	console.log(helpText());
	return 1;
}
