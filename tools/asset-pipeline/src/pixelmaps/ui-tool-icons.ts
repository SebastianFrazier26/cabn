import type { PixelMap } from "../pixelmap.js";

/**
 * Spellbook toolbar icons (2026-09-28, round-2 playtest) — small 24x24
 * companions to the 40-60px hotbar item icons: same shared palette indices,
 * same fixed up-left light (bright cream glint top-left, dark shade
 * bottom-right) and the same ink outline, just at a density that still
 * reads at ~24 CSS px beside a text label. Each shape is drawn as flat fills
 * and then `outline()` rings every filled region in ink, so outlines stay a
 * uniform 1 cell regardless of shape instead of being hand-placed per icon.
 */
export const TOOL_ICON_SIZE = 24;

export const TOOL_ICON_NAMES = [
	"find",
	"replace",
	"rename",
	"format",
	"comment",
	"goto",
	"symbol",
	"fold",
	"unfold",
	"save",
] as const;
export type ToolIconName = (typeof TOOL_ICON_NAMES)[number];

const LEGEND: Record<string, number> = {
	O: 0, // ink outline
	W: 29, // cream glint
	P: 27, // parchment light
	p: 26, // parchment shade
	t: 24, // parchment deep shade
	G: 30, // pale ghost blue (glass)
	g: 21, // gold
	y: 38, // bright gold
	b: 12, // bronze mid
	B: 2, // dark bronze
	V: 33, // amethyst
	v: 32, // plum
	E: 41, // leaf green light
	e: 40, // leaf green
	R: 55, // seal red
	r: 34, // seal red dark
	C: 53, // sky blue
	c: 37, // periwinkle
};

type Grid = string[][];

function blank(): Grid {
	return Array.from({ length: TOOL_ICON_SIZE }, () =>
		Array.from({ length: TOOL_ICON_SIZE }, () => "."),
	);
}

function set(grid: Grid, x: number, y: number, ch: string): void {
	const row = grid[y];
	if (!row || x < 0 || x >= row.length) return;
	row[x] = ch;
}

function rect(
	grid: Grid,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	ch: string,
): void {
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) set(grid, x, y, ch);
}

function line(
	grid: Grid,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	ch: string,
): void {
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	let x = x0;
	let y = y0;
	for (;;) {
		set(grid, x, y, ch);
		if (x === x1 && y === y1) return;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y += sy;
		}
	}
}

function disc(
	grid: Grid,
	cx: number,
	cy: number,
	r: number,
	shade: (dx: number, dy: number, dist: number) => string,
): void {
	for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
		for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.hypot(dx, dy);
			if (dist <= r) set(grid, x, y, shade(dx, dy, dist));
		}
	}
}

/** Rings every filled cell's transparent 4-neighbors in ink. */
function outline(grid: Grid): void {
	const marks: Array<[number, number]> = [];
	for (let y = 0; y < TOOL_ICON_SIZE; y++) {
		for (let x = 0; x < TOOL_ICON_SIZE; x++) {
			if (grid[y]?.[x] !== ".") continue;
			const filled = [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			].some(([dx, dy]) => {
				const c = grid[y + (dy as number)]?.[x + (dx as number)];
				return c !== undefined && c !== "." && c !== "O";
			});
			if (filled) marks.push([x, y]);
		}
	}
	for (const [x, y] of marks) set(grid, x, y, "O");
}

/** Up-left lit, bottom-right shaded parchment sheet — shared by page-like icons. */
function page(
	grid: Grid,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): void {
	rect(grid, x0, y0, x1, y1, "P");
	rect(grid, x0, y1 - 1, x1, y1, "p");
	rect(grid, x1 - 1, y0, x1, y1, "p");
	set(grid, x1, y1, "t");
	set(grid, x0, y0, "W");
	set(grid, x0 + 1, y0, "W");
	set(grid, x0, y0 + 1, "W");
}

