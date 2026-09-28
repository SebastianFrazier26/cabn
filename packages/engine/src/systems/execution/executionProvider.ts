import type { TraceStep } from "../trace/buildTraceScript.js";
import { buildTraceScript } from "../trace/buildTraceScript.js";

export interface ExecutionRunParams {
	content: string;
	language: string | undefined;
	/** World-relative portal path — TraceProvider ignores it entirely (nothing ever leaves the browser); LocalRunProvider needs it to tell `cabn serve` which file to actually run. */
	filePath: string;
}

/**
 * Both providers resolve to a *complete* step list rather than an
 * incremental stream — see LocalRunProvider's own docs (in the
 * `local-exec` subpath, never imported here) for why a real run still
 * buffers to completion client-side even though the wire protocol streams.
 * That choice is what lets FileScene's runPlayback state machine (built
 * around "here is the whole trace, step through it") stay identical for
 * both providers.
 */
export interface ExecutionProvider {
	id: string;
	run(params: ExecutionRunParams): Promise<TraceStep[]>;
}

/**
 * The default — and, in a hosted/demo build, only — provider. No code from
 * `content` is ever executed; `buildTraceScript` is a pure heuristic (see
 * systems/trace/). This is the one execution capability every build of
 * `@cabn/engine` ships, including the public portfolio demo.
 */
export const traceProvider: ExecutionProvider = {
	id: "trace",
	async run({ content, language }) {
		return buildTraceScript(content, language);
	},
};

let activeProvider: ExecutionProvider = traceProvider;

export function getActiveExecutionProvider(): ExecutionProvider {
	return activeProvider;
}

/**
 * The only way `activeProvider` is ever anything but `traceProvider`: called
 * from a `cabn serve --allow-exec` host page's own entry script via
 * `@cabn/engine/local-exec`'s `installLocalRunProvider` — that subpath is
 * never imported by this package's main entry, by `apps/demo`, or by any
 * other hosted build, so there is no code path reachable from a normal
 * `import "@cabn/engine"` that can ever call this with anything but
 * `traceProvider` itself.
 */
export function setExecutionProvider(provider: ExecutionProvider): void {
	activeProvider = provider;
}

/** Exposed for tests — restores the hosted-build default between cases. */
export function resetExecutionProvider(): void {
	activeProvider = traceProvider;
}
