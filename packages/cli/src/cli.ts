import { parseArgs } from "node:util";
import { runBuild } from "./build.js";
import { CLI_VERSION, helpText } from "./help.js";
import { formatSummary, runInspect } from "./inspect.js";
import { DEFAULT_SERVE_PORT, startServe } from "./serve/server.js";
import { runShelf } from "./shelf.js";

async function build(rest: string[]): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: rest,
			options: {
				out: { type: "string", short: "o" },
				"include-secrets": { type: "boolean" },
				findings: { type: "string", multiple: true },
				offline: { type: "boolean" },
				"no-history": { type: "boolean" },
				"git-dir": { type: "string" },
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
			findingsPaths: values.findings,
			offline: values.offline,
			history: !values["no-history"],
			gitDir: values["git-dir"],
		});
		console.log(`Built world at ${summary.outDir}`);
		console.log(
			`${summary.clusters} clusters, ${summary.portals} portals, ${summary.monsters} monsters, ${summary.bytes} bytes in ${summary.elapsedMs}ms`,
		);
		if (summary.findings) {
			const { ingested, attached, dropped } = summary.findings;
			console.log(
				`Findings: ${attached} of ${ingested} became monsters (${dropped} dropped: path not in this world, duplicate of a built-in monster, or over a cap)`,
			);
		}
		for (const b of summary.embedBlocked) {
			console.log(
				`Note: ${b.portalId} -> ${b.url} refuses to be framed${b.detail ? ` (${b.detail})` : ""}; the world shows its title card and an "Open in browser" button instead.`,
			);
		}
		if (summary.history) {
			const h = summary.history;
			console.log(
				`History: ${h.commits} commits across ${h.branches} branch(es), ${h.tags} tag(s); universes: ${h.universes.length ? h.universes.join(", ") : "none"}; releases: ${h.releases}${h.releaseCount ? ` (${h.releaseCount})` : ""}`,
			);
		}
		for (const warning of summary.warnings) console.warn(`Note: ${warning}`);
		if (values.offline) {
			console.log(
				"Embed check and GitHub releases skipped (--offline): url previews are assumed framable.",
			);
		}
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

async function serve(rest: string[]): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: rest,
			options: {
				port: { type: "string" },
				"allow-exec": { type: "boolean" },
				timeout: { type: "string" },
				offline: { type: "boolean" },
				owner: { type: "boolean" },
				"no-history": { type: "boolean" },
				"git-dir": { type: "string" },
			},
			allowPositionals: true,
		});
		const dir = positionals[0];
		if (!dir) {
			console.error("cabn serve: missing <dir>");
			return 1;
		}

		const handle = await startServe(dir, {
			port: values.port ? Number(values.port) : DEFAULT_SERVE_PORT,
			allowExec: values["allow-exec"] ?? false,
			timeoutMs: values.timeout ? Number(values.timeout) : undefined,
			offline: values.offline ?? false,
			owner: values.owner ?? false,
			history: !values["no-history"],
			gitDir: values["git-dir"],
		});
		// Never resolves on its own — `cabn serve` is a long-running command,
		// stopped by the user (Ctrl-C) rather than exiting once "done".
		await new Promise<void>((resolveForever) => {
			process.once("SIGINT", () => {
				handle.close().then(() => resolveForever());
			});
		});
		return 0;
	} catch (err) {
		console.error(`cabn serve failed: ${(err as Error).message}`);
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
	if (command === "serve") return serve(rest);

	console.error(`cabn: unknown command "${command}"`);
	console.log(helpText());
	return 1;
}
