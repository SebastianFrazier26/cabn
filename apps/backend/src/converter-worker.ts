import { parentPort, workerData } from "node:worker_threads";
import {
	convert,
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	ZipSource,
} from "@cabn/converter";
import { zipSync } from "fflate";
import type { WorkerJob, WorkerReply } from "./converter-protocol.js";
import { checkZipLimits } from "./zip-limits.js";

// The converter never needs the network here (embedNetwork stays undefined
// below); removing fetch means a future converter change can't quietly turn
// an upload's cabn.json into requests from this server's network position.
globalThis.fetch = () =>
	Promise.reject(new Error("network access is disabled in the converter"));

async function run(job: WorkerJob): Promise<WorkerReply> {
	const verdict = checkZipLimits(job.zip, {
		maxInflationBytes: job.maxZipInflationBytes,
		maxCompressionRatio: job.maxCompressionRatio,
	});
	if (!verdict.ok) {
		return verdict.reason === "unreadable"
			? { kind: "failed", detail: "central directory unreadable" }
			: { kind: "rejected", reason: verdict.reason };
	}

	try {
		const zipSource = new ZipSource(job.zip, {
			maxFiles: DEFAULT_MAX_FILES,
			maxFileBytes: DEFAULT_MAX_FILE_BYTES,
			maxTotalBytes: job.maxZipInflationBytes,
		});
		// includeSecrets is never passed — secret-pattern files (.env, *.pem,
		// id_rsa*, ...) stay metadata-only, same default as everywhere else.
		const bundle = await convert(zipSource, {
			name: "uploaded world",
			source: "upload.zip",
			maxFiles: DEFAULT_MAX_FILES,
			maxFileBytes: DEFAULT_MAX_FILE_BYTES,
			// Host ceilings an uploaded cabn.json can lower but never raise: no
			// media file bigger than the extraction cap, and no more media in the
			// response than the upload itself was allowed to carry.
			mediaMaxFileBytes: DEFAULT_MAX_FILE_BYTES,
			mediaMaxTotalBytes: job.mediaMaxTotalBytes,
			// Always offline: the embed check fetches whatever urls the upload's
			// cabn.json names, which would let any API caller aim this server at
			// internal hosts (SSRF). Url previews are recorded as assumed framable.
			embedNetwork: undefined,
		});
		const encoder = new TextEncoder();
		const files: Record<string, Uint8Array> = {};
		for (const [path, value] of bundle) {
			files[path] = typeof value === "string" ? encoder.encode(value) : value;
		}
		return { kind: "ok", zip: zipSync(files) };
	} catch (err) {
		return {
			kind: "failed",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

const port = parentPort;
if (!port) throw new Error("converter-worker must run in a worker thread");

const reply = await run(workerData as WorkerJob);
port.postMessage(
	reply,
	reply.kind === "ok" ? [reply.zip.buffer as ArrayBuffer] : [],
);
