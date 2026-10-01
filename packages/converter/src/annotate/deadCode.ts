import type { SyntaxNode } from "@lezer/common";
import { locAt } from "./loc.js";
import {
	lineAnchor,
	lineTextAt,
	type ParsedFile,
	parseFile,
	syntaxErrorNodes,
	uniquifyRules,
} from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const MAX_DEAD_CODE_PER_FILE = 10;

const JS_FUNCTION_NODES = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunction",
	"MethodDeclaration",
]);
const JS_TERMINATORS = new Set([
	"ReturnStatement",
	"ThrowStatement",
	"BreakStatement",
	"ContinueStatement",
]);
// Hoisted or type-only: legal (and common) after a return.
const JS_UNREACHABLE_EXEMPT = new Set([
	"FunctionDeclaration",
	"TypeAliasDeclaration",
	"InterfaceDeclaration",
	"AmbientDeclaration",
]);
const PY_TERMINATORS = new Set([
	"ReturnStatement",
	"RaiseStatement",
	"BreakStatement",
	"ContinueStatement",
]);
const TERMINATOR_WORD: Record<string, string> = {
	ReturnStatement: "return",
	ThrowStatement: "throw",
	RaiseStatement: "raise",
	BreakStatement: "break",
	ContinueStatement: "continue",
};
// The classic JSX runtime needs these in scope even though no identifier
// in the file names them.
const JSX_PRAGMA_NAMES = new Set(["React", "h", "jsx", "Fragment"]);
const JS_WORD = /[A-Za-z_$][\w$]*/g;
const PY_WORD = /[A-Za-z_]\w*/g;

interface Finding {
	index: number;
	rule: string;
	message: string;
}

interface Binding {
	name: string;
	index: number;
}

function children(node: SyntaxNode): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
	return out;
}

function hasAncestor(
	node: SyntaxNode,
	names: ReadonlySet<string>,
	stopAt?: ReadonlySet<string>,
): SyntaxNode | null {
	for (let p = node.parent; p; p = p.parent) {
		if (names.has(p.name)) return p;
		if (stopAt?.has(p.name)) return null;
	}
	return null;
}

