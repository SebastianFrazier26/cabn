import type { Position, WorldManifest } from "@cabn/world-schema";
import { type LayerIds, worldPathId } from "./worldLayer.js";

export interface MapMarker {
	id: string;
	label: string;
	pos: Position;
	/** Added by the active world layer (drawn in its colour). */
	layer?: true;
}

/** Scene-owned coordinates, copied once: React never reads Phaser objects. */
export interface WorldMapSummary {
	name: string;
	clusters: MapMarker[];
	paths: { from: Position; to: Position; kind: string; layer?: true }[];
	portals: MapMarker[];
	monsters: MapMarker[];
}

export function summarizeWorldMap(
	manifest: WorldManifest,
	portalPositions: ReadonlyMap<string, Position>,
	layer: LayerIds | null = null,
): WorldMapSummary {
	const clusters = new Map(manifest.clusters.map((c) => [c.id, c.pos]));
	const mark = (isLayer: boolean | undefined) =>
		isLayer ? { layer: true as const } : {};
	return {
		name: manifest.meta.name,
		clusters: manifest.clusters.map((c) => ({
			id: c.id,
			label: c.label,
			pos: { ...c.pos },
			...mark(layer?.clusterIds.has(c.id)),
		})),
		paths: manifest.paths.flatMap((p) => {
			const from = clusters.get(p.from);
			const to = clusters.get(p.to);
			return from && to
				? [
						{
							from: { ...from },
							to: { ...to },
							kind: p.kind,
							...mark(layer?.pathIds.has(worldPathId(p))),
						},
					]
				: [];
		}),
		portals: manifest.portals.flatMap((p) => {
			const pos = portalPositions.get(p.id);
			return pos
				? [
						{
							id: p.id,
							label: p.file.path,
							pos: { ...pos },
							...mark(layer?.portalIds.has(p.id)),
						},
					]
				: [];
		}),
		monsters: manifest.monsters.flatMap((m) => {
			let pos = m.portalId ? portalPositions.get(m.portalId) : undefined;
			if (!pos && m.pathId) {
				const [fromId, toId] = m.pathId.split("::");
				const from = clusters.get(fromId ?? "");
				const to = clusters.get(toId ?? "");
				if (from && to)
					pos = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
			}
			return pos
				? [
						{
							id: m.id,
							label: `${m.species}: ${m.error.message}`,
							pos: { ...pos },
							...mark(layer?.monsterIds.has(m.id)),
						},
					]
				: [];
		}),
	};
}

/** Fixed world bounds avoid map jitter as the player moves; preserve aspect ratio. */
export function mapProjection(
	map: WorldMapSummary,
	width: number,
	height: number,
) {
	const points = [...map.clusters, ...map.portals, ...map.monsters].map(
		(m) => m.pos,
	);
	const minX = Math.min(0, ...points.map((p) => p.x)) - 100;
	const minY = Math.min(0, ...points.map((p) => p.y)) - 100;
	const maxX = Math.max(0, ...points.map((p) => p.x)) + 100;
	const maxY = Math.max(0, ...points.map((p) => p.y)) + 100;
	const scale = Math.min(
		(width - 32) / (maxX - minX),
		(height - 32) / (maxY - minY),
	);
	const offsetX = (width - (maxX - minX) * scale) / 2;
	const offsetY = (height - (maxY - minY) * scale) / 2;
	return (pos: Position): Position => ({
		// Traversable scenery extends past markers; keep the player visible at the map edge.
		x: Math.max(8, Math.min(width - 8, offsetX + (pos.x - minX) * scale)),
		y: Math.max(8, Math.min(height - 8, offsetY + (pos.y - minY) * scale)),
	});
}
