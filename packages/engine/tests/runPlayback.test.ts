import { describe, expect, it } from "vitest";
import {
	BASE_STEP_INTERVAL_MS,
	createIdleRunPlaybackState,
	currentStep,
	type RunPlaybackState,
	runPlaybackReducer,
} from "../src/systems/runPlayback.js";
import type { TraceStep } from "../src/systems/trace/buildTraceScript.js";

const STEPS: TraceStep[] = [
	{ line: 1, kind: "import" },
	{ line: 2, kind: "def", note: "define helper" },
	{ line: 5, kind: "call", note: "call helper" },
	{ line: 3, kind: "return" },
];

function start(speed: 1 | 2 | 4 = 1): RunPlaybackState {
	return runPlaybackReducer(createIdleRunPlaybackState(speed), {
		type: "START",
		steps: STEPS,
	});
}

describe("runPlaybackReducer", () => {
	it("START lands on step 0, playing, with the first log entry", () => {
		const state = start();
		expect(state.status).toBe("playing");
		expect(state.index).toBe(0);
		expect(currentStep(state)).toEqual(STEPS[0]);
		expect(state.log).toEqual(["line 1: import"]);
	});

	it("START with zero steps goes straight to done", () => {
		const state = runPlaybackReducer(createIdleRunPlaybackState(), {
			type: "START",
			steps: [],
		});
		expect(state.status).toBe("done");
	});

	it("TICK advances one step once BASE_STEP_INTERVAL_MS elapses at 1x", () => {
		let state = start();
		state = runPlaybackReducer(state, {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS - 1,
		});
		expect(state.index).toBe(0);
		state = runPlaybackReducer(state, { type: "TICK", deltaMs: 1 });
		expect(state.index).toBe(1);
		expect(state.log).toEqual(["line 1: import", "line 2: define helper"]);
	});

	it("TICK at 2x advances twice as fast", () => {
		let state = start(2);
		state = runPlaybackReducer(state, {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS / 2,
		});
		expect(state.index).toBe(1);
	});

	it("TICK can advance multiple steps in one call for a large delta", () => {
		// 3 intervals reaches the last index (3) but doesn't try to advance past
		// it, so playback is still "playing" — done requires one more attempt
		// (see the next test).
		const state = runPlaybackReducer(start(), {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS * 3,
		});
		expect(state.index).toBe(3);
		expect(state.status).toBe("playing");
	});

	it("reaching the last step flips to done and stays there instead of running off the end", () => {
		let state = start();
		for (let i = 0; i < 10; i++) {
			state = runPlaybackReducer(state, {
				type: "TICK",
				deltaMs: BASE_STEP_INTERVAL_MS,
			});
		}
		expect(state.status).toBe("done");
		expect(state.index).toBe(STEPS.length - 1);
	});

	it("PAUSE stops TICK from advancing", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "PAUSE" });
		expect(state.status).toBe("paused");
		state = runPlaybackReducer(state, {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS * 5,
		});
		expect(state.index).toBe(0);
	});

	it("PLAY resumes from paused", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "PAUSE" });
		state = runPlaybackReducer(state, { type: "PLAY" });
		expect(state.status).toBe("playing");
	});

	it("PLAY is a no-op once done", () => {
		let state = start();
		for (let i = 0; i < 10; i++) {
			state = runPlaybackReducer(state, {
				type: "TICK",
				deltaMs: BASE_STEP_INTERVAL_MS,
			});
		}
		state = runPlaybackReducer(state, { type: "PLAY" });
		expect(state.status).toBe("done");
	});

	it("STEP advances exactly one step and pauses regardless of prior status", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "STEP" });
		expect(state.index).toBe(1);
		expect(state.status).toBe("paused");
		state = runPlaybackReducer(state, {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS * 5,
		});
		expect(state.index).toBe(1); // paused, TICK is inert
	});

	it("STEP at the last step flips to done", () => {
		let state = start();
		for (let i = 0; i < STEPS.length - 1; i++) {
			state = runPlaybackReducer(state, { type: "STEP" });
		}
		expect(state.index).toBe(STEPS.length - 1);
		state = runPlaybackReducer(state, { type: "STEP" });
		expect(state.status).toBe("done");
		expect(state.index).toBe(STEPS.length - 1);
	});

	it("STOP resets to an idle, empty-step done state", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "STEP" });
		state = runPlaybackReducer(state, { type: "STOP" });
		expect(state.status).toBe("done");
		expect(state.steps).toEqual([]);
		expect(state.log).toEqual([]);
	});

	it("SET_SPEED changes speed without touching index/status", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "STEP" });
		state = runPlaybackReducer(state, { type: "SET_SPEED", speed: 4 });
		expect(state.speed).toBe(4);
		expect(state.index).toBe(1);
		expect(state.status).toBe("paused");
	});

	it("BLOCK pauses with a message and TICK stays inert until PLAY/STEP resumes", () => {
		let state = start();
		state = runPlaybackReducer(state, {
			type: "BLOCK",
			message: "a ghost blocks the way",
		});
		expect(state.status).toBe("blocked");
		expect(state.blockedMessage).toBe("a ghost blocks the way");
		state = runPlaybackReducer(state, {
			type: "TICK",
			deltaMs: BASE_STEP_INTERVAL_MS * 5,
		});
		expect(state.index).toBe(0);

		state = runPlaybackReducer(state, { type: "PLAY" });
		expect(state.status).toBe("playing");
	});

	it("BLOCK is a no-op once done", () => {
		let state = start();
		for (let i = 0; i < 10; i++) {
			state = runPlaybackReducer(state, {
				type: "TICK",
				deltaMs: BASE_STEP_INTERVAL_MS,
			});
		}
		state = runPlaybackReducer(state, { type: "BLOCK", message: "x" });
		expect(state.status).toBe("done");
	});

	it("APPEND_LOG adds a line without moving the index — used for real stdout/stderr", () => {
		let state = start();
		state = runPlaybackReducer(state, { type: "APPEND_LOG", line: "hello" });
		expect(state.index).toBe(0);
		expect(state.log).toEqual(["line 1: import", "hello"]);
	});
});
