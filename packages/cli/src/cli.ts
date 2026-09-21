import { parseArgs } from "node:util";
import { runBuild } from "./build.js";
import { CLI_VERSION, helpText } from "./help.js";
import { formatSummary, runInspect } from "./inspect.js";
import { runShelf } from "./shelf.js";

async function build(rest: string[]): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: rest,
			options: {
				out: { type: "string", short: "o" },
				"include-secrets": { type: "boolean" },
			},
			allowPositionals: true,
		});
		const input = positionals[0];
		if (!input) {
			console.error("cabn build: missing <dir|zipfile>");
			return 1;
		}

		const summary = await runBuild(input, {
			outDir: values.out,
			includeSecrets: values["include-secrets"],
		});
		console.log(`Built world at ${summary.outDir}`);
		console.log(
			`${summary.clusters} clusters, ${summary.portals} portals, ${summary.bytes} bytes in ${summary.elapsedMs}ms`,
		);
		if (summary.truncated) {
			console.warn(
				`Warning: partial world — ${summary.skippedFiles} file(s) were dropped by the converter's caps (maxFiles/archive limits).`,
			);
		}
		return 0;
	} catch (err) {
		console.error(`cabn build failed: ${(err as Error).message}`);
		return 1;
	}
}

async function inspect(rest: string[]): Promise<number> {
	try {
		const { positionals } = parseArgs({ args: rest, allowPositionals: true });
		const bundleDir = positionals[0];
		if (!bundleDir) {
			console.error("cabn inspect: missing <bundleDir>");
			return 1;
		}

		const manifest = await runInspect(bundleDir);
		console.log(formatSummary(manifest));
		return 0;
	} catch (err) {
		console.error(`cabn inspect failed: ${(err as Error).message}`);
		return 1;
	}
}

async function shelf(rest: string[]): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: rest,
			options: { out: { type: "string", short: "o" } },
			allowPositionals: true,
		});
		if (positionals.length === 0) {
			console.error("cabn shelf: missing <bundleDir...>");
			return 1;
		}

		const summary = await runShelf(positionals, { outDir: values.out });
		console.log(`Wrote shelf at ${summary.outDir} (${summary.worlds} worlds)`);
		return 0;
	} catch (err) {
		console.error(`cabn shelf failed: ${(err as Error).message}`);
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
	if (command === "shelf") return shelf(rest);

	console.error(`cabn: unknown command "${command}"`);
	console.log(helpText());
	return 1;
}
