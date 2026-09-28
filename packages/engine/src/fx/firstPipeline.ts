/**
 * Phaser's `getPostPipeline` returns the lone match, an array of matches, or
 * an EMPTY ARRAY when nothing is attached — never `undefined`. An empty array
 * is truthy, so a plain `if (!pipeline)` check silently skips attaching and
 * then calls methods on `[]`.
 */
export function firstPipeline<T>(
	result: T | T[] | undefined | null,
): T | undefined {
	if (Array.isArray(result)) return result[0];
	return result ?? undefined;
}
