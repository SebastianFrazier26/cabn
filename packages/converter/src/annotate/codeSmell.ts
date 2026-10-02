import {
	DEFAULT_MAX_FUNCTION_LINES,
	DEFAULT_MAX_NESTING_DEPTH,
} from "@cabn/world-schema";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { shortHash } from "../hash.js";
import { locAt } from "./loc.js";
import {
	isScriptLike,
	isTestFile,
	lineAnchor,
	MAX_TREE_CHARS,
	normalizeLine,
	type ParsedFile,
	parseFile,
	uniquifyRules,
} from "./syntaxTree.js";
import type { AnnotateOptions, Annotator, ErrorAnnotation } from "./types.js";

const MAX_SMELLS_PER_FILE = 8;
const MAX_DEBUG_PER_FILE = 4;
const MAX_DUPLICATES_PER_FILE = 3;
/** Shortest repeated run of significant lines that counts as a duplicated block. */
export const DUPLICATE_WINDOW_LINES = 6;
// Six lines of `}` / `break;` / `return x` repeat everywhere; a real
// copy-paste carries enough text to clear this.
const DUPLICATE_MIN_CHARS = 120;

const FUNCTION_NODES = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunction",
	"MethodDeclaration",
	"FunctionDefinition",
]);
const JS_CONTROL = new Set([
	"IfStatement",
	"ForStatement",
	"WhileStatement",
	"DoStatement",
	"SwitchStatement",
	"TryStatement",
]);
const PY_CONTROL = new Set([
	"IfStatement",
	"ForStatement",
	"WhileStatement",
	"TryStatement",
	"WithStatement",
	"MatchStatement",
]);
const JS_DEBUG_CALLS = new Set([
	"console.log",
	"console.debug",
	"console.trace",
	"console.dir",
]);
const PY_ALWAYS_DEBUG_CALLS = new Set([
	"breakpoint",
	"pdb.set_trace",
	"ipdb.set_trace",
]);
// A CLI's whole job is writing to stdout, and a server entry point's
// "listening on :port" line is its one expected log.
const JS_CLI_HINT =
	/process\.argv|process\.exit\(|\bcommander\b|\byargs\b|\.listen\(/;
const PY_CLI_HINT =
	/\bsys\.argv\b|\bargparse\b|\bimport click\b|\bimport typer\b/;

interface Finding {
	index: number;
	rule: string;
	message: string;
}

class LineIndex {
	private readonly starts: number[] = [0];
	constructor(content: string) {
		for (let i = 0; i < content.length; i++) {
			if (content.charCodeAt(i) === 10) this.starts.push(i + 1);
		}
	}
	lineOf(index: number): number {
		let lo = 0;
		let hi = this.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.starts[mid] ?? 0) <= index) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
}

function functionName(parsed: ParsedFile, node: SyntaxNode): string {
	const text = (n: SyntaxNode) => parsed.content.slice(n.from, n.to);
	if (node.name === "FunctionDefinition") {
		const id = node.getChild("VariableName");
		return id ? text(id) : "function";
	}
	const own =
		node.getChild("VariableDefinition") ??
		node.getChild("PropertyDefinition") ??
		node.getChild("PrivatePropertyDefinition");
	if (own) return text(own);
	const parent = node.parent;
	if (parent?.name === "VariableDeclaration") {
		let prev = node.prevSibling;
		while (prev && prev.name !== "VariableDefinition") prev = prev.prevSibling;
		if (prev) return text(prev);
	}
	if (parent?.name === "Property") {
		const key = parent.getChild("PropertyDefinition");
		if (key) return text(key);
	}
	return parent?.name === "ArgList" ? "callback" : "anonymous function";
}

function calleeText(parsed: ParsedFile, call: SyntaxNode): string {
	const callee = call.firstChild;
	return callee
		? parsed.content.slice(callee.from, callee.to).replace(/\s+/g, "")
		: "";
}

interface NestingFrame {
	name: string;
	depth: number;
	maxDepth: number;
	deepestAt: number;
}

function treeSmells(
	parsed: ParsedFile,
	path: string,
	maxFunctionLines: number,
	maxNestingDepth: number,
): Finding[] {
	const { content } = parsed;
	const lines = new LineIndex(content);
	const isPython = parsed.language === "python";
	const control = isPython ? PY_CONTROL : JS_CONTROL;
	const printingAllowed =
		isScriptLike(path, content) ||
		(isPython ? PY_CLI_HINT : JS_CLI_HINT).test(content);

	const longFns: Finding[] = [];
	const nesting: Finding[] = [];
	const debug: Finding[] = [];
	let longUntil = -1;
	const frames: NestingFrame[] = [
		{ name: "top level", depth: 0, maxDepth: 0, deepestAt: 0 },
	];

	const closeFrame = (frame: NestingFrame | undefined) => {
		if (!frame || frame.maxDepth <= maxNestingDepth) return;
		nesting.push({
			index: frame.deepestAt,
			rule: `deep-nesting:${frame.name}:${maxNestingDepth}`,
			message: `${frame.name === "top level" ? "Top-level code" : `"${frame.name}"`} nests control flow ${frame.maxDepth} levels deep (limit ${maxNestingDepth}) — flatten it with early returns or helpers.`,
		});
	};

	const debugFinding = (index: number, what: string, kind: string) => {
		debug.push({
			index,
			rule: `debug:${kind}:${lineAnchor(content, index)}`,
			message: `Debug leftover: ${what}.`,
		});
	};

	parsed.tree.iterate({
		enter: (ref: SyntaxNodeRef) => {
			const name = ref.name;
			const frame = frames[frames.length - 1];
			// ArrowFunction with an expression body (`x => x * 2`) is never long
			// or nested enough to matter.
			if (
				FUNCTION_NODES.has(name) &&
				!(name === "ArrowFunction" && !ref.node.getChild("Block"))
			) {
				const node = ref.node;
				const fnName = functionName(parsed, node);
				const span = lines.lineOf(ref.to) - lines.lineOf(ref.from) + 1;
				if (span > maxFunctionLines && ref.from >= longUntil) {
					longUntil = ref.to;
					longFns.push({
						index: ref.from,
						rule: `long-function:${fnName}:${maxFunctionLines}`,
						message: `"${fnName}" is ${span} lines long (limit ${maxFunctionLines}) — split it into smaller functions.`,
					});
				}
				frames.push({
					name: fnName,
					depth: 0,
					maxDepth: 0,
					deepestAt: ref.from,
				});
				return;
			}
			if (
				frame &&
				control.has(name) &&
				!(name === "IfStatement" && ref.node.parent?.name === "IfStatement")
			) {
				frame.depth++;
				if (frame.depth > frame.maxDepth) {
					frame.maxDepth = frame.depth;
					frame.deepestAt = ref.from;
				}
			}
			if (name === "DebuggerStatement") {
				debugFinding(ref.from, "`debugger` statement", "debugger");
			} else if (name === "CallExpression") {
				const callee = calleeText(parsed, ref.node);
				if (isPython && PY_ALWAYS_DEBUG_CALLS.has(callee)) {
					debugFinding(ref.from, `\`${callee}()\` call`, callee);
				} else if (!printingAllowed) {
					if (isPython ? callee === "print" : JS_DEBUG_CALLS.has(callee)) {
						debugFinding(ref.from, `\`${callee}(...)\` call`, callee);
					}
				}
			} else if (name === "PrintStatement" && !printingAllowed) {
				debugFinding(ref.from, "`print` statement", "print");
			}
		},
		leave: (ref: SyntaxNodeRef) => {
			const name = ref.name;
			if (
				FUNCTION_NODES.has(name) &&
				!(name === "ArrowFunction" && !ref.node.getChild("Block"))
			) {
				closeFrame(frames.pop());
				return;
			}
			const frame = frames[frames.length - 1];
			if (
				frame &&
				control.has(name) &&
				!(name === "IfStatement" && ref.node.parent?.name === "IfStatement")
			) {
				frame.depth--;
			}
		},
	});
	closeFrame(frames[0]);

	return [...longFns, ...nesting, ...debug.slice(0, MAX_DEBUG_PER_FILE)];
}

/**
 * Within one file only: a whole-world pass would catch cross-file copies too,
 * but couldn't be re-checked from the single buffer the engine has after an
 * edit. Compares whitespace-normalized "significant" lines (anything with a
 * letter that isn't a bare string-literal data row, like pixel-art rows or
 * word lists), so re-indenting a copy doesn't hide it.
 */
const DATA_ROW = /^(["'`]).*\1,?$/;

function duplicateBlocks(content: string): Finding[] {
	const raw = content.split("\n");
	const sig: { text: string; line: number; index: number }[] = [];
	let offset = 0;
	for (const [line, text] of raw.entries()) {
		const norm = normalizeLine(text);
		if (/[A-Za-z]/.test(norm) && !DATA_ROW.test(norm)) {
			sig.push({ text: norm, line, index: offset });
		}
		offset += text.length + 1;
	}

	const findings: Finding[] = [];
	const firstSeen = new Map<string, number>();
	const W = DUPLICATE_WINDOW_LINES;
	for (let i = 0; i + W <= sig.length; i++) {
		const window = sig.slice(i, i + W);
		const key = window.map((s) => s.text).join("\n");
		if (key.length < DUPLICATE_MIN_CHARS) continue;
		const j = firstSeen.get(key);
		if (j === undefined) {
			firstSeen.set(key, i);
			continue;
		}
		if (i < j + W) continue;
		let run = W;
		while (
			i + run < sig.length &&
			j + run < i &&
			sig[i + run]?.text === sig[j + run]?.text
		)
			run++;
		const here = sig[i];
		const there = sig[j];
		if (!here || !there) break;
		findings.push({
			index: here.index,
			rule: `duplicate:${shortHash(key, 8)}`,
			message: `These ${run} lines repeat lines ${there.line + 1}-${(sig[j + run - 1]?.line ?? there.line) + 1} — pull them into one shared function.`,
		});
		if (findings.length >= MAX_DUPLICATES_PER_FILE) break;
		i += run - 1;
	}
	return findings;
}

/**
 * Thresholds live in the rule string (`long-function:<name>:<limit>`), so a
 * post-edit re-check in the engine judges the monster by the same limit the
 * converter used, even if the world's cabn.json set a non-default one.
 */
export function smellOptionsFromRule(rule: string): AnnotateOptions {
	const m = /^(long-function|deep-nesting):.*:(\d+)(?:#\d+)?$/.exec(rule);
	if (!m) return {};
	const limit = Number(m[2]);
	return m[1] === "long-function"
		? { maxFunctionLines: limit }
		: { maxNestingDepth: limit };
}

/**
 * CodeSmell/bramble, deliberately a lower tier than real bugs:
 *  - functions longer than `maxFunctionLines` (default 80; outermost only,
 *    so one giant function doesn't also flag every long callback in it);
 *  - control flow nested deeper than `maxNestingDepth` (default 4) inside
 *    one function (`else if` chains count as one level);
 *  - duplicated blocks of 6+ significant lines within a file (not in tests,
 *    where repetition is normal);
 *  - debug leftovers: `debugger`, `breakpoint()`, `pdb.set_trace()` always;
 *    `console.log/debug/trace/dir` and `print` only outside scripts, tests,
 *    and CLIs (see syntaxTree.ts's isScriptLike, plus argv/argparse hints).
 * Tree-based checks cover JS/TS/Python; duplicate detection covers every
 * code file.
 */
export const codeSmell: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	if (content.length > MAX_TREE_CHARS) return [];
	const maxFunctionLines =
		ctx.options?.maxFunctionLines ?? DEFAULT_MAX_FUNCTION_LINES;
	const maxNestingDepth =
		ctx.options?.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH;

	const findings: Finding[] = [];
	const parsed = parseFile(file, content);
	if (
		parsed &&
		(parsed.language === "js" ||
			parsed.language === "ts" ||
			parsed.language === "python")
	) {
		findings.push(
			...treeSmells(parsed, file.path, maxFunctionLines, maxNestingDepth),
		);
	}
	if (file.kind === "code" && !isTestFile(file.path)) {
		findings.push(...duplicateBlocks(content));
	}

	findings.sort((a, b) => a.index - b.index);
	return uniquifyRules(
		findings.slice(0, MAX_SMELLS_PER_FILE).map(
			(f): ErrorAnnotation => ({
				code: "CodeSmell",
				rule: f.rule,
				message: f.message,
				loc: locAt(content, f.index),
				species: "bramble",
				tier: 1,
			}),
		),
	);
};
