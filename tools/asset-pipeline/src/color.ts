export interface RGB {
	r: number;
	g: number;
	b: number;
}

export interface WeightedColor extends RGB {
	count: number;
}

export function colorDistance(a: RGB, b: RGB): number {
	const dr = a.r - b.r;
	const dg = a.g - b.g;
	const db = a.b - b.b;
	return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Rec. 601 luma — good enough for sorting a small palette by perceived brightness.
export function luminance(c: RGB): number {
	return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

export function toHex(c: RGB): string {
	const channel = (v: number) => v.toString(16).padStart(2, "0");
	return `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
}

export function nearestColorIndex(
	target: RGB,
	palette: readonly RGB[],
): number {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < palette.length; i++) {
		const candidate = palette[i];
		if (!candidate) continue;
		const distance = colorDistance(target, candidate);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = i;
		}
	}
	return bestIndex;
}
