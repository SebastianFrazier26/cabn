import type { SyntaxNode } from "@lezer/common";
import { locAt } from "./loc.js";
import {
	lineAnchor,
	lineTextAt,
	type ParsedFile,
	parseFile,
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
// node ever names them.
const JSX_PRAGMA_NAMES = new Set(["React", "h", "jsx", "Fragment"]);

interface Finding {
	index: number;
	rule: string;
	message: string;
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

function unreachableIn(
	parsed: ParsedFile,
	block: SyntaxNode,
	terminators: ReadonlySet<string>,
	exempt: ReadonlySet<string>,
	out: Finding[],
): void {
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

// Name-based, not scope-based: a declaration counts as used if *any*
// identifier node in the file spells its name. That can only miss dead code
// (two unrelated `x`s), never invent it — the direction a game about fixing
// real bugs has to err in.
function jsDeadCode(parsed: ParsedFile, path: string): Finding[] {
	const { content, tree } = parsed;
	if (/\.d\.[cm]?ts$/.test(path)) return [];
	if (/\beval\s*\(|\bwith\s*\(/.test(content)) return [];

	const uses = new Map<string, number>();
	const imports: { name: string; index: number }[] = [];
	const declared: { name: string; index: number; topLevel: boolean }[] = [];
	const blocks: SyntaxNode[] = [];
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
			case "Block":
			case "SwitchBody":
			case "Script":
				blocks.push(node);
				break;
			case "VariableName":
			case "TypeName":
			case "JSXIdentifier":
				countInto(uses, content.slice(cursor.from, cursor.to));
				break;
			case "PropertyDefinition":
				// `{ a }` shorthand reads the variable `a`.
				if (node.parent?.name === "Property" && !node.nextSibling) {
					countInto(uses, content.slice(cursor.from, cursor.to));
				}
				break;
			case "VariableDefinition": {
				const name = content.slice(cursor.from, cursor.to);
				const parent = node.parent;
				if (!parent) break;
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
						: hasAncestor(
								node,
								new Set(["VariableDeclaration"]),
								new Set(["ParamList", "CatchClause", ...JS_FUNCTION_NODES]),
							);
				if (!owner) break;
				if (
					hasAncestor(
						owner,
						new Set([
							"ForSpec",
							"ForInSpec",
							"ForOfSpec",
							"AmbientDeclaration",
						]),
					)
				)
					break;
				if (owner.parent?.name === "ExportDeclaration") break;
				declared.push({
					name,
					index: cursor.from,
					topLevel: !hasAncestor(owner, JS_FUNCTION_NODES),
				});
				break;
			}
		}
	} while (cursor.next());

	const findings: Finding[] = [];
	for (const imp of imports) {
		if ((uses.get(imp.name) ?? 0) > 0) continue;
		if (hasJsx && JSX_PRAGMA_NAMES.has(imp.name)) continue;
		findings.push({
			index: imp.index,
			rule: `unused-import:${imp.name}`,
			message: `Import "${imp.name}" is never used.`,
		});
	}
	for (const decl of declared) {
		// A non-module script's top level is global scope — another <script>
		// may read it.
		if (decl.topLevel && !isModule) continue;
		if (decl.name.startsWith("_")) continue;
		if ((uses.get(decl.name) ?? 0) > 0) continue;
		findings.push({
			index: decl.index,
			rule: `unused-var:${decl.name}`,
			message: `"${decl.name}" is declared but never used.`,
		});
	}
	for (const block of blocks) {
		unreachableIn(
			parsed,
			block,
			JS_TERMINATORS,
			JS_UNREACHABLE_EXEMPT,
			findings,
		);
	}
	return findings;
}

/** Bound names of one `import ...`/`from ... import ...` statement, with where each is written. */
function pythonImportBindings(
	parsed: ParsedFile,
	stmt: SyntaxNode,
): { name: string; index: number }[] {
	const parts = children(stmt);
	const text = (n: SyntaxNode) => parsed.content.slice(n.from, n.to);
	const out: { name: string; index: number }[] = [];
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

function wordsIn(text: string, into: Map<string, number>): void {
	for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g))
		countInto(into, m[0]);
}

function pythonDeadCode(parsed: ParsedFile, path: string): Finding[] {
	const { content, tree } = parsed;
	const findings: Finding[] = [];
	const isInit = /(^|\/)__init__\.py$/.test(path);
	const checkImports = !isInit && !/^__all__\s*[:=]/m.test(content);

	const uses = new Map<string, number>();
	const imports: { name: string; index: number }[] = [];
	const functions: SyntaxNode[] = [];
	const bodies: SyntaxNode[] = [];

	const cursor = tree.cursor();
	do {
		const node = cursor.node;
		switch (cursor.name) {
			case "ImportStatement":
				if (checkImports) imports.push(...pythonImportBindings(parsed, node));
				break;
			case "FunctionDefinition":
				functions.push(node);
				break;
			case "Body":
			case "Script":
				bodies.push(node);
				break;
			case "VariableName":
				if (!hasAncestor(node, new Set(["ImportStatement"]))) {
					countInto(uses, content.slice(cursor.from, cursor.to));
				}
				break;
			case "String":
				// String annotations ("Foo") and __all__-style name lists.
				wordsIn(content.slice(cursor.from, cursor.to), uses);
				break;
		}
	} while (cursor.next());

	for (const imp of imports) {
		if ((uses.get(imp.name) ?? 0) > 0) continue;
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
	for (const body of bodies) {
		unreachableIn(parsed, body, PY_TERMINATORS, new Set(), findings);
	}
	return findings;
}

const PY_SCOPE_BOUNDARY = new Set(["FunctionDefinition", "ClassDefinition"]);

function pythonUnusedLocals(parsed: ParsedFile, fn: SyntaxNode): Finding[] {
	const { content } = parsed;
	const fnText = content.slice(fn.from, fn.to);
	if (/\b(locals|vars|eval|exec)\s*\(/.test(fnText)) return [];
	const body = fn.getChild("Body");
	if (!body) return [];

	const targets: SyntaxNode[] = [];
	const scoped = new Map<string, number>();
	const reads = new Map<string, number>();
	const cursor = body.cursor();
	do {
		const node = cursor.node;
		if (cursor.name === "ScopeStatement") {
			wordsIn(content.slice(cursor.from, cursor.to), scoped);
		} else if (cursor.name === "AssignStatement") {
			const owner = hasAncestor(node, PY_SCOPE_BOUNDARY);
			const first = node.firstChild;
			// Single plain-name targets only: tuple unpacking and attribute/
			// subscript targets are either idiomatic or not a local at all.
			if (
				owner === fn &&
				first?.name === "VariableName" &&
				first.nextSibling?.name === "AssignOp"
			) {
				targets.push(first);
			}
		} else if (cursor.name === "VariableName") {
			countInto(reads, content.slice(cursor.from, cursor.to));
		} else if (cursor.name === "String" || cursor.name === "FormatString") {
			wordsIn(content.slice(cursor.from, cursor.to), reads);
		}
	} while (cursor.next());

	const assignedCount = new Map<string, number>();
	for (const t of targets)
		countInto(assignedCount, content.slice(t.from, t.to));

	const out: Finding[] = [];
	const reported = new Set<string>();
	for (const t of targets) {
		const name = content.slice(t.from, t.to);
		if (reported.has(name) || name.startsWith("_") || scoped.has(name))
			continue;
		if ((reads.get(name) ?? 0) > (assignedCount.get(name) ?? 0)) continue;
		reported.add(name);
		out.push({
			index: t.from,
			rule: `unused-var:${name}`,
			message: `"${name}" is assigned but never used.`,
		});
	}
	return out;
}

/**
 * DeadCode/skeleton, from the Lezer syntax tree (JS/TS/Python only):
 *  - unused imports (JS/TS always; Python except `__init__.py` and modules
 *    declaring `__all__`, where imports are re-exports by convention);
 *  - unused variables/functions/classes: JS/TS locals anywhere, top-level
 *    ones only in ES modules (a plain script's top level is global) and
 *    never exported ones; Python function locals only (a module-level name
 *    may be imported elsewhere);
 *  - unreachable statements after return/throw/raise/break/continue in the
 *    same block (hoisted function declarations and TS type declarations
 *    excepted; a switch case label resets it).
 * Bails out on eval/with (JS) and locals()/vars()/eval/exec (Python),
 * where names can be read without an identifier node.
 */
export const deadCode: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	const parsed = parseFile(file, content);
	if (!parsed) return [];
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
