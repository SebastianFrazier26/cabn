/**
 * Pure LRU bookkeeping for loaded chunks. WorldScene owns the actual chunk
 * data (Phaser-adjacent, untested); this module only decides which cluster
 * ids stay resident and which get evicted, so the eviction policy itself is
 * testable without a DOM/canvas.
 */
export interface LruResult {
	/** New order, most-recently-used last. */
	order: string[];
	/** Ids evicted to stay within maxSize (empty if nothing was evicted). */
	evicted: string[];
}

export function touchChunk(
	order: readonly string[],
	clusterId: string,
	maxSize: number,
): LruResult {
	const withoutTouched = order.filter((id) => id !== clusterId);
	const next = [...withoutTouched, clusterId];

	const evicted: string[] = [];
	while (next.length > maxSize) {
		const oldest = next.shift();
		if (oldest !== undefined) evicted.push(oldest);
	}

	return { order: next, evicted };
}
