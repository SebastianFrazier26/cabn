/** Sent as `workerData`; `zip` is transferred, never shared. */
export interface WorkerJob {
	zip: Uint8Array;
	maxZipInflationBytes: number;
	maxCompressionRatio: number;
	mediaMaxTotalBytes: number;
}

export type WorkerReply =
	| { kind: "ok"; zip: Uint8Array }
	| { kind: "rejected"; reason: "inflation" | "ratio" }
	/** `detail` is for the server log only; it never reaches the client. */
	| { kind: "failed"; detail: string };
