export interface SourceEntry {
	/** Relative, posix-separated path from the source root. */
	path: string;
	bytes: number;
	read(): Promise<Uint8Array>;
}

export interface FileSource {
	entries(): AsyncIterable<SourceEntry>;
}
