import { unzipSync } from "fflate";
import type { FileSource, SourceEntry } from "./types.js";

export class ZipSource implements FileSource {
	constructor(private readonly bytes: Uint8Array) {}

	entries(): AsyncIterable<SourceEntry> {
		// unzipSync decompresses the whole archive up front — simpler than a
		// streaming reader, and fine at M1's caps (maxFiles 2000 / 512KB reads).
		const files = unzipSync(this.bytes);
		const entries: SourceEntry[] = Object.entries(files)
			.filter(([path]) => !path.endsWith("/"))
			.map(([path, data]) => ({
				path,
				bytes: data.length,
				read: () => Promise.resolve(data),
			}));

		return {
			async *[Symbol.asyncIterator]() {
				yield* entries;
			},
		};
	}
}