function toMap(name: ToolIconName, grid: Grid): PixelMap {
	return {
		name: `ui_tool_${name}`,
		width: TOOL_ICON_SIZE,
		height: TOOL_ICON_SIZE,
		legend: LEGEND,
		rows: grid.map((row) => row.join("")),
	};
}

function glassShade(dx: number, dy: number, dist: number, r: number): string {
	if (Math.hypot(dx + r * 0.4, dy + r * 0.4) < r * 0.3) return "W";
	return dx + dy > r * 0.6 || dist > r - 0.8 ? "c" : "G";
}

function buildFind(): Grid {
	const g = blank();
	line(g, 13, 13, 20, 20, "B");
	line(g, 14, 13, 21, 20, "b");
	line(g, 13, 14, 20, 21, "B");
	disc(g, 9, 9, 6.6, (dx, dy, dist) =>
		dist > 5.2 ? (dx + dy < 0 ? "y" : "g") : glassShade(dx, dy, dist, 5.2),
	);
	outline(g);
	return g;
}

function arrowHead(
	g: Grid,
	tipX: number,
	tipY: number,
	dir: 1 | -1,
	ch: string,
): void {
	for (let i = 0; i < 4; i++) {
		for (let y = tipY - i; y <= tipY + i; y++) set(g, tipX - dir * i, y, ch);
	}
}

function buildReplace(): Grid {
	const g = blank();
	// Top arrow bends right, bottom arrow bends back left: the "swap" loop.
	rect(g, 4, 5, 16, 7, "V");
	rect(g, 4, 5, 16, 5, "W");
	rect(g, 3, 5, 5, 11, "V");
	arrowHead(g, 20, 6, 1, "V");
	rect(g, 7, 16, 19, 18, "e");
	rect(g, 7, 16, 19, 16, "E");
	rect(g, 18, 12, 20, 18, "e");
	arrowHead(g, 3, 17, -1, "e");
	outline(g);
	return g;
}

function buildRename(): Grid {
	const g = blank();
	// A luggage-style name tag with its string hole on the left.
	for (let y = 6; y <= 17; y++) {
		const inset = Math.max(0, 3 - Math.min(y - 6, 17 - y));
		rect(g, 3 + inset, y, 20, y, y > 14 ? "p" : "P");
	}
	rect(g, 19, 6, 20, 17, "p");
	rect(g, 6, 11, 7, 12, "O");
	rect(g, 10, 9, 17, 9, "O");
	rect(g, 10, 12, 15, 12, "O");
	rect(g, 10, 15, 16, 15, "V");
	set(g, 4, 9, "W");
	outline(g);
	return g;
}

function buildFormat(): Grid {
	const g = blank();
	page(g, 3, 3, 17, 20);
	// Stair-stepped indentation lines — what "format" does to a page.
	rect(g, 5, 6, 13, 6, "O");
	rect(g, 7, 9, 14, 9, "O");
	rect(g, 9, 12, 15, 12, "O");
	rect(g, 7, 15, 13, 15, "O");
	rect(g, 5, 18, 10, 18, "O");
	// Gold sparkle on the corner: the spell that tidies it.
	for (const [dx, dy] of [
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[2, 0],
		[-2, 0],
		[0, 2],
		[0, -2],
	] as const) {
		set(g, 19 + dx, 18 + dy, Math.abs(dx) + Math.abs(dy) === 2 ? "g" : "y");
	}
	set(g, 19, 18, "W");
	outline(g);
	return g;
}

function buildComment(): Grid {
	const g = blank();
	disc(g, 11.5, 10.5, 8.4, (dx, dy) => (dx + dy > 6 ? "p" : "P"));
	for (let i = 0; i < 4; i++) rect(g, 5 - i, 16 + i, 7 - i, 16 + i, "p");
	set(g, 6, 5, "W");
	set(g, 7, 4, "W");
	// The "//" of a line comment, in the violet the editor's glyphs use.
	line(g, 10, 13, 13, 6, "V");
	line(g, 11, 13, 14, 6, "v");
	line(g, 14, 13, 17, 6, "V");
	line(g, 15, 13, 18, 6, "v");
	outline(g);
	return g;
}

