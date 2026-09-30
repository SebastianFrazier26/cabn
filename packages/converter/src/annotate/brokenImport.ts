import {
	extractRelativeRefs,
	resolveRelativeRefTarget,
} from "./importGraph.js";
import { uniquifyRules } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

/**
 * NullTypeError/ghost: a relative JS/TS import, Python relative import, or
 * markdown relative link whose every resolution candidate is absent from the
 * world's file-path set. False-negative risk: a bare (non-relative)
 * specifier that happens to collide with a local file name is never checked
 * (out of scope — resolving bare specifiers means knowing about
 * node_modules/site-packages, which converted-directory worlds don't have).
 * False-positive risk: an import resolved via a bundler alias/tsconfig
 * "paths" entry that isn't a plain relative path is never seen as relative in
 * the first place, so it's silently skipped rather than reported — never
 * wrongly flagged.
 */
export const brokenImport: Annotator = (ctx) => {
	const { file, content, worldFiles } = ctx;
	if (content === undefined) return [];

	const results: ErrorAnnotation[] = [];
	for (const ref of extractRelativeRefs(file.path, content)) {
		const candidates = resolveRelativeRefTarget(file.path, ref);
		if (candidates.some((c) => worldFiles.has(c))) continue;

		results.push({
			code: "NullTypeError",
			rule: `broken-import:${ref.spec}`,
			message: ref.isMarkdownLink
				? `Link "${ref.spec}" doesn't point to any file in this world.`
				: `Import "${ref.spec}" doesn't resolve to any file in this world.`,
			loc: { line: ref.line, col: ref.col },
			species: "ghost",
			tier: 1,
		});
	}
	return uniquifyRules(results);
};
