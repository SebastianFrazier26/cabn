/**
 * Worker thread entry point for isolated, time-limited conversions.
 * 2026-10-01: Runs convert() in a bounded context: resource limits, hard
 * timeout, and validation of zip inflation bounds before processing.
 */

import { parentPort } from "node:worker_threads";
import {
	convert,
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	ZipSource,
} from "@cabn/converter";

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

async function handleMessage(
	msg: ConversionRequest,
): Promise<ConversionResult | ConversionError> {
	try {
		const zipBytes = new Uint8Array(msg.zipBytes);

		const zipSource = new ZipSource(zipBytes, {
			maxFiles: DEFAULT_MAX_FILES,
			maxFileBytes: DEFAULT_MAX_FILE_BYTES,
			maxTotalBytes: msg.maxZipInflationBytes,
		});

		const bundle = await convert(zipSource, {
			name: "uploaded world",
			source: "upload.zip",
			maxFiles: DEFAULT_MAX_FILES,
			maxFileBytes: DEFAULT_MAX_FILE_BYTES,
			mediaMaxFileBytes: DEFAULT_MAX_FILE_BYTES,
			mediaMaxTotalBytes: msg.maxZipInflationBytes,
			embedNetwork: undefined,
		});

		return { bundle: Array.from(bundle) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { error: `conversion failed: ${message}` };
	}
}

if (!parentPort) {
	throw new Error("converter-worker must run in a worker thread");
}

parentPort.on("message", async (msg: ConversionRequest) => {
	const result = await handleMessage(msg);
	parentPort!.postMessage(result);
});
