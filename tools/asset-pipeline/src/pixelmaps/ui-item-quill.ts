import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 20;
const HEIGHT = 30;
// Nib (dipped in ink, bottom-left) -> feather tip (top-right), same diagonal
// composition as letter_opener.png's blade.
const AX = 4;
const AY = 27;
const BX = 15;
const BY = 4;
const AXIS_DX = BX - AX;
const AXIS_DY = BY - AY;
const AXIS_LEN = Math.hypot(AXIS_DX, AXIS_DY);
const UX = AXIS_DX / AXIS_LEN;
const UY = AXIS_DY / AXIS_LEN;
const MAX_VANE_WIDTH = 3.6;

/** Quill tool icon — a feather with an ink-dipped nib, resting on a small inkwell. */
export function buildQuillIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline / rachis / nib
		C: 29, // cream — feather vane light barb
		T: 26, // parchment-shade tan — feather vane dark barb
		D: 2, // dark bronze — inkwell body
		g: 21, // gold — inkwell rim
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 16, 6);
	placeFlowerFleck(rows, 2, 25);
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
	const width = MAX_VANE_WIDTH * Math.sin(Math.PI * t) + 0.4;
	if (Math.abs(perp) > width) return ".";
	if (Math.abs(perp) > width - 0.8) return "O"; // vane edge
	if (Math.abs(perp) < 0.5) return "O"; // rachis (central shaft)
	if (along < 3) return "O"; // nib, dipped dark
	return Math.floor(along) % 3 === 0 ? "T" : "C"; // barb stripes
}

function inkwellChar(x: number, y: number): string | null {
	const cx = 4;
	const cy = 27;
	const dx = x - cx;
	const dy = y - cy;
	if (dy < -2 || dy > 2 || Math.abs(dx) > 3) return null;
	const rimRow = dy === -2;
	if (rimRow) return Math.abs(dx) <= 3 ? "g" : null;
	if (Math.abs(dx) > 3 - Math.abs(dy) * 0.3) return "O";
	return "D";
}
