import { type GuideTopic, guideTopics } from "./guideContent.js";

/** A load shorter than this never shows the overlay at all: most scene switches finish under the transition that covers them. */
export const LOADING_SHOW_DELAY_MS = 300;
/** Once shown, the overlay stays at least this long, so a load that ends just after the delay doesn't blink the panel. */
export const LOADING_MIN_VISIBLE_MS = 400;
export const LOADING_TIP_ROTATE_MS = 4500;

export type LoadingToken = number;

export interface LoadingError {
	message: string;
	/** The technical line under the friendly one (what failed, the HTTP status). */
	detail?: string;
	retry?: () => void;
	back?: () => void;
	/** "Back to shelf" unless the caller knows a better way out. */
	backLabel?: string;
}

export interface LoadingState {
	/** At least one load is in flight, shown or not yet. */
	active: boolean;
	/** The overlay is on screen (an error always is). */
	visible: boolean;
	label: string;
	/** 0..1 when the load knows how far along it is; null draws no bar. */
	progress: number | null;
	detail: string | null;
	error: LoadingError | null;
}

export interface BeginLoadingOptions {
	/** Overrides LOADING_SHOW_DELAY_MS — a load that starts under a transition's fade-out adds the fade to it. */
	delayMs?: number;
	detail?: string;
}

export interface LoadingClock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const IDLE_LOADING_STATE: LoadingState = {
	active: false,
	visible: false,
	label: "",
	progress: null,
	detail: null,
	error: null,
};

const systemClock: LoadingClock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry {
	label: string;
	progress: number | null;
	detail: string | null;
	showAt: number;
}

/**
 * Every in-flight load holds its own token, so two overlapping loads (a
 * universe conversion handing over to the scene load it triggers) never end
 * each other: the overlay stays while any token is open and shows the most
 * recent one's label.
 */
export class LoadingTracker {
	private readonly entries = new Map<LoadingToken, Entry>();
	private nextToken = 1;
	private visibleSince: number | null = null;
	private error: LoadingError | null = null;
	private timer: unknown = null;
	/** What the panel keeps showing while it lingers out its minimum time after the last token ended. */
	private lingering: Omit<Entry, "showAt"> | null = null;
	private current: LoadingState = IDLE_LOADING_STATE;

	constructor(
		private readonly onChange: (state: LoadingState) => void,
		private readonly clock: LoadingClock = systemClock,
	) {}

	get state(): LoadingState {
		return this.current;
	}

	begin(label: string, options: BeginLoadingOptions = {}): LoadingToken {
		const token = this.nextToken++;
		this.entries.set(token, {
			label,
			progress: null,
			detail: options.detail ?? null,
			showAt: this.clock.now() + (options.delayMs ?? LOADING_SHOW_DELAY_MS),
		});
		this.update();
		return token;
	}

	setProgress(
		token: LoadingToken,
		progress: number | null,
		detail?: string | null,
	): void {
		const entry = this.entries.get(token);
		if (!entry) return;
		entry.progress =
			progress === null ? null : Math.min(1, Math.max(0, progress));
		if (detail !== undefined) entry.detail = detail;
		this.update();
	}

	/** Unknown and already-ended tokens are ignored, so ending twice is safe. */
	end(token: LoadingToken): void {
		const entry = this.entries.get(token);
		if (!entry) return;
		this.entries.delete(token);
		if (this.entries.size === 0)
			this.lingering = {
				label: entry.label,
				progress: entry.progress === null ? null : 1,
				detail: entry.detail,
			};
		this.update();
	}

	/** Ends the token and puts the error up at once; it stays until clearError (its retry/back buttons call that first). */
	fail(token: LoadingToken, error: LoadingError): void {
		const entry = this.entries.get(token);
		if (!entry) return;
		this.entries.delete(token);
		this.error = error;
		this.lingering = { label: entry.label, progress: null, detail: null };
		if (this.visibleSince === null) this.visibleSince = this.clock.now();
		this.update();
	}

	clearError(): void {
		if (!this.error) return;
		this.error = null;
		this.lingering = null;
		// The error was the panel: dismissing it hides the panel straight away
		// (no minimum-time linger) unless a load is still waiting behind it.
		this.visibleSince = this.entries.size > 0 ? this.clock.now() : null;
		this.update();
	}

	private update(): void {
		if (this.timer !== null) {
			this.clock.clearTimeout(this.timer);
			this.timer = null;
		}
		const now = this.clock.now();
		if (this.error) {
			this.publish(true);
			return;
		}
		if (this.entries.size > 0) {
			this.lingering = null;
			if (this.visibleSince === null) {
				let showAt = Number.POSITIVE_INFINITY;
				for (const entry of this.entries.values())
					showAt = Math.min(showAt, entry.showAt);
				if (now >= showAt) this.visibleSince = now;
				else this.schedule(showAt - now);
			}
			this.publish(this.visibleSince !== null);
			return;
		}
		if (this.visibleSince !== null) {
			const hideAt = this.visibleSince + LOADING_MIN_VISIBLE_MS;
			if (now >= hideAt) this.visibleSince = null;
			else this.schedule(hideAt - now);
		}
		if (this.visibleSince === null) this.lingering = null;
		this.publish(this.visibleSince !== null);
	}

	private schedule(ms: number): void {
		this.timer = this.clock.setTimeout(() => {
			this.timer = null;
			this.update();
		}, ms);
	}

	private publish(visible: boolean): void {
		let top: Omit<Entry, "showAt"> | null = null;
		for (const entry of this.entries.values()) top = entry;
		top ??= this.lingering;
		const next: LoadingState = {
			active: this.entries.size > 0,
			visible,
			label: top?.label ?? "",
			progress: top?.progress ?? null,
			detail: top?.detail ?? null,
			error: this.error,
		};
		const prev = this.current;
		if (
			prev.active === next.active &&
			prev.visible === next.visible &&
			prev.label === next.label &&
			prev.progress === next.progress &&
			prev.detail === next.detail &&
			prev.error === next.error
		)
			return;
		this.current = next;
		this.onChange(next);
	}
}

const MAX_TIP_LENGTH = 170;

/**
 * Wren's own lines, reused as loading tips: one source for both, so a
 * rebound key can't leave a tip quoting the old one. Pages that only make
 * sense mid-conversation (monster name lists, the greeting) are skipped.
 */
export function loadingTips(topics: GuideTopic[] = guideTopics()): string[] {
	const skip = new Set(["monsters"]);
	return topics
		.filter((topic) => !skip.has(topic.id))
		.flatMap((topic) => topic.pages)
		.filter((page) => !page.includes("\n") && page.length <= MAX_TIP_LENGTH);
}