function buildGoto(): Grid {
	const g = blank();
	rect(g, 10, 4, 12, 21, "b");
	rect(g, 10, 4, 10, 21, "y");
	rect(g, 12, 4, 12, 21, "B");
	rect(g, 7, 20, 15, 21, "e");
	// Signboard pointing right.
	rect(g, 3, 6, 17, 11, "g");
	rect(g, 3, 6, 17, 6, "y");
	rect(g, 3, 11, 17, 11, "b");
	arrowHead(g, 21, 8, 1, "g");
	set(g, 21, 9, "g");
	for (let y = 5; y <= 12; y++) {
		const reach = 21 - Math.abs(y - 8.5) + 0.5;
		for (let x = 18; x <= reach; x++) set(g, x, y, y > 10 ? "b" : "g");
	}
	rect(g, 5, 8, 13, 9, "B");
	set(g, 4, 7, "W");
	outline(g);
	return g;
}

function buildSymbol(): Grid {
	const g = blank();
	// A brass compass: "find your way to a named place in the file".
	disc(g, 11.5, 11.5, 9.5, (dx, dy, dist) => {
		if (dist > 7.8) return dx + dy < 0 ? "y" : "b";
		return dx + dy > 4 ? "p" : "P";
	});
	line(g, 11, 11, 11, 5, "R");
	line(g, 12, 11, 12, 5, "r");
	line(g, 11, 12, 11, 18, "C");
	line(g, 12, 12, 12, 18, "c");
	set(g, 11, 11, "W");
	set(g, 12, 12, "O");
	set(g, 7, 6, "W");
	outline(g);
	return g;
}

function chevron(
	g: Grid,
	cx: number,
	tipY: number,
	pointsDown: boolean,
	ch: string,
): void {
	for (let i = 0; i < 5; i++) {
		const y = pointsDown ? tipY - i : tipY + i;
		set(g, cx - i, y, ch);
		set(g, cx + i, y, ch);
		set(g, cx - i, y + (pointsDown ? -1 : 1), ch);
		set(g, cx + i, y + (pointsDown ? -1 : 1), ch);
	}
}

function buildFoldIcon(collapse: boolean): Grid {
	const g = blank();
	page(g, 4, 3, 19, 20);
	rect(g, 6, 11, 17, 12, "p");
	if (collapse) {
		chevron(g, 11, 9, true, "V");
		chevron(g, 11, 14, false, "V");
	} else {
		chevron(g, 11, 4, false, "V");
		chevron(g, 11, 19, true, "V");
	}
	outline(g);
	return g;
}

function buildSave(): Grid {
	const g = blank();
	// A folded letter pressed shut with a red wax seal.
	page(g, 2, 5, 21, 18);
	line(g, 3, 6, 11, 12, "p");
	line(g, 20, 6, 12, 12, "p");
	disc(g, 11.5, 13, 4.2, (dx, dy) =>
		Math.hypot(dx + 1.2, dy + 1.2) < 1.3 ? "W" : dx + dy > 1.5 ? "r" : "R",
	);
	outline(g);
	return g;
}

const BUILDERS: Record<ToolIconName, () => Grid> = {
	find: buildFind,
	replace: buildReplace,
	rename: buildRename,
	format: buildFormat,
	comment: buildComment,
	goto: buildGoto,
	symbol: buildSymbol,
	fold: () => buildFoldIcon(true),
	unfold: () => buildFoldIcon(false),
	save: buildSave,
};

export function buildToolIcon(name: ToolIconName): PixelMap {
	return toMap(name, BUILDERS[name]());
}
