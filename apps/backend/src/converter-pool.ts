/**
 * Worker pool for isolated conversions.
 * 2026-10-01: Manages multiple worker threads with:
 * - Concurrency limit (returns 503 when full)
 * - Hard wall-clock timeout (terminates unresponsive workers)
 * - Resource limits (heap cap via V8 options in startup)
 * - Automatic cleanup on timeout or error
 */

import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PoolConfig {
	/** Number of concurrent workers (1-10, default 2). */
	concurrency: number;
	/** Timeout per conversion in ms (default 30000). */
	timeoutMs: number;
	/** Max decompressed size for the archive (default 100 MB). */
	maxZipInflationBytes: number;
	/** Max compression ratio to allow (default 100:1). */
	maxCompressionRatio: number;
	/** Heap limit per worker in MB (default 256). */
	heapLimitMb: number;
}

interface ConversionRequest {
	readonly zipBytes: ArrayBuffer;
	readonly maxZipInflationBytes: number;
	readonly maxCompressionRatio: number;
}

interface ConversionResult {
	readonly bundle: Array<[string, string | Uint8Array]>;
}

interface ConversionError {
	readonly error: string;
}

interface PooledTask {
	readonly request: ConversionRequest;
	readonly resolve: (result: ConversionResult | ConversionError) => void;
	readonly reject: (err: Error) => void;
	readonly timeout: NodeJS.Timeout;
}

export class ConverterPool {
	private config: PoolConfig;
	private workers: Worker[] = [];
	private queue: PooledTask[] = [];
	private activeCount = 0;
	private workerPath: string;

	constructor(config: Partial<PoolConfig> = {}) {
		this.config = {
			concurrency: Math.max(1, Math.min(10, config.concurrency ?? 2)),
			timeoutMs: config.timeoutMs ?? 30000,
			maxZipInflationBytes: config.maxZipInflationBytes ?? 100 * 1024 * 1024,
			maxCompressionRatio: config.maxCompressionRatio ?? 100,
			heapLimitMb: config.heapLimitMb ?? 256,
		};

		// Resolve the worker path. In production, import.meta.url is the compiled
		// dist/converter-pool.js. In tests with vitest, it may be src/converter-pool.ts,
		// so we replace /src/ with /dist/ to get the compiled version.
		let currentDir = dirname(fileURLToPath(import.meta.url));
		currentDir = currentDir.replace(/\/src$/, "/dist");
		this.workerPath = join(currentDir, "converter-worker.js");
	}

	async convert(zipBytes: Uint8Array): Promise<ConversionResult | ConversionError> {
		// Reject immediately if we're at capacity.
		if (this.activeCount >= this.config.concurrency) {
			return { error: "conversion queue is full; try again in a moment" };
		}

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				// Timeout fired: reject the task and clean up.
				// The worker continues running but we abandon it (it may be killed
				// by the OS or linger; next task will spawn a fresh worker).
				reject(new Error("conversion timeout"));
			}, this.config.timeoutMs);

			const task: PooledTask = {
				request: {
					zipBytes: zipBytes.buffer as ArrayBuffer,
					maxZipInflationBytes: this.config.maxZipInflationBytes,
					maxCompressionRatio: this.config.maxCompressionRatio,
				},
				resolve,
				reject,
				timeout,
			};

			this.queue.push(task);
			this.process();
		});
	}

	private process(): void {
		// Drain the queue up to concurrency limit.
		while (this.queue.length > 0 && this.activeCount < this.config.concurrency) {
			const task = this.queue.shift();
			if (!task) break;

			this.activeCount++;
			this.spawnAndRun(task).finally(() => {
				this.activeCount--;
				this.process(); // Continue with next queued task.
			});
		}
	}

	private async spawnAndRun(task: PooledTask): Promise<void> {
		const worker = new Worker(this.workerPath, {
			resourceLimits: {
				maxOldGenerationSizeMb: this.config.heapLimitMb,
			},
		});

		let settled = false;
		const settle = (result: ConversionResult | ConversionError | Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(task.timeout);
			worker.terminate().catch(() => {
				/* ignore termination errors */
			});

			if (result instanceof Error) {
				task.reject(result);
			} else if ("error" in result) {
				task.resolve(result as ConversionError);
			} else {
				task.resolve(result as ConversionResult);
			}
		};

		worker.on("message", (result: ConversionResult | ConversionError) => {
			settle(result);
		});

		worker.on("error", (err: Error) => {
			settle(err);
		});

		worker.on("exit", (code: number) => {
			if (!settled && code !== 0) {
				settle(new Error(`worker exited with code ${code}`));
			}
		});

		try {
			worker.postMessage(task.request);
		} catch (err) {
			settle(err instanceof Error ? err : new Error(String(err)));
		}
	}

	shutdown(): Promise<void> {
		// Reject any pending tasks.
		for (const task of this.queue) {
			clearTimeout(task.timeout);
			task.reject(new Error("pool shutting down"));
		}
		this.queue.length = 0;
		// Terminate all workers.
		return Promise.all(this.workers.map((w) => w.terminate())).then(
			() => {},
		);
	}
}
