import type { PixelMap } from "../pixelmap.js";
import { bandAt, type ContentRect, screenCanvas } from "./ui-screen-canvas.js";

const W = 144;
const H = 184;
const CX = 72;
const CY = 71;
const R = 70;
const RIM = 7;

/**
 * The crystal-orb search screen's frame (OrbSearch.tsx): a glass sphere's
 * lit rim on a bronze cradle, neck and plum plaque (the search input sits on
 * the plaque). The glass interior is transparent — the CSS mist and dark
 * glass gradient show through it, which is what keeps result text readable.
 */
export const ORB_SCREEN_SIZE = { width: W, height: H };

/** Largest rect inside the transparent glass interior (radius R - RIM) — OrbSearch.tsx insets the results list to exactly this, so no row ever clips at the round edge. */
export const ORB_CONTENT_RECT: ContentRect = {
	x: CX - 50,
	y: CY - 38,
	width: 100,
	height: 76,
};

/** The plaque face the search input overlays. */
export const ORB_INPUT_RECT: ContentRect = {
	x: 30,
	y: 155,
	width: 84,
	height: 15,
};

export function buildOrbScreen(): PixelMap {
	const c = screenCanvas(W, H);

	// Cradle ring hugging the lower third of the sphere, then neck, plaque, feet.
	c.ellipse(CX, CY, R + 4, R + 4, (_x, y, nx, ny) => {
		if (y < CY + 44) return null;
		const b = bandAt(nx, ny);
		return b >= 2 ? "b" : b === 1 ? "m" : "B";
	});
	c.rect(CX - 14, CY + R, 28, 12, (x) =>
		x < CX - 9 ? "b" : x > CX + 8 ? "B" : "m",
	);
	c.rect(CX - 22, CY + R + 6, 44, 3, (x, y) =>
		y === CY + R + 6 ? "g" : x > CX + 14 ? "B" : "m",
	);
	const plaqueTop = 152;
	const plaqueBottom = 174;
	for (let y = plaqueTop; y < plaqueBottom; y++) {
		const hw = 46 + (y - plaqueTop) * 0.35;
		c.rect(Math.round(CX - hw), y, Math.round(hw * 2), 1, (x) => {
			const edge = x - (CX - hw);
			const fromRight = CX + hw - x;
			if (y < plaqueTop + 2 || edge < 2.5) return "b";
			if (y >= plaqueBottom - 2 || fromRight < 2.5) return "B";
			if (y === plaqueTop + 2) return "A";
			return "P";
		});
	}
	for (const [x, y] of [
		[CX - 42, plaqueTop + 4],
		[CX + 41, plaqueTop + 4],
		[CX - 43, plaqueBottom - 5],
		[CX + 42, plaqueBottom - 5],
	] as const) {
		c.set(x, y, "g");
		c.set(x + 1, y, "g");
		c.set(x, y + 1, "b");
		c.set(x + 1, y + 1, "B");
	}
	for (const fx of [CX - 40, CX + 30]) {
		c.rect(fx, plaqueBottom, 10, 6, (x, y) =>
			y === plaqueBottom ? "b" : x < fx + 3 ? "m" : "B",
		);
	}

	// Sphere rim: 4-band lit glass, a thin plum inner edge, a specular glint
	// arc up-left, and a transparent interior.
	c.ellipse(CX, CY, R, R, (_x, _y, nx, ny) => {
		const d = Math.hypot(nx, ny) * R;
		if (d < R - RIM) {
			const angle = Math.atan2(ny, nx);
			if (d > R - RIM - 4 && d < R - RIM - 2 && angle > -2.2 && angle < -1.7)
				return "W";
			if (d > R - RIM - 3 && d < R - RIM - 1 && angle > -3.0 && angle < -2.7)
				return "G";
			return null;
		}
		if (d < R - RIM + 1) return "p";
		const b = bandAt(nx, ny);
		if (b === 3) return d < R - 3 ? "W" : "G";
		if (b === 2) return "A";
		if (b === 1) return "a";
		return "P";
	});
	// The cradle's front lip, over the sphere's lowest curve.
	c.ellipse(CX, CY, R + 4, R + 4, (_x, y, nx, ny) => {
		const d = Math.hypot(nx, ny) * (R + 4);
		if (y < CY + 52 || d < R - 2) return null;
		if (d < R - 1) return "g";
		const b = bandAt(nx, ny);
		return b >= 2 ? "b" : b === 1 ? "m" : "B";
	});
	c.outline("O");
	return c.toPixelMap("ui_screen_orb", {
		O: 0, // ink outline
		W: 29, // cream — specular glint
		G: 30, // pale ghost blue — lit glass
		A: 33, // amethyst — glass mid
		a: 37, // periwinkle — glass turning away
		P: 32, // plum — shadowed glass, plaque face
		p: 32, // plum — inner glass edge
		g: 25, // bright brass — rivets, collar glint
		b: 17, // bronze highlight
		m: 12, // bronze mid
		B: 2, // dark bronze
	});
}
