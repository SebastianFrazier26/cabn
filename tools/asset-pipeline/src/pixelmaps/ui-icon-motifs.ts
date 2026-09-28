/**
 * Shared accent motifs for the v2 item icons (orb/spyglass/bag/quill/wand) —
 * the same small leaf-sprig + cream-flower cluster that `key.png` and
 * `letter_opener.png` both carry near their base, so the five new icons read
 * as the same "family" as the existing recovered originals rather than as a
 * mismatched style bolted on next to them. Legend chars are fixed
 * (`v`/`V` leaf, `f` flower) — every icon file must declare them pointing at
 * the same three palette indices for `placeMotif`'s output to make sense.
 */
export const LEAF_LEGEND = { v: 4, V: 11 } as const; // grove dark / meadow mid green
export const FLOWER_LEGEND = { f: 29 } as const; // cream

const LEAF_SPRIG: ReadonlyArray<readonly [number, number, string]> = [
	[0, 0, "v"],
	[1, -1, "V"],
	[-1, -1, "v"],
	[1, 0, "V"],
	[0, -2, "V"],
];
const FLOWER_FLECK: ReadonlyArray<readonly [number, number, string]> = [
	[0, 0, "f"],
	[1, 0, "f"],
	[0, -1, "f"],
];

function placeMotif(
	rows: string[],
	motif: ReadonlyArray<readonly [number, number, string]>,
	x0: number,
	y0: number,
): void {
	for (const [dx, dy, ch] of motif) {
		const x = x0 + dx;
		const y = y0 + dy;
		const row = rows[y];
		if (row === undefined || x < 0 || x >= row.length) continue;
		rows[y] = `${row.slice(0, x)}${ch}${row.slice(x + 1)}`;
	}
}

/** Mutates `rows` in place, stamping the shared leaf sprig anchored at (x0, y0). */
export function placeLeafSprig(rows: string[], x0: number, y0: number): void {
	placeMotif(rows, LEAF_SPRIG, x0, y0);
}

/** Mutates `rows` in place, stamping the shared flower fleck anchored at (x0, y0). */
export function placeFlowerFleck(rows: string[], x0: number, y0: number): void {
	placeMotif(rows, FLOWER_FLECK, x0, y0);
}
