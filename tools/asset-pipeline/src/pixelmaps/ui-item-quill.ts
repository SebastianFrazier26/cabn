import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 40;
const HEIGHT = 60;
// Nib (dipped in ink, bottom-left) -> feather tip (top-right), same diagonal
// composition as letter_opener.png's blade.
const AX = 8;
const AY = 54;
const BX = 30;
const BY = 8;
const AXIS_DX = BX - AX;
const AXIS_DY = BY - AY;
const AXIS_LEN = Math.hypot(AXIS_DX, AXIS_DY);
const UX = AXIS_DX / AXIS_LEN;
const UY = AXIS_DY / AXIS_LEN;
const MAX_VANE_WIDTH = 7.2;

/**
 * Quill tool icon — a feather with an ink-dipped nib, resting on a small
 * inkwell. v3: scaled ~2x with a third barb tone (a gradient across the
 * vane instead of a flat two-stripe alternation) and a glint on the
 * inkwell's shoulder.
 */
export function buildQuillIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline / rachis / nib
		C: 29, // cream — feather vane, lightest barb
		T: 26, // parchment-shade tan — feather vane, mid barb
		R: 24, // light tan — feather vane, third gradient tone
		D: 2, // dark bronze — inkwell body
		g: 21, // gold — inkwell rim
		W: 30, // pale ghost blue — inkwell glint (reads as a wet-glass highlight)
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 31, 12, 2);
	placeFlowerFleck(rows, 4, 49, 2);
	return { name: "ui_icon_quill", width: WIDTH, height: HEIGHT, legend, rows };
}

function pixelAt(x: number, y: number): string {
	const inkwell = inkwellChar(x, y);
	if (inkwell) return inkwell;

	const rx = x - AX;
	const ry = y - AY;
	const along = rx * UX + ry * UY;
	const perp = rx * -UY + ry * UX;
	if (along < -0.5 || along > AXIS_LEN + 0.5) return ".";

	const t = Math.max(0, Math.min(1, along / AXIS_LEN));
	const width = MAX_VANE_WIDTH * Math.sin(Math.PI * t) + 0.8;
	if (Math.abs(perp) > width) return ".";
	if (Math.abs(perp) > width - 1.1) return "O"; // vane edge
	if (Math.abs(perp) < 0.9) return "O"; // rachis (central shaft)
	if (along < 5) return "O"; // nib, dipped dark

	// Three-tone barb gradient across the vane width (near the rachis ->
	// mid -> outer edge), instead of v2's flat two-stripe alternation.
	const outerness = Math.abs(perp) / Math.max(width, 0.01);
	const stripe = Math.floor(along / 2.4) % 2 === 0;
	if (outerness > 0.6) return stripe ? "T" : "R";
	return stripe ? "C" : "T";
}

function inkwellChar(x: number, y: number): string | null {
	const cx = 8;
	const cy = 54;
	const dx = x - cx;
	const dy = y - cy;
	if (dy < -4 || dy > 4 || Math.abs(dx) > 6) return null;
	if (dy === -4) return Math.abs(dx) <= 6 ? "g" : null; // rim
	if (Math.abs(dx) > 6 - Math.abs(dy) * 0.3) return "O";
	if (dy < -1 && dx < -1 && dx > -4) return "W"; // glint on the shoulder
	return "D";
}
