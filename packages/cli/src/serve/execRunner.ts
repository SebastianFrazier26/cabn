import { type ChildProcess, spawn } from "node:child_process";
import { flushTraceCarry, parseTraceChunk } from "./pyTracer.js";

export type ExecEvent =
	| { type: "stdout"; text: string }
	| { type: "stderr"; text: string }
	| { type: "line"; line: number }
	| { type: "exit"; code: number | null }
	| { type: "timeout" }
	| { type: "error"; message: string };

export interface RunScriptOptions {
	cwd: string;
	/** True only for the python tracer wrapper — its stderr is `parseTraceChunk`d for `\x1eLINE n` markers; every other runtime's stderr is forwarded untouched (see runtime.ts's "JS/TS: no real line tracing" note). */
	traced: boolean;
	timeoutMs?: number;
	outputCapBytes?: number;
	onEvent: (event: ExecEvent) => void;
}

export interface RunningScript {
	done: Promise<void>;
	/** Kills the whole process group (or just the process on Windows) — used for both the timeout and an early client disconnect. */
	kill(signal?: NodeJS.Signals): void;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_OUTPUT_CAP_BYTES = 256 * 1024;

/**
 * Spawns exactly `command`/`args` with `child_process.spawn` (never a shell —
 * no string ever gets shell-interpreted, so there's no injection surface
 * beyond the allowlisted interpreter itself) in a detached process group on
 * POSIX so a runaway child's own children die with it, a minimal env (PATH +
 * HOME only — no inherited secrets from this server's own process env), and
 * hard per-stream output caps that stop accumulating (and kill the process,
 * see below) once reached.
 */
export function runScript(
	command: string,
	args: string[],
	opts: RunScriptOptions,
): RunningScript {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const capBytes = opts.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
	const env: NodeJS.ProcessEnv = {};
	if (process.env.PATH) env.PATH = process.env.PATH;
	if (process.env.HOME) env.HOME = process.env.HOME;

	const child: ChildProcess = spawn(command, args, {
		cwd: opts.cwd,
		env,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdoutBytes = 0;
	let stderrBytes = 0;
	let stderrCarry = "";
	let settled = false;

	const killTree = (signal: NodeJS.Signals): void => {
		if (child.pid === undefined) return;
		try {
			if (process.platform !== "win32") process.kill(-child.pid, signal);
			else child.kill(signal);
		} catch {
			// Already exited between the caller's decision to kill and this call.
		}
	};

	const timer = setTimeout(() => {
		opts.onEvent({ type: "timeout" });
		killTree("SIGKILL");
	}, timeoutMs);

	child.stdout?.on("data", (chunk: Buffer) => {
		if (stdoutBytes >= capBytes) return;
		const slice = chunk.subarray(0, capBytes - stdoutBytes);
		stdoutBytes += slice.length;
		opts.onEvent({ type: "stdout", text: slice.toString("utf8") });
		if (stdoutBytes >= capBytes) {
			opts.onEvent({
				type: "stdout",
				text: "\n[stdout truncated: output cap reached]\n",
			});
			killTree("SIGKILL");
		}
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		if (stderrBytes >= capBytes) return;
		const slice = chunk.subarray(0, capBytes - stderrBytes);
		stderrBytes += slice.length;
		const raw = slice.toString("utf8");
		if (opts.traced) {
			const parsed = parseTraceChunk(stderrCarry, raw);
			stderrCarry = parsed.carry;
			for (const event of parsed.events)
				opts.onEvent({ type: "line", line: event.line });
			if (parsed.text) opts.onEvent({ type: "stderr", text: parsed.text });
		} else if (raw) {
			opts.onEvent({ type: "stderr", text: raw });
		}
		if (stderrBytes >= capBytes) {
			opts.onEvent({
				type: "stderr",
				text: "\n[stderr truncated: output cap reached]\n",
			});
			killTree("SIGKILL");
		}
	});

	const done = new Promise<void>((resolveDone) => {
		const finish = (code: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (opts.traced) {
				const rest = flushTraceCarry(stderrCarry);
				if (rest) opts.onEvent({ type: "stderr", text: rest });
			}
			opts.onEvent({ type: "exit", code });
			resolveDone();
		};

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			opts.onEvent({ type: "error", message: err.message });
			resolveDone();
		});
		child.on("close", finish);
	});

	return { done, kill: killTree };
}
