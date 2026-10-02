import { hashNoise } from "../noise.js";
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

export interface ShelfCabinPalette {
	ink: number;
	roofSeam: number;
	roofShadow: number;
	roofBase: number;
	roofHighlight: number;
	woodDark: number;
	wood: number;
	woodLight: number;
	stoneDark: number;
	stone: number;
	stoneLight: number;
	windowGlow: number;
	windowWarm: number;
	knob: number;
	pot: number;
	potShadow: number;
	petalA: number;
	petalB: number;
	petalC: number;
	ivy: GroundTonesLike;
}

export const SHELF_CABIN_WIDTH = 52;
export const SHELF_CABIN_HEIGHT = 48;
const APEX_X = 26;
const APEX_Y = 2;
const EAVE_Y = 22;
const WALL_LEFT = 5;
const WALL_RIGHT = 46;
const WALL_TOP = 23;
const WALL_BOTTOM = 42;
const DOOR_LEFT = 22;
const DOOR_RIGHT = 29;
const DOOR_TOP = 29;
const IVY_SEED = 20260928;

/**
 * The shelf's per-world cabin — a from-scratch procedural redraw replacing
 * the matted photographic cabin_256.webp (assets/source/icons/cabin.png),
 * which the M10 playtest called out as far more detailed than the wizard
 * tower beside it. Drawn on the tower's own grid density (48x80 tower vs
 * this 52x48, both rendered at cellSize 16 and displayed at the same scale
 * — see engine render/scale.ts) with the tower's 1-cell ink outline, so the
 * two landmarks read as one set. Keeps the original's cozy beats — ivy
 * over the eaves and walls, two warm lit windows with flower boxes, a
 * plank door, potted plants — as a handful of deliberate shapes rather
 * than the photo's per-pixel texture. Colors stay fairly light and
 * low-saturation on the walls on purpose: ShelfScene multiplies a
 * per-world theme tint over the whole sprite, and dark, saturated wood
 * would swallow it.
 */
export function buildShelfCabinGrid(p: ShelfCabinPalette): Grid {
	const g = createGrid(SHELF_CABIN_WIDTH, SHELF_CABIN_HEIGHT);

	drawChimney(g, p);
	drawRoof(g, p);
	drawWalls(g, p);
	drawFoundation(g, p);
	drawDoor(g, p);
	drawWindow(g, p, 9);
	drawWindow(g, p, 34);
	drawPot(g, p, 18, p.petalA);
	drawPot(g, p, 31, p.petalB);
	paintFoliage(g, buildIvyMask(g), p.ivy);
	outlineGrid(g, p.ink);
	return g;
}

function drawChimney(g: Grid, p: ShelfCabinPalette): void {
	fillRect(g, 36, 4, 5, 12, p.stone);
	fillRect(g, 36, 4, 1, 12, p.stoneLight);
	fillRect(g, 40, 4, 1, 12, p.stoneDark);
	for (let y = 7; y < 16; y += 3) {
		fillRect(g, 36, y, 5, 1, p.stoneDark);
	}
	fillRect(g, 35, 3, 7, 1, p.stoneLight);
	fillRect(g, 35, 4, 7, 1, p.stoneDark);
}

/** Shingle courses 3 rows tall with a staggered scallop seam; the left slope faces the up-left light so it gets a highlight row the right slope doesn't. */
function drawRoof(g: Grid, p: ShelfCabinPalette): void {
	const roofMask = createGrid(SHELF_CABIN_WIDTH, SHELF_CABIN_HEIGHT);
	fillTriangle(roofMask, 0.5, EAVE_Y, 51.5, EAVE_Y, APEX_X, APEX_Y - 1, 1);
	for (let y = APEX_Y; y < EAVE_Y; y++) {
		for (let x = 0; x < SHELF_CABIN_WIDTH; x++) {
			if (roofMask[y]?.[x] !== 1) continue;
			const leftSlope = x < APEX_X;
			const course = Math.floor((y - APEX_Y) / 3);
			const rowInCourse = (y - APEX_Y) % 3;
			const isTopEdge = roofMask[y - 1]?.[x] !== 1;
			let idx: number;
			if (isTopEdge) {
				idx = leftSlope ? p.woodLight : p.wood;
			} else if (rowInCourse === 2) {
				idx = (x + course * 2) % 4 === 0 ? p.roofSeam : p.roofShadow;
			} else if (rowInCourse === 0 && leftSlope) {
				idx = p.roofHighlight;
			} else {
				idx = leftSlope
					? p.roofBase
					: rowInCourse === 0
						? p.roofBase
						: p.roofShadow;
			}
			setPixel(g, x, y, idx);
		}
	}
	fillRect(g, 1, EAVE_Y, 50, 1, p.roofSeam);
}

