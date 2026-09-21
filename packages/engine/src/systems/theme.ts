/**
 * Per-world visual theme derived from WorldMeta.themeSeed — the same seed
 * must always tint that world's cabin (on the shelf), its cabinets (inside
 * the world), and its bonfire the same way so a world reads as one place
 * without hand-authoring a palette per project.
 */
export interface Theme {
	/** 0xRRGGBB, ready for Phaser's GameObject#setTint. */
	tint: number;
	hue: number;
	saturation: number;
	lightness: number;
}

// Deliberately duplicated from @cabn/converter's layout.ts mulberry32 rather
// than shared: it's a ~10-line, well-known PRNG, and engine has no other
// reason to depend on converter (a Node-conversion package) just for this.
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Narrow bands, not the full 0-1 range: the brief is "same family, slightly
// different place" — a world tinted near-black or neon would read as broken,
// not themed. Hue rotates freely; saturation/lightness stay inside the
// cottagecore palette's tasteful middle.
const SATURATION_MIN = 0.22;
const SATURATION_RANGE = 0.18; // -> max 0.40
const LIGHTNESS_MIN = 0.42;
const LIGHTNESS_RANGE = 0.16; // -> max 0.58

function hslToHex(hue: number, saturation: number, lightness: number): number {
	const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const hPrime = hue / 60;
	const x = c * (1 - Math.abs((hPrime % 2) - 1));
	const m = lightness - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (hPrime < 1) [r, g, b] = [c, x, 0];
	else if (hPrime < 2) [r, g, b] = [x, c, 0];
	else if (hPrime < 3) [r, g, b] = [0, c, x];
	else if (hPrime < 4) [r, g, b] = [0, x, c];
	else if (hPrime < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	const toByte = (channel: number) => Math.round((channel + m) * 255);
	return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

/** Pure: identical seed -> identical theme, every time. */
export function themeFromSeed(seed: number): Theme {
	// >>> 0 folds negative/fractional seeds (e.g. a hand-authored manifest's
	// stray value) into the same unsigned-32-bit space mulberry32 expects,
	// rather than producing NaN or an out-of-range hue downstream.
	const rand = mulberry32(seed >>> 0);
	const hue = rand() * 360;
	const saturation = SATURATION_MIN + rand() * SATURATION_RANGE;
	const lightness = LIGHTNESS_MIN + rand() * LIGHTNESS_RANGE;
	return {
		tint: hslToHex(hue, saturation, lightness),
		hue,
		saturation,
		lightness,
	};
}
