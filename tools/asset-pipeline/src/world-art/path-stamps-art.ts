import {
	createGrid,
	fillEllipse,
	fillRect,
	type Grid,
} from "../pixel-shapes.js";

const SEGMENT_WIDTH = 16;
const SEGMENT_HEIGHT = 10;

/**
 * Cobblestone strip segments — batch 2's replacement for batch 1's soft
 * round dirt-brush stamps, which review called out as "blob stacks that
 * look like pancakes": round, unrotated blobs laid along a line read as a
 * pile, not a road. Each segment is a short rectangular strip with a lighter
 * edge-stone border top and bottom (the "edge stones" the brief asks for)
 * and a row of individual stone blocks with mortar gaps between them. Drawn
 * *wide* (16) rather than tall (10) on purpose — see
 * packages/engine/src/render/pathBaker.ts, which now rotates each stamp to
 * match the path's own direction (batch 1 explicitly skipped rotation,
 * fine for a round blob with no facing; a rectangular strip needs it to
 * actually align with the road instead of always lying flat).
 */
function cobbleSegment(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
	edgeStone: number,
	blockOffsets: readonly number[],
): Grid {
	const g = createGrid(SEGMENT_WIDTH, SEGMENT_HEIGHT);
	fillRect(g, 0, 0, SEGMENT_WIDTH, 2, edgeStone);
	fillRect(g, 0, SEGMENT_HEIGHT - 2, SEGMENT_WIDTH, 2, edgeStone);
	fillRect(g, 0, 2, SEGMENT_WIDTH, SEGMENT_HEIGHT - 4, stoneShadow);

	for (let i = 0; i < 4; i++) {
		const cx = 2 + i * 4;
		const wobble = blockOffsets[i] ?? 0;
		fillEllipse(g, cx, SEGMENT_HEIGHT / 2 + wobble, 1.8, 1.9, stone);
	}
	// One brighter fleck per segment reads as a bit of worn/sunlit stone
	// without needing per-pixel noise (see biome-tiles.ts's own "no noise"
	// direction from the batch-1 review).
	fillEllipse(g, 6, SEGMENT_HEIGHT / 2 - 1, 0.8, 0.7, stoneHighlight);

	return g;
}

/** Three fixed block-offset patterns for texture breakup between variants — not randomized, same reasoning as biome-tiles.ts's TUFT_LAYOUTS. */
export function buildPathStampGrids(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
	edgeStone: number,
): Grid[] {
	return [
		cobbleSegment(
			stone,
			stoneShadow,
			stoneHighlight,
			edgeStone,
			[0, 0.4, -0.3, 0.2],
		),
		cobbleSegment(
			stone,
			stoneShadow,
			stoneHighlight,
			edgeStone,
			[-0.3, 0.2, 0.3, -0.2],
		),
		cobbleSegment(
			stone,
			stoneShadow,
			stoneHighlight,
			edgeStone,
			[0.3, -0.3, 0, 0.4],
		),
	];
}
