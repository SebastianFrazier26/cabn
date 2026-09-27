/**
 * Tarjan's SCC algorithm, recursive — fine at the graph sizes a converted
 * project's import graph actually has (walk.ts's DEFAULT_MAX_FILES caps it at
 * 2000 nodes); a call-stack-depth concern would only arise from an import
 * chain thousands of files deep, which no real codebase has. `noUncheckedIndexedAccess`-safe
 * throughout (`?? sentinel` instead of non-null assertions on Map.get).
 */
export function stronglyConnectedComponents(
	nodes: readonly string[],
	edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
	let nextIndex = 0;
	const indices = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const result: string[][] = [];

	function strongconnect(v: string): void {
		indices.set(v, nextIndex);
		lowlink.set(v, nextIndex);
		nextIndex++;
		stack.push(v);
		onStack.add(v);

		for (const w of edges.get(v) ?? []) {
			if (!indices.has(w)) {
				strongconnect(w);
				lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
			} else if (onStack.has(w)) {
				lowlink.set(v, Math.min(lowlink.get(v) ?? 0, indices.get(w) ?? 0));
			}
		}

		if ((lowlink.get(v) ?? 0) === (indices.get(v) ?? -1)) {
			const component: string[] = [];
			let w: string | undefined;
			do {
				w = stack.pop();
				if (w === undefined) break;
				onStack.delete(w);
				component.push(w);
			} while (w !== v);
			result.push(component);
		}
	}

	for (const v of nodes) {
		if (!indices.has(v)) strongconnect(v);
	}
	return result;
}
