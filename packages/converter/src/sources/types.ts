export interface SourceEntry {
	/** Relative, posix-separated path from the source root. */
	path: string;
	bytes: number;
	/**
	 * undefined means the source withheld this entry's content (e.g. a zip's
	 * archive-wide byte cap tripped partway through it, even though `bytes` is
	 * under any per-file cap) — distinct from a real zero-byte file, which
	 * resolves to an empty Uint8Array. Callers must not treat undefined as "".
	 */
	read(): Promise<Uint8Array | undefined>;
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
