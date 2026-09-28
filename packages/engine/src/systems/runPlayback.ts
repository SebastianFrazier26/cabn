import type { TraceStep } from "./trace/buildTraceScript.js";

export type RunStatus = "playing" | "paused" | "blocked" | "done";
export type RunSpeed = 1 | 2 | 4;

/** ms per step at 1x — a step every ~0.7s reads as a guided walk, not a flicker, while still finishing a short file in a few seconds. */
export const BASE_STEP_INTERVAL_MS = 700;

export interface RunPlaybackState {
	steps: TraceStep[];
	/** Index into `steps` of the step currently shown — always a valid index once any step exists (there's no "before the first step" state; START lands on step 0 immediately). */
	index: number;
	status: RunStatus;
	speed: RunSpeed;
	/** Accumulated ms toward the next auto-advance while `status === "playing"`; irrelevant otherwise (reset on PAUSE/STEP so resuming doesn't burst-advance). */
	elapsedMs: number;
	blockedMessage?: string;
	/** Human-readable running log the parchment overlay renders — one entry per step reached, plus BLOCK/APPEND_LOG entries interleaved (e.g. real stdout/stderr lines for a LocalRunProvider run). */
	log: string[];
}

export type RunPlaybackAction =
	| { type: "START"; steps: TraceStep[] }
	| { type: "PLAY" }
	| { type: "PAUSE" }
	| { type: "STEP" }
	| { type: "STOP" }
	| { type: "SET_SPEED"; speed: RunSpeed }
	| { type: "BLOCK"; message: string }
	| { type: "APPEND_LOG"; line: string }
	| { type: "TICK"; deltaMs: number };

function describeKind(kind: TraceStep["kind"]): string {
	switch (kind) {
		case "import":
			return "import";
		case "def":
			return "define";
		case "call":
			return "call";
		case "return":
			return "return";
		default:
			return "run";
	}
}

function formatStepLogEntry(step: TraceStep): string {
	return `line ${step.line}: ${step.note ?? describeKind(step.kind)}`;
}

export function createIdleRunPlaybackState(
	speed: RunSpeed = 1,
): RunPlaybackState {
	return { steps: [], index: 0, status: "done", speed, elapsedMs: 0, log: [] };
}

function startState(steps: TraceStep[], speed: RunSpeed): RunPlaybackState {
	if (steps.length === 0) {
		return { steps, index: 0, status: "done", speed, elapsedMs: 0, log: [] };
	}
	return {
		steps,
		index: 0,
		status: "playing",
		speed,
		elapsedMs: 0,
		log: [formatStepLogEntry(steps[0] as TraceStep)],
	};
}

/** Moves to the next step if one exists; otherwise flips to "done" and leaves `index` where it was — the last step stays visible instead of running off the end. */
function advanceOnce(state: RunPlaybackState): RunPlaybackState {
	if (state.index >= state.steps.length - 1) {
		return { ...state, status: "done" };
	}
	const nextIndex = state.index + 1;
	const step = state.steps[nextIndex] as TraceStep;
	return {
		...state,
		index: nextIndex,
		log: [...state.log, formatStepLogEntry(step)],
	};
}

/**
 * Pure reducer driving the parchment overlay's play/pause/step/speed/stop
 * controls plus a monster-blocks-the-way pause — all state transitions live
 * here so FileScene only has to dispatch actions and read the result, never
 * branch on "what does Space do right now" itself. `TICK` is the one action
 * a scene's `update(time, delta)` calls every frame; everything else is a
 * discrete user action or engine event (BLOCK).
 */
export function runPlaybackReducer(
	state: RunPlaybackState,
	action: RunPlaybackAction,
): RunPlaybackState {
	switch (action.type) {
		case "START":
			return startState(action.steps, state.speed);
		case "PLAY":
			if (state.status === "done" || state.steps.length === 0) return state;
			return { ...state, status: "playing", elapsedMs: 0 };
		case "PAUSE":
			if (state.status !== "playing" && state.status !== "blocked") {
				return state;
			}
			return { ...state, status: "paused" };
		case "STEP": {
			if (state.status === "done" || state.steps.length === 0) return state;
			const advanced = advanceOnce(state);
			return {
				...advanced,
				status: advanced.status === "done" ? "done" : "paused",
				elapsedMs: 0,
			};
		}
		case "STOP":
			return createIdleRunPlaybackState(state.speed);
		case "SET_SPEED":
			return { ...state, speed: action.speed };
		case "BLOCK":
			if (state.status === "done") return state;
			return { ...state, status: "blocked", blockedMessage: action.message };
		case "APPEND_LOG":
			return { ...state, log: [...state.log, action.line] };
		case "TICK": {
			if (state.status !== "playing") return state;
			let next: RunPlaybackState = {
				...state,
				elapsedMs: state.elapsedMs + action.deltaMs * state.speed,
			};
			while (
				next.elapsedMs >= BASE_STEP_INTERVAL_MS &&
				next.status === "playing"
			) {
				next = {
					...advanceOnce(next),
					elapsedMs: next.elapsedMs - BASE_STEP_INTERVAL_MS,
				};
			}
			return next;
		}
		default:
			return state;
	}
}

export function currentStep(state: RunPlaybackState): TraceStep | undefined {
	return state.steps[state.index];
}
