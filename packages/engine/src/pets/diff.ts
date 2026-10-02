/**
 * Line diff for a pet's proposed edit, shown before/after in the
 * spellbook. Common leading/trailing lines are trimmed first (a proposal is
 * one replacement, so the changed middle is small), then an LCS over what's
 * left; a middle too big for the O(n·m) table is shown as one block of
 * removals followed by additions rather than hanging the page.
 */

export type DiffRow =
	| { kind: "same"; oldLine: number; newLine: number; text: string }
	| { kind: "del"; oldLine: number; text: string }
	| { kind: "add"; newLine: number; text: string }
	| { kind: "gap"; hidden: number };

const LCS_CELL_LIMIT = 2_000_000;

export function diffLines(
	before: string,
	after: string,
	context = 3,
): DiffRow[] {
	const a = before.split("\n");
	const b = after.split("\n");
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const middle = middleRows(a, b, start, endA, start, endB);
	const full: DiffRow[] = [];
	for (let i = 0; i < start; i++)
		full.push({
			kind: "same",
			oldLine: i + 1,
			newLine: i + 1,
			text: a[i] ?? "",
		});
	full.push(...middle);
	for (let i = 0; endA + i < a.length; i++)
		full.push({
			kind: "same",
			oldLine: endA + i + 1,
			newLine: endB + i + 1,
			text: a[endA + i] ?? "",
		});
	return collapse(full, context);
}

function middleRows(
	a: readonly string[],
	b: readonly string[],
	a0: number,
	a1: number,
	b0: number,
	b1: number,
): DiffRow[] {
	const n = a1 - a0;
	const m = b1 - b0;
	const rows: DiffRow[] = [];
	if (n * m > LCS_CELL_LIMIT) {
		for (let i = a0; i < a1; i++)
			rows.push({ kind: "del", oldLine: i + 1, text: a[i] ?? "" });
		for (let j = b0; j < b1; j++)
			rows.push({ kind: "add", newLine: j + 1, text: b[j] ?? "" });
		return rows;
	}
	// lcs[i][j] = LCS length of a[a0+i..a1) and b[b0+j..b1).
	const lcs: Uint32Array[] = Array.from(
		{ length: n + 1 },
		() => new Uint32Array(m + 1),
	);
	for (let i = n - 1; i >= 0; i--) {
		const row = lcs[i] as Uint32Array;
		const below = lcs[i + 1] as Uint32Array;
		for (let j = m - 1; j >= 0; j--) {
			row[j] =
				a[a0 + i] === b[b0 + j]
					? (below[j + 1] ?? 0) + 1
					: Math.max(below[j] ?? 0, row[j + 1] ?? 0);
		}
	}
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[a0 + i] === b[b0 + j]) {
			rows.push({
				kind: "same",
				oldLine: a0 + i + 1,
				newLine: b0 + j + 1,
				text: a[a0 + i] ?? "",
			});
			i++;
			j++;
		} else if (
			j < m &&
			(i >= n || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))
		) {
			rows.push({ kind: "add", newLine: b0 + j + 1, text: b[b0 + j] ?? "" });
			j++;
		} else {
			rows.push({ kind: "del", oldLine: a0 + i + 1, text: a[a0 + i] ?? "" });
			i++;
		}
	}
	return rows;
}

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs into one "gap" row. */
function collapse(rows: readonly DiffRow[], context: number): DiffRow[] {
	const keep = new Array<boolean>(rows.length).fill(false);
	rows.forEach((row, idx) => {
		if (row.kind === "same") return;
		for (
			let k = Math.max(0, idx - context);
			k <= Math.min(rows.length - 1, idx + context);
			k++
		)
			keep[k] = true;
	});
	const out: DiffRow[] = [];
	let hidden = 0;
	rows.forEach((row, idx) => {
		if (keep[idx]) {
			if (hidden > 0) out.push({ kind: "gap", hidden });
			hidden = 0;
			out.push(row);
		} else hidden++;
	});
	if (hidden > 0 && out.length > 0) out.push({ kind: "gap", hidden });
	return out;
}

/** The smallest single change turning `before` into `after`, for applying a proposal as one CodeMirror transaction (keeps the caret and undo history sensible). */
export function minimalChange(
	before: string,
	after: string,
): { from: number; to: number; insert: string } {
	let from = 0;
	const max = Math.min(before.length, after.length);
	while (from < max && before.charCodeAt(from) === after.charCodeAt(from))
		from++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (
		endBefore > from &&
		endAfter > from &&
		before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
	) {
		endBefore--;
		endAfter--;
	}
	return { from, to: endBefore, insert: after.slice(from, endAfter) };
}
