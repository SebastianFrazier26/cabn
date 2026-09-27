import {
	extractRelativeRefs,
	resolveRelativeRefTarget,
} from "./importGraph.js";
import { stronglyConnectedComponents } from "./tarjan.js";

export interface CircularImportResult {
	/** Every file in the cycle, sorted lexicographically — a deterministic stand-in for "cycle order" (an SCC has no canonical start), and `members[0]` is the convention convert.ts uses for "the first file in the cycle" when attaching an intra-cluster monster. */
	members: string[];
	/** Where `members[0]`'s import into the cycle appears, if it has one directly — null for a member reached only transitively through another cycle member. */
	entryLoc: { path: string; line: number; col: number } | null;
	rule: string;
	message: string;
}

/**
 * OuroborosError/ouroboros: Tarjan SCC over the *code* import graph only
 * (markdown links are brokenImport's concern, not an "import cycle" in the
 * sense this taxonomy entry means). `files` should already be limited to
 * files with readable text content — a binary/oversized file can't have
 * outgoing imports, so it can never complete a cycle regardless of whether
 * it's included as a graph node.
 *
 * Simplification: a strongly-connected component with 3+ files may actually
 * contain several overlapping simple cycles (e.g. a->b->a and a->c->a sharing
 * node a); this reports the whole component as one monster rather than
 * enumerating every simple cycle within it (which is exponential in the
 * general case) — one ouroboros per "tangle", not per path through it.
 */
export function findCircularImports(
	files: ReadonlyMap<string, string>,
): CircularImportResult[] {
	const nodes = [...files.keys()];
	const edgeTargets = new Map<string, string[]>();
	const edgeDetails = new Map<
		string,
		{ to: string; line: number; col: number }[]
	>();

	for (const [path, content] of files) {
		const targets: string[] = [];
		const details: { to: string; line: number; col: number }[] = [];
		for (const ref of extractRelativeRefs(path, content)) {
			if (ref.isMarkdownLink) continue;
			const candidates = resolveRelativeRefTarget(path, ref);
			const target = candidates.find((c) => files.has(c));
			if (target === undefined) continue;
			targets.push(target);
			details.push({ to: target, line: ref.line, col: ref.col });
		}
		edgeTargets.set(path, targets);
		edgeDetails.set(path, details);
	}

	const components = stronglyConnectedComponents(nodes, edgeTargets);
	const results: CircularImportResult[] = [];

	for (const component of components) {
		const isSelfLoop =
			component.length === 1 &&
			(edgeTargets.get(component[0] ?? "") ?? []).includes(component[0] ?? "");
		if (component.length < 2 && !isSelfLoop) continue;

		const members = [...component].sort();
		const first = members[0] ?? "";
		const memberSet = new Set(members);
		const entryEdge = (edgeDetails.get(first) ?? []).find((e) =>
			memberSet.has(e.to),
		);

		results.push({
			members,
			entryLoc: entryEdge
				? { path: first, line: entryEdge.line, col: entryEdge.col }
				: null,
			rule: `circular-import:${members.join(",")}`,
			message: `Circular import between ${members.length} file${members.length === 1 ? "" : "s"}: ${members.join(" -> ")} -> ${first}`,
		});
	}
	return results;
}
