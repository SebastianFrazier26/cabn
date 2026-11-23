export interface ScopeReport {
	/** Selectors that do not start with the root class. */
	selectors: string[];
	/**
	 * At-rules whose names are global whatever they sit inside: `@import`,
	 * `@font-face`, `@keyframes`, `@property` and the like. Listed so a caller
	 * can require a per-post prefix or forbid them.
	 */
	globals: string[];
}

// These hold ordinary rules, so their bodies are checked like the top level.
const GROUPING = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"document",
	"starting-style",
]);

function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Index just past the string that opens at `start`. */
function skipString(css: string, start: number): number {
	const quote = css[start];
	let i = start + 1;
	while (i < css.length && css[i] !== quote) {
		if (css[i] === "\\") i++;
		i++;
	}
	return i + 1;
}

/** Index of the `}` matching the `{` at `open`. */
function matchBrace(css: string, open: number): number {
	let depth = 0;
	let i = open;
	while (i < css.length) {
		const ch = css[i];
		if (ch === '"' || ch === "'") {
			i = skipString(css, i);
			continue;
		}
		if (ch === "{") depth++;
		if (ch === "}" && --depth === 0) return i;
		i++;
	}
	return css.length;
}

function splitSelectors(prelude: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	let i = 0;
	while (i < prelude.length) {
		const ch = prelude[i];
		if (ch === '"' || ch === "'") {
			i = skipString(prelude, i);
			continue;
		}
		if (ch === "(" || ch === "[") depth++;
		if (ch === ")" || ch === "]") depth--;
		if (ch === "," && depth === 0) {
			parts.push(prelude.slice(start, i));
			start = i + 1;
		}
		i++;
	}
	parts.push(prelude.slice(start));
	return parts.map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}

function scan(css: string, root: string, report: ScopeReport): void {
	let i = 0;
	while (i < css.length) {
		let end = i;
		while (end < css.length && css[end] !== "{" && css[end] !== ";") {
			const ch = css[end];
			end = ch === '"' || ch === "'" ? skipString(css, end) : end + 1;
		}
		const prelude = css.slice(i, end).trim().replace(/\s+/g, " ");
		if (end >= css.length) return;

		if (css[end] === ";") {
			if (prelude.startsWith("@")) report.globals.push(prelude);
			i = end + 1;
			continue;
		}

		const close = matchBrace(css, end);
		const body = css.slice(end + 1, close);
		i = close + 1;

		if (prelude.startsWith("@")) {
			const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
			if (GROUPING.has(name)) scan(body, root, report);
			else if (name === "font-face") {
				const family = /font-family\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim();
				report.globals.push(`@font-face ${family ?? "(no family)"}`);
			} else report.globals.push(prelude);
			continue;
		}

		for (const selector of splitSelectors(prelude)) {
			const next = selector[root.length];
			const scoped =
				selector.startsWith(root) &&
				(next === undefined || !/[\w-]/.test(next));
			if (!scoped) report.selectors.push(selector);
		}
	}
}

/**
 * Checks a post's stylesheet stays inside the post: every selector must start
 * with `rootClass` (e.g. `.fs-post`). Rules nested inside a scoped rule are
 * scoped by it and are not inspected. A convention check for a site's tests,
 * not a full CSS parser: it reads standard CSS as authored.
 */
export function findUnscopedSelectors(
	css: string,
	rootClass: string,
): ScopeReport {
	if (!/^\.[A-Za-z_][\w-]*$/.test(rootClass)) {
		throw new Error(
			`rootClass ${JSON.stringify(rootClass)} must be a single class selector such as ".fs-post"`,
		);
	}
	const report: ScopeReport = { selectors: [], globals: [] };
	scan(stripComments(css), rootClass, report);
	return report;
}
