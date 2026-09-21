export interface SourceEntry {
	/** Relative, posix-separated path from the source root. */
	path: string;
	bytes: number;
	read(): Promise<Uint8Array>;
}

export interface FileSource {
	entries(): AsyncIterable<SourceEntry>;
	/**
	 * Entries the source itself dropped before yielding them at all (e.g. a
	 * zip's archive-wide caps hit mid-extraction) — separate from entries that
	 * are yielded but content-less (oversized single files, still listed).
	 * Optional: sources that can't silently drop entries (DirSource) omit it.
	 */
	droppedEntryCount?(): number;
}
