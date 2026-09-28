/** Left-half rows -> full symmetric rows (the half is reflected, so a 10-char half yields a 20-wide row). */
export function mirrored(halfRows: readonly string[]): string[] {
	return halfRows.map((half) => half + [...half].reverse().join(""));
}

/** Stamps `patch` rows onto `rows` at (x, y); '.' in a patch leaves the underlying cell alone. For the asymmetric bits (a tail, a held coin) on an otherwise mirrored body. */
export function overlay(
	rows: readonly string[],
	x: number,
	y: number,
	patch: readonly string[],
): string[] {
	const out = rows.map((r) => [...r]);
	patch.forEach((line, dy) => {
		const row = out[y + dy];
		if (!row) return;
		[...line].forEach((ch, dx) => {
			if (ch !== "." && x + dx < row.length) row[x + dx] = ch;
		});
	});
	return out.map((r) => r.join(""));
}
