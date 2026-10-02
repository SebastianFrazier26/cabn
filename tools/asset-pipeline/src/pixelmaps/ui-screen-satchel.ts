import type { PixelMap } from "../pixelmap.js";
import { type ContentRect, screenCanvas } from "./ui-screen-canvas.js";

const W = 128;
const H = 116;
const CX = 64;
const BODY_TOP = 30;
const BODY_BOTTOM = 112;

/**
 * The open satchel (BagTray.tsx): leather body with a stitched front panel
 * the grabbed-slot pouches sit on, a side pouch on each flank, brass strap
 * rings, and the flap already folded open behind the mouth (its lighter
 * lining face showing). A separate `ui_screen_satchel_flap` — the flap's
 * outer face — is what BagTray's open animation swings up and away.
 */
export const SATCHEL_SCREEN_SIZE = { width: W, height: H };

/** Inside the stitched front panel — BagTray.tsx lays the slot pouches, title and close button out within this rect. */
export const SATCHEL_CONTENT_RECT: ContentRect = {
	x: 22,
	y: 38,
	width: 84,
	height: 66,
};

const LEGEND = {
	O: 0, // ink outline
	H: 13, // brightest leather — lit rim
	L: 8, // light leather
	M: 5, // mid leather
	D: 2, // dark leather — shadow, mouth interior
	i: 16, // tan lining — the open flap's inner face
	t: 26, // stitching
	g: 25, // bright brass
	b: 17, // brass
	B: 12, // brass shadow
};

function bodyHalfWidth(y: number): number {
	const base = 48 + ((y - BODY_TOP) / (BODY_BOTTOM - BODY_TOP)) * 6;
	const corner = 12;
	const fromBottom = BODY_BOTTOM - y;
	if (fromBottom >= corner) return base;
	const dy = corner - fromBottom;
	return base - corner + Math.sqrt(Math.max(0, corner * corner - dy * dy));
}

export function buildSatchelScreen(): PixelMap {
	const c = screenCanvas(W, H);

	// Open flap, folded back behind the mouth: lining face up, stitched border.
	c.ellipse(CX, BODY_TOP + 2, 46, 30, (x, y, nx, ny) => {
		if (y > BODY_TOP + 1) return null;
		const d = Math.hypot(nx, ny);
		if (d > 0.93) return "M";
		if (d > 0.86 && (x + y) % 3 !== 0) return "t";
		return y > BODY_TOP - 2 ? "D" : "i";
	});

	// Side pouches.
	for (const side of [-1, 1] as const) {
		const px = side < 0 ? 2 : W - 20;
		c.rect(px, 56, 18, 42, (x, y) => {
			const rel = x - px;
			const round =
				y > 90 && (rel < 2 || rel > 15) && y - 90 > Math.min(rel, 17 - rel);
			if (round) return null;
			if (y < 62) return y === 56 ? "H" : rel % 5 === 0 ? "t" : "L";
			if (y === 62) return "D";
			return rel < 4 ? "L" : rel > 13 ? "D" : "M";
		});
		c.rect(px + 7, 60, 4, 4, (x, y) => (x === px + 7 && y === 60 ? "g" : "b"));
	}

	// Body.
	for (let y = BODY_TOP; y < BODY_BOTTOM; y++) {
		const hw = bodyHalfWidth(y);
		c.rect(Math.round(CX - hw), y, Math.round(hw * 2), 1, (x) => {
			const fromLeft = x - (CX - hw);
			const fromRight = CX + hw - x;
			if (y < BODY_TOP + 3) return "D";
			if (y === BODY_TOP + 3) return "H";
			if (fromLeft < 2) return "H";
			if (fromRight < 3 || y > BODY_BOTTOM - 4) return "D";
			if (fromRight < 10) return "M";
			return "L";
		});
	}

	// Stitched front panel framing the content rect.
	const p = SATCHEL_CONTENT_RECT;
	c.rect(p.x - 4, p.y - 4, p.width + 8, p.height + 8, (x, y) => {
		const edge =
			x === p.x - 4 ||
			y === p.y - 4 ||
			x === p.x + p.width + 3 ||
			y === p.y + p.height + 3;
		if (edge) return x === p.x - 4 || y === p.y - 4 ? "D" : "H";
		const stitchRow = y === p.y - 2 || y === p.y + p.height + 1;
		const stitchCol = x === p.x - 2 || x === p.x + p.width + 1;
		if ((stitchRow && x % 3 !== 0) || (stitchCol && y % 3 !== 0)) return "t";
		return x > p.x + p.width - 4 ? "M" : "L";
	});

	// Brass strap rings at the shoulders, with strap stubs rising from them.
	for (const rx of [CX - 44, CX + 40]) {
		c.rect(rx, BODY_TOP - 10, 4, 10, (x) => (x === rx ? "L" : "M"));
		c.ellipse(rx + 2, BODY_TOP + 1, 3.2, 3.2, (_x, _y, nx, ny) => {
			const d = Math.hypot(nx, ny);
			if (d < 0.45) return "D";
			return nx + ny < -0.3 ? "g" : nx + ny > 0.5 ? "B" : "b";
		});
	}
	c.outline("O");
	return c.toPixelMap("ui_screen_satchel", LEGEND);
}

export const SATCHEL_FLAP_SIZE = { width: 96, height: 30 };

/** The flap's outer face with its buckle tab — the piece BagTray swings open. */
export function buildSatchelFlap(): PixelMap {
	const { width: fw, height: fh } = SATCHEL_FLAP_SIZE;
	const c = screenCanvas(fw, fh);
	c.ellipse(fw / 2, 0, fw / 2 - 1, fh - 2, (x, y, nx, ny) => {
		const d = Math.hypot(nx, ny);
		if (d > 0.9) return nx < 0 ? "H" : "D";
		if (d > 0.83 && (x + y) % 3 !== 0) return "t";
		return nx > 0.5 ? "M" : "L";
	});
	c.rect(fw / 2 - 5, fh - 10, 10, 8, (x, y) => {
		if (y === fh - 10 || y === fh - 3) return "B";
		if (x === fw / 2 - 5 || x === fw / 2 + 4) return "b";
		return Math.abs(x - fw / 2 + 0.5) < 1.5 ? "D" : "g";
	});
	c.outline("O");
	return c.toPixelMap("ui_screen_satchel_flap", LEGEND);
}
