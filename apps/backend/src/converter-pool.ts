import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WorkerJob, WorkerReply } from "./converter-protocol.js";

export interface PoolConfig {
	concurrency: number;
	timeoutMs: number;
	maxZipInflationBytes: number;
	maxCompressionRatio: number;
	mediaMaxTotalBytes: number;
	heapLimitMb: number;
	/** Test seam: a different worker script speaking the same protocol. */
	workerFile?: string | URL;
}

export type ConvertOutcome =
	| WorkerReply
	| { kind: "busy" }
	| { kind: "timeout" };

// Under vitest this module runs from src/*.ts, where no .js worker exists and
// a worker thread has no TS loader, so it falls back to the built copy.
function defaultWorkerFile(): string {
	const here = fileURLToPath(import.meta.url);
	const dir = here.endsWith(".ts")
		? join(dirname(here), "..", "dist")
		: dirname(here);
	return join(dir, "converter-worker.js");
}

/**
 * One fresh worker per conversion, never reused: a conversion that ran out of
 * heap or was killed mid-inflate leaves nothing behind for the next upload.
 * No queue: past `concurrency` the caller gets "busy" at once (503), so a burst
 * can't stack up requests that would each wait out someone else's timeout.
 */
export class ConverterPool {
	private readonly active = new Set<Worker>();
	private readonly workerFile: string | URL;

	constructor(private readonly config: PoolConfig) {
		this.workerFile = config.workerFile ?? defaultWorkerFile();
	}

	get activeCount(): number {
		return this.active.size;
	}

	convert(upload: Uint8Array): Promise<ConvertOutcome> {
		if (this.active.size >= this.config.concurrency) {
			return Promise.resolve({ kind: "busy" });
		}

		// A copy, because a multipart Buffer can be a view into a larger pooled
		// ArrayBuffer that must not be handed (or detached) wholesale.
		const zip = new Uint8Array(upload);
		const job: WorkerJob = {
			zip,
			maxZipInflationBytes: this.config.maxZipInflationBytes,
			maxCompressionRatio: this.config.maxCompressionRatio,
			mediaMaxTotalBytes: this.config.mediaMaxTotalBytes,
		};

		const worker = new Worker(this.workerFile, {
			workerData: job,
			transferList: [zip.buffer],
			// The default is a copy of process.env, which holds the API key
			// hashes and whatever else the host injects. The converter reads no
			// environment at all.
			env: {},
			resourceLimits: {
				maxOldGenerationSizeMb: this.config.heapLimitMb,
				maxYoungGenerationSizeMb: Math.min(
					64,
					Math.max(8, Math.floor(this.config.heapLimitMb / 4)),
				),
				stackSizeMb: 4,
			},
		});
		// The slot is held until the thread has actually exited, not merely
		// until the caller got an answer: a terminated worker still burning CPU
		// must keep counting against the limit.
		this.active.add(worker);

		return new Promise<ConvertOutcome>((resolve) => {
			let settled = false;
			const settle = (outcome: ConvertOutcome) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(outcome);
				void worker.terminate();
			};

			const timer = setTimeout(
				() => settle({ kind: "timeout" }),
				this.config.timeoutMs,
			);

			worker.once("message", (reply: WorkerReply) => settle(reply));
			worker.once("error", (err: Error & { code?: string }) =>
				settle({
					kind: "failed",
					detail: err.code ?? err.message,
				}),
			);
			worker.once("exit", (code) => {
				this.active.delete(worker);
				settle({ kind: "failed", detail: `worker exited with code ${code}` });
			});
		});
	}

	async shutdown(): Promise<void> {
		await Promise.all([...this.active].map((w) => w.terminate()));
	}
}