/** Horizontal log courses (highlight/base/shadow per log, lit from above), round corner-post ends, and a shaded band under the eaves plus a darker right third — the whole wall reads as lit from the up-left. */
function drawWalls(g: Grid, p: ShelfCabinPalette): void {
	for (let y = WALL_TOP; y <= WALL_BOTTOM; y++) {
		const row = (y - WALL_TOP) % 3;
		for (let x = WALL_LEFT; x <= WALL_RIGHT; x++) {
			const shadeRight = x >= WALL_RIGHT - 6;
			let idx = row === 0 ? p.woodLight : row === 1 ? p.wood : p.woodDark;
			if (shadeRight && idx === p.woodLight) idx = p.wood;
			else if (shadeRight && idx === p.wood) idx = p.woodDark;
			setPixel(g, x, y, idx);
		}
	}
	fillRect(g, WALL_LEFT, WALL_TOP, WALL_RIGHT - WALL_LEFT + 1, 2, p.woodDark);
	for (let y = WALL_TOP + 2; y <= WALL_BOTTOM; y += 3) {
		setPixel(g, WALL_LEFT - 1, y, p.woodLight);
		setPixel(g, WALL_LEFT - 1, y + 1, p.wood);
		setPixel(g, WALL_RIGHT + 1, y, p.wood);
		setPixel(g, WALL_RIGHT + 1, y + 1, p.woodDark);
	}
}

function drawFoundation(g: Grid, p: ShelfCabinPalette): void {
	fillRect(g, 3, 43, 46, 3, p.stone);
	fillRect(g, 3, 43, 46, 1, p.stoneLight);
	for (let y = 44; y < 46; y++) {
		for (let x = 3 + (y - 44) * 2; x < 49; x += 5)
			setPixel(g, x, y, p.stoneDark);
	}
	fillRect(g, 3, 45, 46, 1, p.stoneDark);
	fillRect(g, DOOR_LEFT - 2, 43, DOOR_RIGHT - DOOR_LEFT + 5, 2, p.stoneLight);
	fillRect(g, DOOR_LEFT - 2, 45, DOOR_RIGHT - DOOR_LEFT + 5, 1, p.stone);
}

function drawDoor(g: Grid, p: ShelfCabinPalette): void {
	const w = DOOR_RIGHT - DOOR_LEFT + 1;
	fillRect(
		g,
		DOOR_LEFT - 1,
		DOOR_TOP - 1,
		w + 2,
		WALL_BOTTOM - DOOR_TOP + 2,
		p.woodLight,
	);
	fillRect(g, DOOR_LEFT, DOOR_TOP, w, WALL_BOTTOM - DOOR_TOP + 1, p.woodDark);
	// Arched top: knock the two top corners back to frame color so the door
	// reads as rounded rather than a plain rectangle.
	setPixel(g, DOOR_LEFT, DOOR_TOP, p.woodLight);
	setPixel(g, DOOR_RIGHT, DOOR_TOP, p.woodLight);
	setPixel(g, DOOR_LEFT - 1, DOOR_TOP - 1, p.woodDark);
	setPixel(g, DOOR_RIGHT + 1, DOOR_TOP - 1, p.woodDark);
	for (const x of [DOOR_LEFT + 2, DOOR_LEFT + 5]) {
		fillRect(g, x, DOOR_TOP + 1, 1, WALL_BOTTOM - DOOR_TOP, p.ink);
	}
	fillRect(g, DOOR_LEFT + 1, DOOR_TOP + 1, 1, WALL_BOTTOM - DOOR_TOP, p.wood);
	for (const y of [DOOR_TOP + 3, WALL_BOTTOM - 3]) {
		fillRect(g, DOOR_LEFT, y, 3, 1, p.ink);
	}
	setPixel(g, DOOR_RIGHT - 1, DOOR_TOP + 8, p.knob);
	setPixel(g, DOOR_RIGHT - 1, DOOR_TOP + 7, p.windowGlow);
}