function countInto(counts: Map<string, number>, name: string): void {
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

function wordCounts(text: string, pattern: RegExp): Map<string, number> {
	const counts = new Map<string, number>();
	for (const m of text.matchAll(pattern)) countInto(counts, m[0]);
	return counts;
}

/**
 * The use test for every binding below: a name is unused when the file
 * spells it no more often than it's bound. The syntax tree only finds the
 * bindings; uses are counted as raw words over the whole text, strings and
 * comments included. That can only ever miss dead code (a mention in a
 * comment, an unrelated property with the same name), never invent it, and
 * it holds up where the grammar misparses valid code (see syntaxTree.ts's
 * grammar gaps), which a node-based use count doesn't.
 */
function unusedBindings(
	bindings: readonly Binding[],
	words: ReadonlyMap<string, number>,
): Binding[] {
	const sites = new Map<string, number>();
	for (const b of bindings) countInto(sites, b.name);
	return bindings.filter(
		(b) => (words.get(b.name) ?? 0) <= (sites.get(b.name) ?? 0),
	);
}

function errorPositions(parsed: ParsedFile): number[] {
	const out: number[] = [];
	const cursor = parsed.tree.cursor();
	do {
		if (cursor.type.isError) out.push(cursor.from);
	} while (cursor.next());
	return out;
}

function unreachableIn(
	parsed: ParsedFile,
	block: SyntaxNode,
	terminators: ReadonlySet<string>,
	exempt: ReadonlySet<string>,
	errors: readonly number[],
	out: Finding[],
): void {
	// Any error node, even a known grammar gap, can split one statement into
	// two siblings; only trust statement order in a block that parsed cleanly.
	if (errors.some((pos) => pos >= block.from && pos <= block.to)) return;
	let terminatedBy: string | null = null;
	for (const child of children(block)) {
		if (child.name === "CaseLabel" || child.name === "DefaultLabel") {
			terminatedBy = null;
			continue;
		}
		if (!child.type.is("Statement")) continue;
		if (terminatedBy !== null) {
			if (exempt.has(child.name)) continue;
			out.push({
				index: child.from,
				rule: `unreachable:${lineAnchor(parsed.content, child.from)}`,
				message: `Unreachable code after "${TERMINATOR_WORD[terminatedBy] ?? terminatedBy}" — it can never run.`,
			});
			return;
		}
		if (terminators.has(child.name)) terminatedBy = child.name;
	}
}

const JS_DECLARATION_STOP = new Set([
	"ParamList",
	"CatchClause",
	...JS_FUNCTION_NODES,
]);
const JS_DECLARATION_SKIP = new Set([
	"ForSpec",
	"ForInSpec",
	"ForOfSpec",
	"AmbientDeclaration",
]);
const VARIABLE_DECLARATION = new Set(["VariableDeclaration"]);

function jsDeadCode(parsed: ParsedFile, path: string): Finding[] {
	const { content, tree } = parsed;
	if (/\.d\.[cm]?ts$/.test(path)) return [];
	if (/\beval\s*\(|\bwith\s*\(/.test(content)) return [];

	const imports: Binding[] = [];
	const locals: (Binding & { topLevel: boolean })[] = [];
	const blocks: SyntaxNode[] = [];
	const moduleSpecifiers: string[] = [];
	let isModule = false;
	let hasJsx = false;

	const cursor = tree.cursor();
	do {
		const node = cursor.node;
		switch (cursor.name) {
			case "ImportDeclaration":
			case "ExportDeclaration":
				if (node.parent?.name === "Script") isModule = true;
				break;
			case "JSXElement":
				hasJsx = true;
				break;
			case "String":
				// A module specifier ("./fs-helpers") must not count as a use of `fs`.
				if (
					node.parent?.name === "ImportDeclaration" ||
					node.parent?.name === "ExportDeclaration"
				) {
					moduleSpecifiers.push(content.slice(cursor.from, cursor.to));
				}
				break;
			case "Block":
			case "SwitchBody":
			case "Script":
				blocks.push(node);
				break;
			case "VariableDefinition": {
				// Leading identifier only: an error node inside the definition
				// (grammar gap) can stretch its span over `= value`.
				const name = /^[A-Za-z_$][\w$]*/.exec(
					content.slice(cursor.from, cursor.to),
				)?.[0];
				const parent = node.parent;
				if (!name || !parent) break;
				if (
					parent.name === "ImportDeclaration" ||
					parent.name === "ImportGroup"
				) {
					imports.push({ name, index: cursor.from });
					break;
				}
				const owner =
					parent.name === "FunctionDeclaration" ||
					parent.name === "ClassDeclaration"
						? parent
						: hasAncestor(node, VARIABLE_DECLARATION, JS_DECLARATION_STOP);
				if (!owner || hasAncestor(owner, JS_DECLARATION_SKIP)) break;
				if (owner.parent?.name === "ExportDeclaration") break;
				locals.push({
					name,
					index: cursor.from,
					topLevel: !hasAncestor(owner, JS_FUNCTION_NODES),
				});
				break;
			}
		}
	} while (cursor.next());

	const words = wordCounts(content, JS_WORD);
	for (const spec of moduleSpecifiers) {
		for (const [word, n] of wordCounts(spec, JS_WORD)) {
			words.set(word, (words.get(word) ?? 0) - n);
		}
	}
	const unused = new Set(unusedBindings([...imports, ...locals], words));
	const findings: Finding[] = [];
	for (const imp of imports) {
		if (!unused.has(imp)) continue;
		if (hasJsx && JSX_PRAGMA_NAMES.has(imp.name)) continue;
		findings.push({
			index: imp.index,
			rule: `unused-import:${imp.name}`,
			message: `Import "${imp.name}" is never used.`,
		});
	}
	for (const local of locals) {
		if (!unused.has(local)) continue;
		// A non-module script's top level is global scope — another <script>
		// may read it.
		if (local.topLevel && !isModule) continue;
		if (local.name.startsWith("_")) continue;
		findings.push({
			index: local.index,
			rule: `unused-var:${local.name}`,
			message: `"${local.name}" is declared but never used.`,
		});
	}
	const errors = errorPositions(parsed);
	for (const block of blocks) {
		unreachableIn(
			parsed,
			block,
			JS_TERMINATORS,
			JS_UNREACHABLE_EXEMPT,
			errors,
			findings,
		);
	}
	return findings;
}

/** Bound names of one `import ...`/`from ... import ...` statement, with where each is written. */
function pythonImportBindings(parsed: ParsedFile, stmt: SyntaxNode): Binding[] {
	const parts = children(stmt);
	const text = (n: SyntaxNode) => parsed.content.slice(n.from, n.to);
	const out: Binding[] = [];
	const isFrom = parts[0]?.name === "from";
	if (isFrom && parts[1] && text(parts[1]) === "__future__") return [];
	let i = isFrom ? parts.findIndex((p) => p.name === "import") + 1 : 1;
	while (i > 0 && i < parts.length) {
		const first = parts[i];
		if (first?.name !== "VariableName") {
			i++;
			continue;
		}
		let bound: SyntaxNode = first;
		let j = i + 1;
		// `import a.b.c` binds `a`; skip the dotted tail.
		while (!isFrom && parts[j]?.name === "." && parts[j + 1]) j += 2;
		if (parts[j]?.name === "as" && parts[j + 1]?.name === "VariableName") {
			bound = parts[j + 1] as SyntaxNode;
			j += 2;
		}
		out.push({ name: text(bound), index: bound.from });
		i = j;
	}
	return out;
}

function pythonDeadCode(parsed: ParsedFile, path: string): Finding[] {
	const { content, tree } = parsed;
	const isInit = /(^|\/)__init__\.py$/.test(path);
	const checkImports = !isInit && !/^__all__\s*[:=]/m.test(content);

	const imports: Binding[] = [];
	const moduleWords: string[] = [];
	const functions: SyntaxNode[] = [];
	const bodies: SyntaxNode[] = [];

	const cursor = tree.cursor();
	do {
		const node = cursor.node;
		switch (cursor.name) {
			case "ImportStatement": {
				if (!checkImports) break;
				imports.push(...pythonImportBindings(parsed, node));
				// `from datetime import datetime` must not count as a use.
				const importKw = node.getChild("import");
				if (node.firstChild?.name === "from" && importKw) {
					moduleWords.push(content.slice(node.firstChild.to, importKw.from));
				}
				break;
			}
			case "FunctionDefinition":
				functions.push(node);
				break;
			case "Body":
			case "Script":
				bodies.push(node);
				break;
		}
	} while (cursor.next());

	const findings: Finding[] = [];
	const words = wordCounts(content, PY_WORD);
	for (const text of moduleWords) {
		for (const [word, n] of wordCounts(text, PY_WORD)) {
			words.set(word, (words.get(word) ?? 0) - n);
		}
	}
	for (const imp of unusedBindings(imports, words)) {
		if (/#\s*noqa/.test(lineTextAt(content, imp.index))) continue;
		findings.push({
			index: imp.index,
			rule: `unused-import:${imp.name}`,
			message: `Import "${imp.name}" is never used.`,
		});
	}
	for (const fn of functions) {
		findings.push(...pythonUnusedLocals(parsed, fn));
	}
	const errors = errorPositions(parsed);
	for (const body of bodies) {
		unreachableIn(parsed, body, PY_TERMINATORS, new Set(), errors, findings);
	}
	return findings;
}

const PY_SCOPE_BOUNDARY = new Set(["FunctionDefinition", "ClassDefinition"]);

function pythonUnusedLocals(parsed: ParsedFile, fn: SyntaxNode): Finding[] {
	const { content } = parsed;
	const fnText = content.slice(fn.from, fn.to);
	if (/\b(locals|vars|eval|exec)\s*\(/.test(fnText)) return [];
	const scoped = new Set<string>();
	for (const m of fnText.matchAll(
		/^[^\S\n\r\u2028\u2029]*(?:global|nonlocal)\s+([^\n#]+)/gm,
	)) {
		for (const name of (m[1] ?? "").split(",")) scoped.add(name.trim());
	}
	const body = fn.getChild("Body");
	if (!body) return [];

	const targets: Binding[] = [];
	// cursor().next() has no notion of "stay inside this node" — once it runs
	// out of body's own descendants it climbs out and keeps walking the rest
	// of the file (every function after this one), which made one call here
	// per top-level function quadratic in the function count. cursor().iterate
	// is bounded to the node it starts from (same as codeSmell.ts's tree walk).
	body.cursor().iterate((ref) => {
		if (ref.name !== "AssignStatement") return;
		const node = ref.node;
		const first = node.firstChild;
		// Single plain-name targets only: tuple unpacking and attribute/
		// subscript targets are either idiomatic or not a local at all.
		if (
			hasAncestor(node, PY_SCOPE_BOUNDARY) === fn &&
			first?.name === "VariableName" &&
			first.nextSibling?.name === "AssignOp"
		) {
			targets.push({
				name: content.slice(first.from, first.to),
				index: first.from,
			});
		}
	});

	const out: Finding[] = [];
	const reported = new Set<string>();
	for (const t of unusedBindings(targets, wordCounts(fnText, PY_WORD))) {
		if (reported.has(t.name) || t.name.startsWith("_") || scoped.has(t.name))
			continue;
		reported.add(t.name);
		out.push({
			index: t.index,
			rule: `unused-var:${t.name}`,
			message: `"${t.name}" is assigned but never used.`,
		});
	}
	return out;
}

/**
 * DeadCode/skeleton (JS/TS/Python only):
 *  - unused imports (JS/TS always; Python except `__init__.py` and modules
 *    declaring `__all__`, where imports are re-exports by convention);
 *  - unused variables/functions/classes: JS/TS locals anywhere, top-level
 *    ones only in ES modules (a plain script's top level is global) and
 *    never exported ones; Python function locals only (a module-level name
 *    may be imported elsewhere);
 *  - unreachable statements after return/throw/raise/break/continue in the
 *    same block (hoisted function declarations and TS type declarations
 *    excepted; a switch case label resets it).
 * Skips JS/Python files with a real syntax error (the tree can't be trusted,
 * and an imp/gremlin already covers the file). TS files aren't skipped: the
 * TS grammar marks too much valid code as errors to tell (see syntaxError.ts),
 * which is why uses are counted as words (see unusedBindings). Bails out on
 * eval/with (JS) and locals()/vars()/eval/exec (Python).
 */
export const deadCode: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	const parsed = parseFile(file, content);
	if (!parsed) return [];
	if (parsed.language !== "ts" && syntaxErrorNodes(parsed).length > 0) {
		return [];
	}
	let findings: Finding[];
	if (parsed.language === "js" || parsed.language === "ts") {
		findings = jsDeadCode(parsed, file.path);
	} else if (parsed.language === "python") {
		findings = pythonDeadCode(parsed, file.path);
	} else {
		return [];
	}

	findings.sort((a, b) => a.index - b.index);
	return uniquifyRules(
		findings.slice(0, MAX_DEAD_CODE_PER_FILE).map(
			(f): ErrorAnnotation => ({
				code: "DeadCode",
				rule: f.rule,
				message: f.message,
				loc: locAt(content, f.index),
				species: "skeleton",
				tier: 1,
			}),
		),
	);
};
