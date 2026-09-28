export type LabelSide = "below" | "above" | "right" | "left";

/** Tie-break order: below reads most naturally as a caption, then above, then beside. */
const SIDE_PREFERENCE: readonly LabelSide[] = [
	"below",
	"above",
	"right",
	"left",
];

function sideOf(x: number, y: number): LabelSide {
	if (Math.abs(y) >= Math.abs(x)) return y > 0 ? "below" : "above";
	return x > 0 ? "right" : "left";
}

/**
 * Which side of a sprite its name label goes on, given the directions of
 * every path leaving that sprite (vectors from the sprite toward where each
 * path goes; length doesn't matter). A label defaults to below, but a path
 * running mostly downward out of the sprite would put the label right on the
 * path — where the player walks and covers it (2026-09-28 playtest: the
 * shelf's north cabin had its name sitting on its own spoke). Each path
 * blocks the side its direction falls in (90-degree sectors); the label
 * takes the least-blocked side, ties going to SIDE_PREFERENCE order.
 */
export function pickLabelSide(
	pathDirections: ReadonlyArray<{ x: number; y: number }>,
): LabelSide {
	const blocked: Record<LabelSide, number> = {
		below: 0,
		above: 0,
		right: 0,
		left: 0,
	};
	for (const { x, y } of pathDirections) {
		if (x === 0 && y === 0) continue;
		blocked[sideOf(x, y)]++;
	}
	let best: LabelSide = "below";
	for (const side of SIDE_PREFERENCE) {
		if (blocked[side] < blocked[best]) best = side;
	}
	return best;
}

export interface LabelAnchor {
	x: number;
	y: number;
	originX: number;
	originY: number;
}

/** Where to put a label (and which edge of it to anchor) so it sits `gap` px off the given side of a centred `width` x `height` sprite. */
export function labelAnchor(
	side: LabelSide,
	center: { x: number; y: number },
	width: number,
	height: number,
	gap: number,
): LabelAnchor {
	switch (side) {
		case "below":
			return {
				x: center.x,
				y: center.y + height / 2 + gap,
				originX: 0.5,
				originY: 0,
			};
		case "above":
			return {
				x: center.x,
				y: center.y - height / 2 - gap,
				originX: 0.5,
				originY: 1,
			};
		case "right":
			return {
				x: center.x + width / 2 + gap,
				y: center.y,
				originX: 0,
				originY: 0.5,
			};
		case "left":
			return {
				x: center.x - width / 2 - gap,
				y: center.y,
				originX: 1,
				originY: 0.5,
			};
	}
}
