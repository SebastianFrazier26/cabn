import type { Position } from "@cabn/world-schema";
import type Phaser from "phaser";
import { PATH_STAMP_COUNT, pathStampKey } from "../assetPaths.js";
import { hashStringSeed, mulberry32 } from "../systems/deterministicRandom.js";
import { stampPointsAlongSegment } from "./pathStamps.js";

export interface WorldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PathSegment {
	/** Seeds both stamp-variant choice and jitter for this segment — pass a stable id (e.g. `${from}::${to}`), not an array index, so re-ordering `manifest.paths` doesn't reshuffle the art. */
	id: string;
	from: Position;
	to: Position;
}

const STAMP_SPACING_PX = 26;
const STAMP_JITTER_PX = 3;

/**
 * Bakes every path in a world (or the shelf's tower-to-cabin spokes) into one
 * world-bounds-sized `RenderTexture` — same "one GameObject, not thousands of
 * sprites" reasoning as groundBaker.ts, and doubly so here since a path
 * spans clusters rather than sitting inside one. Stamps are placed
 * unrotated: `stampPointsAlongSegment`'s `angle` is still computed (and
 * tested) for a future directional stamp, but every stamp shipped this batch
 * is a soft round/oval dirt blob with no inherent facing, so rotating it
 * would be wasted transform work for a visually identical result.
 */
export function bakePaths(
	scene: Phaser.Scene,
	bounds: WorldBounds,
	segments: readonly PathSegment[],
): Phaser.GameObjects.RenderTexture {
	const width = bounds.maxX - bounds.minX;
	const height = bounds.maxY - bounds.minY;
	const rt = scene.add.renderTexture(
		bounds.minX + width / 2,
		bounds.minY + height / 2,
		width,
		height,
	);

	for (const segment of segments) {
		const seed = hashStringSeed(segment.id);
		const rand = mulberry32(seed);
		const points = stampPointsAlongSegment(
			segment.from,
			segment.to,
			STAMP_SPACING_PX,
			{
				jitterAmount: STAMP_JITTER_PX,
				jitterSeed: seed,
			},
		);
		for (const point of points) {
			const key = pathStampKey(Math.floor(rand() * PATH_STAMP_COUNT));
			const frame = scene.textures.get(key).getSourceImage() as {
				width: number;
				height: number;
			};
			rt.draw(
				key,
				point.x - bounds.minX - frame.width / 2,
				point.y - bounds.minY - frame.height / 2,
			);
		}
	}

	return rt;
}