/** A 9x9 four-pane window glowing warm (bright enough to cross the night bloom threshold, same trick as the cottage/lamp post), with a flower box under the sill. */
function drawWindow(g: Grid, p: ShelfCabinPalette, x0: number): void {
	const y0 = 28;
	fillRect(g, x0, y0, 9, 9, p.woodLight);
	fillRect(g, x0 + 1, y0 + 1, 7, 7, p.windowGlow);
	fillRect(g, x0 + 1, y0 + 5, 7, 3, p.windowWarm);
	fillRect(g, x0 + 4, y0 + 1, 1, 7, p.woodDark);
	fillRect(g, x0 + 1, y0 + 4, 7, 1, p.woodDark);
	fillRect(g, x0 + 8, y0 + 1, 1, 8, p.wood);
	fillRect(g, x0 - 1, y0 + 9, 11, 2, p.woodDark);
	fillRect(g, x0 - 1, y0 + 9, 11, 1, p.wood);
	const petals = [p.petalA, p.petalC, p.petalB, p.petalC, p.petalA];
	petals.forEach((petal, i) => {
		const fx = x0 + i * 2;
		setPixel(g, fx, y0 + 8, p.ivy.base);
		setPixel(g, fx + 1, y0 + 8, p.ivy.highlight);
		setPixel(g, fx, y0 + 7, petal);
	});
}

function drawPot(
	g: Grid,
	p: ShelfCabinPalette,
	x0: number,
	petal: number,
): void {
	fillRect(g, x0, 40, 3, 3, p.pot);
	fillRect(g, x0 + 2, 40, 1, 3, p.potShadow);
	fillRect(g, x0 - 1, 39, 5, 1, p.pot);
	fillRect(g, x0, 36, 3, 3, p.ivy.base);
	setPixel(g, x0, 36, p.ivy.highlight);
	setPixel(g, x0 + 2, 38, p.ivy.shadow);
	setPixel(g, x0 + 1, 35, petal);
	setPixel(g, x0 - 1, 37, p.ivy.base);
	setPixel(g, x0 + 3, 37, p.ivy.base);
}

/**
 * Ivy draped over both eaves, climbing both corners, framing the door and
 * patching the roof — thinned with a fixed hash so edges are ragged like
 * real ivy, but deterministic (same seed every build). Only grows over
 * cells that are already filled (plus a couple of hanging tendril cells
 * below the eaves), so it never widens the silhouette.
 */
function buildIvyMask(g: Grid): boolean[][] {
	const mask = createMask(SHELF_CABIN_WIDTH, SHELF_CABIN_HEIGHT);
	const onBuilding = (x: number, y: number) => g[y]?.[x] != null;
	const ragged = (threshold: number) => (x: number, y: number) =>
		onBuilding(x, y) && hashNoise(x, y, IVY_SEED) < threshold;

	maskEllipse(mask, 7, 21, 7, 3.2, ragged(0.9));
	maskEllipse(mask, 45, 20.5, 6, 3, ragged(0.9));
	maskEllipse(mask, 16, 12, 3.5, 1.8, ragged(0.85));
	maskEllipse(mask, 31, 17, 4, 1.8, ragged(0.85));
	maskEllipse(mask, 25.5, 27.5, 5.5, 1.6, ragged(0.8));

	for (let y = 24; y <= WALL_BOTTOM; y++) {
		const wiggleL = Math.round(Math.sin(y * 0.7) * 1.2);
		const wiggleR = Math.round(Math.sin(y * 0.6 + 2) * 1.2);
		for (const [cx, spread] of [
			[WALL_LEFT + 1 + wiggleL, y > 36 ? 2 : 1],
			[WALL_RIGHT - 1 + wiggleR, y > 38 ? 2 : 1],
		] as const) {
			for (let dx = -spread; dx <= spread; dx++) {
				const x = cx + dx;
				if (Math.abs(dx) < spread || hashNoise(x, y, IVY_SEED + 1) < 0.55) {
					if (onBuilding(x, y)) {
						const row = mask[y];
						if (row) row[x] = true;
					}
				}
			}
		}
	}

	// Tendrils hanging a few cells below the eave clumps.
	for (const [x, len] of [
		[3, 3],
		[6, 5],
		[10, 2],
		[42, 4],
		[47, 2],
	] as const) {
		for (let y = EAVE_Y + 2; y < EAVE_Y + 2 + len; y++) {
			const row = mask[y];
			if (row && onBuilding(x, y)) row[x] = true;
		}
	}
	return mask;
}
