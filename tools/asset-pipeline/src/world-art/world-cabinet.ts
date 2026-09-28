import {
	createGrid,
	createMask,
	fillRect,
	fillTriangle,
	type Grid,
	type GroundTonesLike,
	maskEllipse,
	outlineGrid,
	paintFoliage,
	setPixel,
} from "../pixel-shapes.js";
import type { Prop } from "./props.js";

export interface WorldCabinetPalette {
	ink: number;
	wood: number;
	woodDark: number;
	woodLight: number;
	handle: number;
	handleBright: number;
	glassBack: number;
	glint: number;
	/** Book-spine / jar colors on the shelves behind the glass, cycled left to right. */
	curios: readonly number[];
	ivy: GroundTonesLike;
}

export const WORLD_CABINET_WIDTH = 30;
export const WORLD_CABINET_HEIGHT = 40;

/**
 * The in-world cabinet marker (WorldScene's non-root clusters). Batch 3 drew
 * this as an 18x22 grid at cellSize 6 and WorldScene displayed it unscaled —
 * 108x132px, twice the player's height, which the M10 playtest read as
 * "oversized brown blocks". Redrawn on the wizard tower's grid density
 * instead (cellSize 16, displayed at the tower's own scale — engine
 * render/scale.ts's WORLD_CABINET_SCALE, ~90px tall, ~1.4x the player), so
 * the extra grid cells go into what makes it read as a curio cabinet rather
 * than a plank box: a carved crown, two glass doors with shelves of little
 * books and jars behind them, two drawers with brass pulls, short feet, and
 * a trailing ivy sprig in the same foliage treatment as the shelf cabin.
 * 1-cell ink outline and up-left lighting (lit left stile, shaded right
 * stile, glass glints top-left) to match the tower/cabin/icons. WorldScene
 * still applies the per-world theme via subtleTint on top.
 */
export function buildWorldCabinetGrid(p: WorldCabinetPalette): Grid {
	const W = WORLD_CABINET_WIDTH;
	const H = WORLD_CABINET_HEIGHT;
	const g = createGrid(W, H);
	const bodyL = 2;
	const bodyR = 27;
	const bodyTop = 6;
	const bodyBottom = 36;
	const bodyW = bodyR - bodyL + 1;
	const bodyH = bodyBottom - bodyTop + 1;

	fillRect(g, bodyL, bodyTop, bodyW, bodyH, p.wood);
	fillRect(g, bodyL, bodyTop, 2, bodyH, p.woodLight);
	fillRect(g, bodyR - 1, bodyTop, 2, bodyH, p.woodDark);

	fillTriangle(g, 5, 4, 25, 4, 15, 0.5, p.wood);
	fillTriangle(g, 5, 4, 15, 4, 15, 0.5, p.woodLight);
	setPixel(g, 15, 2, p.handleBright);
	setPixel(g, 14, 3, p.handle);
	setPixel(g, 15, 3, p.handle);
	fillRect(g, 1, 4, W - 2, 1, p.woodLight);
	fillRect(g, 1, 5, W - 2, 1, p.woodDark);

	glassDoor(g, p, 4, 8, 10, 14, 0);
	glassDoor(g, p, 16, 8, 10, 14, 3);
	fillRect(g, 14, 8, 2, 14, p.woodDark);
	setPixel(g, 13, 15, p.handleBright);
	setPixel(g, 16, 15, p.handle);

	fillRect(g, bodyL, 23, bodyW, 1, p.ink);
	for (const y0 of [24, 30]) {
		fillRect(g, 4, y0, 22, 5, p.wood);
		fillRect(g, 4, y0, 22, 1, p.woodLight);
		fillRect(g, 4, y0 + 4, 22, 1, p.woodDark);
		fillRect(g, 4, y0 + 5, 22, 1, p.ink);
		for (const px of [9, 19]) {
			fillRect(g, px, y0 + 2, 2, 1, p.handle);
			setPixel(g, px, y0 + 2, p.handleBright);
		}
	}
	fillRect(g, bodyL, bodyBottom, bodyW, 1, p.woodDark);

	for (const x of [3, 24]) {
		fillRect(g, x, 37, 3, 2, p.woodDark);
		setPixel(g, x, 37, p.wood);
	}

	const ivy = createMask(W, H);
	maskEllipse(ivy, 4, 5, 3, 1.6);
	for (let y = 6; y < 20; y++) {
		const x = 2 + Math.round(Math.sin(y * 0.8) * 0.8);
		const row = ivy[y];
		if (!row) continue;
		row[x] = true;
		if (y % 3 === 0) row[x + 1] = true;
	}
	paintFoliage(g, ivy, p.ivy);
	outlineGrid(g, p.ink);
	return g;
}

function glassDoor(
	g: Grid,
	p: WorldCabinetPalette,
	x0: number,
	y0: number,
	w: number,
	h: number,
	curioOffset: number,
): void {
	fillRect(g, x0, y0, w, h, p.woodDark);
	fillRect(g, x0 + 1, y0 + 1, w - 2, h - 2, p.glassBack);
	for (const shelfY of [y0 + 6, y0 + 12]) {
		fillRect(g, x0 + 1, shelfY, w - 2, 1, p.woodLight);
		// Alternating 1-wide book spines (3 tall) and 2-wide jars (2 tall).
		let x = x0 + 2;
		let i = curioOffset + shelfY;
		while (x < x0 + w - 2) {
			const color = p.curios[i % p.curios.length] ?? p.woodLight;
			if (i % 3 === 2 && x + 1 < x0 + w - 2) {
				fillRect(g, x, shelfY - 2, 2, 2, color);
				x += 3;
			} else {
				fillRect(g, x, shelfY - 3, 1, 3, color);
				x += 2;
			}
			i++;
		}
	}
	setPixel(g, x0 + 1, y0 + 1, p.glint);
	setPixel(g, x0 + 2, y0 + 1, p.glint);
	setPixel(g, x0 + 1, y0 + 2, p.glint);
}

export function buildWorldCabinet(p: WorldCabinetPalette): Prop {
	return {
		name: "world-cabinet",
		grid: buildWorldCabinetGrid(p),
		cellSize: 16,
	};
}
