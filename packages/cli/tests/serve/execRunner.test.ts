import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ExecEvent, runScript } from "../../src/serve/execRunner.js";
import { runtimeForPath } from "../../src/serve/runtime.js";

const FIXTURE_DIR = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"serve-project",
);

function hasPython3(): boolean {
	try {
		execFileSync("python3", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const pythonAvailable = hasPython3();

async function collect(
	command: string,
	args: string[],
	opts: Parameters<typeof runScript>[2],
) {
	const events: ExecEvent[] = [];
	const running = runScript(command, args, {
		...opts,
		onEvent: (e) => events.push(e),
	});
	await running.done;
	return { events, kill: running.kill };
}

describe("runScript", () => {
	it("runs a node script to completion and reports its exit code", async () => {
		const runtime = runtimeForPath(join(FIXTURE_DIR, "hello.js"));
		expect(runtime).toBeDefined();
		const file = join(FIXTURE_DIR, "hello.js");
		const { events } = await collect(
			runtime?.command as string,
			runtime?.buildArgs(file) as string[],
			{
				cwd: FIXTURE_DIR,
				traced: false,
			},
		);
		const stdout = events
			.filter(
				(e): e is Extract<ExecEvent, { type: "stdout" }> => e.type === "stdout",
			)
			.map((e) => e.text)
			.join("");
		expect(stdout).toContain("hello world");
		expect(events.at(-1)).toEqual({ type: "exit", code: 0 });
	});

	it("kills the process and reports a timeout for a script that never exits", async () => {
		// hang.py produces no output at all — flood.py (used below for the
		// output-cap test) writes so fast under this Python build (~700MB/s)
		// that it would hit even a generous cap before this short timeout ever
		// gets a chance to fire.
		const file = join(FIXTURE_DIR, "hang.py");
		if (!pythonAvailable) return;
		const { events } = await collect("python3", ["-u", file], {
			cwd: FIXTURE_DIR,
			traced: false,
			timeoutMs: 200,
		});
		expect(events.some((e) => e.type === "timeout")).toBe(true);
		expect(events.at(-1)?.type).toBe("exit");
	}, 5000);

	it("truncates stdout once the output cap is reached and kills the process", async () => {
		const file = join(FIXTURE_DIR, "flood.py");
		if (!pythonAvailable) return;
		const { events } = await collect("python3", ["-u", file], {
			cwd: FIXTURE_DIR,
			traced: false,
			outputCapBytes: 500,
			timeoutMs: 5000,
		});
		const stdoutBytes = events
			.filter(
				(e): e is Extract<ExecEvent, { type: "stdout" }> => e.type === "stdout",
			)
			.reduce((total, e) => total + Buffer.byteLength(e.text, "utf8"), 0);
		// The cap plus the small "[stdout truncated]" notice appended after it.
		expect(stdoutBytes).toBeLessThan(600);
		expect(
			events.some((e) => e.type === "stdout" && e.text.includes("truncated")),
		).toBe(true);
	}, 5000);

	it("parses python tracer line markers into line events when traced", async () => {
		if (!pythonAvailable) return;
		const runtime = runtimeForPath(join(FIXTURE_DIR, "hello.py"));
		const file = join(FIXTURE_DIR, "hello.py");
		const { events } = await collect(
			runtime?.command as string,
			runtime?.buildArgs(file) as string[],
			{ cwd: FIXTURE_DIR, traced: true },
		);
		const lines = events
			.filter(
				(e): e is Extract<ExecEvent, { type: "line" }> => e.type === "line",
			)
			.map((e) => e.line);
		expect(lines).toContain(5); // greet("world") at the bottom
		expect(lines).toContain(2); // print(...) inside greet
		const stdout = events
			.filter(
				(e): e is Extract<ExecEvent, { type: "stdout" }> => e.type === "stdout",
			)
			.map((e) => e.text)
			.join("");
		expect(stdout).toContain("hello world");
	});

	it("kill() terminates a running script early (simulating a client disconnect)", async () => {
		if (!pythonAvailable) return;
		const file = join(FIXTURE_DIR, "hang.py");
		const events: ExecEvent[] = [];
		const running = runScript("python3", ["-u", file], {
			cwd: FIXTURE_DIR,
			traced: false,
			timeoutMs: 60_000,
			onEvent: (e) => events.push(e),
		});
		await new Promise((r) => setTimeout(r, 100));
		running.kill("SIGKILL");
		await running.done;
		expect(events.at(-1)?.type).toBe("exit");
	}, 5000);
});
