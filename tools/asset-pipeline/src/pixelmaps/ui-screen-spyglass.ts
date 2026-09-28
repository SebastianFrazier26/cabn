import type { PixelMap } from "../pixelmap.js";
import { bandAt, type ContentRect, screenCanvas } from "./ui-screen-canvas.js";

const W = 136;
const H = 136;
const CX = 58;
const CY = 58;
const R = 56;
const RIM = 7;

/**
 * The spyglass ("ls") screen's frame (SpyglassPanel.tsx): the objective end
 * of a brass spyglass seen head-on — an engraved, screwed brass rim around a
 * transparent lens, with the tube and a leather grip running off to the
 * lower right so it reads as a spyglass rather than a porthole. The lens
 * interior is transparent; the panel background shows through it.
 */
export const SPYGLASS_SCREEN_SIZE = { width: W, height: H };

/** Largest rect inside the transparent lens (radius R - RIM) — SpyglassPanel.tsx insets its content to this, so file names never clip at the rim. */
export const SPYGLASS_CONTENT_RECT: ContentRect = {
	x: CX - 39,
	y: CY - 29,
	width: 78,
	height: 58,
};

/** The lens circle itself, for the panel background the lens shows through. */
export const SPYGLASS_LENS = { cx: CX, cy: CY, r: R - RIM };

export function buildSpyglassScreen(): PixelMap {
	const c = screenCanvas(W, H);
	const ux = Math.SQRT1_2;
	const uy = Math.SQRT1_2;

	// Tube: brass sections stepping down in radius, a leather grip, an end cap.
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x + 0.5 - CX;
			const dy = y + 0.5 - CY;
			const along = dx * ux + dy * uy;
			const perp = -dx * uy + dy * ux;
			if (along < R - 6 || along > R + 36) continue;
			const radius = along < R + 8 ? 16 : along < R + 26 ? 13 : 11.5;
			if (Math.abs(perp) > radius) continue;
			const t = perp / radius;
			const grip = along >= R + 10 && along < R + 26;
			const ring =
				Math.abs(along - (R + 8)) < 1 ||
				Math.abs(along - (R + 26)) < 1 ||
				along > R + 34;
			if (ring) c.set(x, y, t < -0.3 ? "g" : "B");
			else if (grip)
				c.set(x, y, t < -0.4 ? "l" : Math.round(along) % 3 === 0 ? "d" : "L");
			else c.set(x, y, t < -0.5 ? "g" : t < 0 ? "b" : t < 0.5 ? "m" : "B");
		}
	}

	c.ellipse(CX, CY, R, R, (_x, _y, nx, ny) => {
		const d = Math.hypot(nx, ny) * R;
		if (d < R - RIM) {
			const angle = Math.atan2(ny, nx);
			return d > R - RIM - 3 &&
				d < R - RIM - 1 &&
				angle > -2.05 &&
				angle < -1.65
				? "G"
				: null;
		}
		if (d < R - RIM + 1) return "B";
		const angle = Math.atan2(ny, nx);
		const tick = (angle / (Math.PI / 12) + 24) % 1;
		if (d > R - 5 && d < R - 3 && (tick < 0.1 || tick > 0.9)) return "B";
		const b = bandAt(nx, ny);
		const inner = d < R - RIM + 2.5;
		if (b === 3) return inner ? "b" : "g";
		if (b === 2) return inner ? "m" : "b";
		if (b === 1) return "m";
		return "B";
	});
	for (const a of [
		(-3 * Math.PI) / 4,
		-Math.PI / 4,
		Math.PI / 4,
		(3 * Math.PI) / 4,
	]) {
		const sx = Math.round(CX + Math.cos(a) * (R - 3.5));
		const sy = Math.round(CY + Math.sin(a) * (R - 3.5));
		c.set(sx - 1, sy - 1, "g");
		c.set(sx, sy - 1, "b");
		c.set(sx - 1, sy, "b");
		c.set(sx, sy, "O");
	}
	c.outline("O");
	return c.toPixelMap("ui_screen_spyglass", {
		O: 0, // ink outline, screw slots
		G: 30, // pale ghost blue — lens glint
		g: 25, // bright brass
		b: 17, // brass highlight
		m: 12, // brass mid
		B: 2, // dark brass, engraved ticks
		l: 8, // light leather — grip, lit side
		L: 5, // leather
		d: 2, // leather wrap seam
	});
}
