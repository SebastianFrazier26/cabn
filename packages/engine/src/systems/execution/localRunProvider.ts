import type { TraceStep } from "../trace/buildTraceScript.js";
import { buildTraceScript } from "../trace/buildTraceScript.js";
import {
	type ExecutionProvider,
	type ExecutionRunParams,
	setExecutionProvider,
} from "./executionProvider.js";

export interface LocalRunProviderOptions {
	/** The origin `cabn serve` printed, e.g. "http://127.0.0.1:5178" — never guessed; the host page bakes its own origin in at bundle time (see hostPage.ts). */
	baseUrl: string;
	/** The per-process session token — every exec request must present it (see cabn serve's security docs); without it the server answers 403. */
	token: string;
}

type ServerExecEvent =
	| { type: "stdout"; text: string }
	| { type: "stderr"; text: string }
	| { type: "line"; line: number }
	| { type: "exit"; code: number | null }
	| { type: "timeout" }
	| { type: "error"; message: string };

/** Parses the server's newline-delimited JSON stream as it arrives — a malformed line is skipped rather than aborting an otherwise-good run (the process itself, not this parser, is the source of truth for whether the run succeeded). */
async function* readNdjson(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerExecEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			if (line.trim()) {
				try {
					yield JSON.parse(line) as ServerExecEvent;
				} catch {
					// Ignore a corrupt line rather than dropping the whole run.
				}
			}
			newlineIndex = buffer.indexOf("\n");
		}
	}
}

function isApproximateLineLanguage(language: string | undefined): boolean {
	return language === "javascript" || language === "typescript";
}

/**
 * REAL execution, over the wire to a `cabn serve --allow-exec` process —
 * never present in a hosted/demo build (see this module's own package.json
 * subpath: nothing outside a `cabn serve` host page ever imports
 * `@cabn/engine/local-exec`). Python gets genuine per-line tracing (each
 * server `"line"` event becomes its own step, in real execution order); JS/TS
 * has no real line tracing (cabn serve's own limitation — see its docs), so
 * this falls back to the same heuristic `buildTraceScript` used for line
 * *structure* and appends real stdout/stderr as additional steps after it,
 * labeled "approximate lines" by the store's `approximateLines` flag rather
 * than pretending the two are interleaved line-for-line.
 */
export function createLocalRunProvider(
	opts: LocalRunProviderOptions,
): ExecutionProvider {
	return {
		id: "local",
		async run({
			filePath,
			content,
			language,
		}: ExecutionRunParams): Promise<TraceStep[]> {
			const response = await fetch(`${opts.baseUrl}/exec`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-cabn-token": opts.token,
				},
				body: JSON.stringify({ path: filePath }),
			});
			if (!response.ok || !response.body) {
				throw new Error(
					`cabn serve exec request failed: HTTP ${response.status}`,
				);
			}

			const approximate = isApproximateLineLanguage(language);
			const heuristicSteps = approximate
				? buildTraceScript(content, language)
				: [];
			const steps: TraceStep[] = [...heuristicSteps];
			let lastLine = heuristicSteps.at(-1)?.line ?? 1;

			for await (const event of readNdjson(response.body)) {
				if (event.type === "line") {
					lastLine = event.line;
					steps.push({ line: event.line, kind: "stmt" });
				} else if (event.type === "stdout" || event.type === "stderr") {
					const text = event.text.trim();
					if (text) steps.push({ line: lastLine, kind: "stmt", note: text });
				} else if (event.type === "timeout") {
					steps.push({ line: lastLine, kind: "stmt", note: "timed out" });
				} else if (event.type === "error") {
					steps.push({
						line: lastLine,
						kind: "stmt",
						note: `error: ${event.message}`,
					});
				}
				// "exit" itself carries nothing worth its own step — runPlayback's
				// own "done" status (reaching the last step) already covers it.
			}
			return steps;
		},
	};
}

export function installLocalRunProvider(opts: LocalRunProviderOptions): void {
	setExecutionProvider(createLocalRunProvider(opts));
}
