/** One unified-diff hunk; each line is prefixed " ", "+" or "-". */
export interface HistoryHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
}

export const DIFF_CONTEXT_LINES = 3;
/**
 * Beyond this many edits Myers' search is abandoned and the change ships as
 * "too-large": a rewrite that big isn't readable as a diff, and the saved
 * trace grows with D² (about 9 MB of Int32 at this bound).
 */
const MAX_EDIT_DISTANCE = 1500;

export type DiffOp = { kind: " " | "+" | "-"; line: string };

export function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.split("\n");
	// A trailing newline terminates the last line rather than starting an empty one.
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/**
 * Myers' O((N+M)·D) shortest edit script over lines, after trimming the
 * common prefix and suffix (which is most of any real commit). Returns null
 * when the edit distance passes MAX_EDIT_DISTANCE.
 */
export function diffLines(
	oldLines: readonly string[],
	newLines: readonly string[],
): DiffOp[] | null {
	let prefix = 0;
	while (
		prefix < oldLines.length &&
		prefix < newLines.length &&
		oldLines[prefix] === newLines[prefix]
	)
		prefix++;
	let suffix = 0;
	while (
		suffix < oldLines.length - prefix &&
		suffix < newLines.length - prefix &&
		oldLines[oldLines.length - 1 - suffix] ===
			newLines[newLines.length - 1 - suffix]
	)
		suffix++;

	const a = oldLines.slice(prefix, oldLines.length - suffix);
	const b = newLines.slice(prefix, newLines.length - suffix);
	const middle = myers(a, b);
	if (!middle) return null;

	const ops: DiffOp[] = [];
	for (let i = 0; i < prefix; i++)
		ops.push({ kind: " ", line: oldLines[i] as string });
	ops.push(...middle);
	for (let i = oldLines.length - suffix; i < oldLines.length; i++)
		ops.push({ kind: " ", line: oldLines[i] as string });
	return ops;
}

function myers(a: readonly string[], b: readonly string[]): DiffOp[] | null {
	const n = a.length;
	const m = b.length;
	if (n === 0) return b.map((line) => ({ kind: "+", line }));
	if (m === 0) return a.map((line) => ({ kind: "-", line }));
	const max = Math.min(n + m, MAX_EDIT_DISTANCE);
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	// trace[d] holds v[-d..d] as it stood before round d — all backtracking reads.
	const trace: Int32Array[] = [];
	for (let d = 0; d <= max; d++) {
		trace.push(v.slice(offset - d, offset + d + 1));
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (
				k === -d ||
				(k !== d &&
					(v[offset + k - 1] as number) < (v[offset + k + 1] as number))
			)
				x = v[offset + k + 1] as number;
			else x = (v[offset + k - 1] as number) + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) return backtrack(trace, a, b, d);
		}
	}
	return null;
}

function backtrack(
	trace: Int32Array[],
	a: readonly string[],
	b: readonly string[],
	finalD: number,
): DiffOp[] {
	const ops: DiffOp[] = [];
	let x = a.length;
	let y = b.length;
	for (let d = finalD; d > 0; d--) {
		const v = trace[d] as Int32Array;
		const at = (k: number) => v[k + d] as number;
		const k = x - y;
		const prevK =
			k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
		const prevX = at(prevK);
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			ops.push({ kind: " ", line: a[x - 1] as string });
			x--;
			y--;
		}
		if (x === prevX) ops.push({ kind: "+", line: b[y - 1] as string });
		else ops.push({ kind: "-", line: a[x - 1] as string });
		x = prevX;
		y = prevY;
	}
	while (x > 0 && y > 0) {
		ops.push({ kind: " ", line: a[x - 1] as string });
		x--;
		y--;
	}
	return ops.reverse();
}

/** Unified-diff hunks (1-based starts, `DIFF_CONTEXT_LINES` of context). */
export function toHunks(
	ops: readonly DiffOp[],
	context = DIFF_CONTEXT_LINES,
): HistoryHunk[] {
	const hunks: HistoryHunk[] = [];
	const changeIdx: number[] = [];
	ops.forEach((op, i) => {
		if (op.kind !== " ") changeIdx.push(i);
	});
	if (changeIdx.length === 0) return hunks;

	// Line numbers before each op, so a hunk's starts are O(1) to read off.
	const oldAt: number[] = [];
	const newAt: number[] = [];
	let o = 0;
	let n = 0;
	for (const op of ops) {
		oldAt.push(o);
		newAt.push(n);
		if (op.kind !== "+") o++;
		if (op.kind !== "-") n++;
	}

	let start = Math.max(0, (changeIdx[0] as number) - context);
	let end = Math.min(ops.length, (changeIdx[0] as number) + context + 1);
	const flush = () => {
		const slice = ops.slice(start, end);
		const oldLines = slice.filter((op) => op.kind !== "+").length;
		const newLines = slice.filter((op) => op.kind !== "-").length;
		hunks.push({
			oldStart:
				oldLines === 0
					? (oldAt[start] as number)
					: (oldAt[start] as number) + 1,
			oldLines,
			newStart:
				newLines === 0
					? (newAt[start] as number)
					: (newAt[start] as number) + 1,
			newLines,
			lines: slice.map((op) => `${op.kind}${op.line}`),
		});
	};
	for (const idx of changeIdx.slice(1)) {
		if (idx - context <= end) {
			end = Math.min(ops.length, idx + context + 1);
		} else {
			flush();
			start = idx - context;
			end = Math.min(ops.length, idx + context + 1);
		}
	}
	flush();
	return hunks;
}

export interface TextDiff {
	hunks: HistoryHunk[];
	additions: number;
	deletions: number;
}

export function diffText(oldText: string, newText: string): TextDiff | null {
	const ops = diffLines(splitLines(oldText), splitLines(newText));
	if (!ops) return null;
	let additions = 0;
	let deletions = 0;
	for (const op of ops) {
		if (op.kind === "+") additions++;
		else if (op.kind === "-") deletions++;
	}
	return { hunks: toHunks(ops), additions, deletions };
}
