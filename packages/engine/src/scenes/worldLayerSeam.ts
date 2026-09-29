import type {
	Cluster,
	Portal,
	Position,
	SignEntry,
	WorldLayerManifest,
	WorldManifest,
	WorldPath,
} from "@cabn/world-schema";
import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";
import { DEFAULT_PARTICLES } from "../render/effects.js";
import {
	loadSave,
	persistSave,
	type SaveData,
	withDefeatedMonster,
	withPlayerPosition,
	withVisitedCluster,
} from "../systems/save.js";
import {
	type ActiveWorldLayer,
	inLayerClearing,
	type LayerClearing,
	type LayerIds,
	layerPathRoutes,
	layerSaveSlotId,
	type MergedWorld,
	mergeLayer,
	type RingGeometry,
	ringPathsFor,
	type WorldLayerProvider,
	type WorldSkin,
	worldPathId,
} from "../systems/worldLayer.js";

/** How far below its resting place a layer object starts (and sinks back to). */
const RISE_PX = 36;
const DUST_PARTICLES = 12;

/**
 * Everything WorldScene does differently while a world layer is showing,
 * kept out of the scene itself: the merged manifest, the ring/path rules
 * that keep the base world's layout untouched, the layer's own save slot,
 * its file saves, and the rise/sink of its objects. WorldScene holds one of
 * these only while it was (re)started with a layer.
 */
export class WorldLayerSeam {
	readonly manifest: WorldManifest;
	readonly layer: LayerIds;
	readonly provider: WorldLayerProvider;
	private layerManifest: WorldLayerManifest;
	private routes = new Map<string, Position[]>();
	private slot: SaveData | null = null;
	private risers: Phaser.GameObjects.GameObject[] = [];
	private restY = new Map<Phaser.GameObjects.GameObject, number>();
	private restAlpha = new Map<Phaser.GameObjects.GameObject, number>();

	private constructor(merged: MergedWorld, active: ActiveWorldLayer) {
		this.manifest = merged.manifest;
		this.layer = merged.layer;
		this.provider = active.provider;
		this.layerManifest = active.manifest;
	}

	/** Null (and a console error) when the layer no longer fits this base — WorldScene then starts without it. */
	static create(
		base: WorldManifest,
		active: ActiveWorldLayer,
	): WorldLayerSeam | null {
		try {
			return new WorldLayerSeam(mergeLayer(base, active.manifest), active);
		} catch (err) {
			console.error("cabn: world layer does not fit this world", err);
			return null;
		}
	}

	get id(): string {
		return this.provider.id;
	}

	get skin(): WorldSkin {
		return this.provider.skin;
	}

	get signs(): readonly SignEntry[] {
		return this.layerManifest.signs;
	}

	ringPaths(clusterId: string): WorldPath[] {
		return ringPathsFor(this.manifest, clusterId, this.layer);
	}

	/** Once every ring is laid out: where layer paths leave base clusters. */
	computeRoutes(ring: (clusterId: string) => RingGeometry | undefined): void {
		this.routes = layerPathRoutes(this.manifest, this.layer, ring);
	}

	polyline(path: WorldPath, from: Cluster, to: Cluster): Position[] {
		return this.routes.get(worldPathId(path)) ?? [from.pos, to.pos];
	}

	isLayerPath(path: WorldPath): boolean {
		return this.layer.pathIds.has(worldPathId(path));
	}

	isLayerPortal(portalId: string): boolean {
		return this.layer.portalIds.has(portalId);
	}

	/** The layer's current copy of one of its portals (fresh after a save). */
	portal(portalId: string): Portal | undefined {
		return this.layerManifest.portals.find((p) => p.id === portalId);
	}

	// --- The layer's own save slot ---------------------------------------
	// Visits and defeats of layer ids go here, never into the world's slot;
	// the slot never holds file content (its fileOverrides stay empty).

	openSlot(worldId: string): void {
		this.slot = loadSave(layerSaveSlotId(worldId, this.provider.id));
	}

	visitedClusters(): string[] {
		return this.slot?.visitedClusters ?? [];
	}

	defeatedMonsters(): string[] {
		return this.slot?.defeatedMonsterIds ?? [];
	}

	/** True when this id belongs to the layer (and was recorded in its slot). */
	recordVisit(clusterId: string): boolean {
		if (!this.layer.clusterIds.has(clusterId)) return false;
		if (this.slot && !this.slot.visitedClusters.includes(clusterId)) {
			this.slot = withVisitedCluster(this.slot, clusterId);
			persistSave(this.slot);
		}
		return true;
	}

	recordDefeat(monsterId: string): boolean {
		if (!this.layer.monsterIds.has(monsterId)) return false;
		if (this.slot && !this.slot.defeatedMonsterIds.includes(monsterId)) {
			this.slot = withDefeatedMonster(this.slot, monsterId);
			persistSave(this.slot);
		}
		return true;
	}

	savedPosition(): Position | undefined {
		return this.slot?.playerPositions.world;
	}

	recordPosition(pos: Position): void {
		if (!this.slot) return;
		this.slot = withPlayerPosition(this.slot, "world", pos);
		persistSave(this.slot);
	}

	resetSlot(): void {
		if (!this.slot) return;
		this.slot = {
			...this.slot,
			visitedClusters: [],
			defeatedMonsterIds: [],
			playerPositions: {},
		};
		persistSave(this.slot);
	}

	// --- Files -----------------------------------------------------------

	fetchChunkFiles(clusterId: string): Promise<Record<string, string>> {
		return this.provider.fetchChunk(clusterId).then((chunk) => {
			const files: Record<string, string> = {};
			for (const [path, file] of Object.entries(chunk.files))
				files[path] = file.content;
			return files;
		});
	}

	/** Writes one layer file through the provider. On success the manifest is refetched (the host rebuilt the layer), so the next save names the new hash. */
	async saveFile(
		path: string,
		content: string,
	): Promise<{ ok: true } | { ok: false; conflict: boolean; message: string }> {
		const baseSha256 = this.layerManifest.textSha256[path];
		if (!baseSha256)
			return {
				ok: false,
				conflict: false,
				message: `${path} can't be saved here: it isn't a text file this layer can write.`,
			};
		const result = await this.provider.saveFile(path, content, baseSha256);
		if (!result.ok) return result;
		this.layerManifest = {
			...this.layerManifest,
			textSha256: { ...this.layerManifest.textSha256, [path]: result.sha256 },
		};
		await this.refreshManifest();
		return { ok: true };
	}

	/** The layer as its host has it now; keeps the current one if that fails. */
	async refreshManifest(): Promise<WorldLayerManifest> {
		try {
			this.layerManifest = await this.provider.load();
		} catch (err) {
			console.warn("cabn: could not refresh the world layer", err);
		}
		return this.layerManifest;
	}

	// --- Rise and sink -----------------------------------------------------

	/**
	 * Picks the layer's objects out of everything created since `before`:
	 * whatever stands inside a layer clearing (clearings never overlap the
	 * base's), plus the objects the scene names outright (the layer's path
	 * ribbon). Screen-locked layers (scroll factor 0) are never the layer's.
	 */
	collect(
		scene: Phaser.Scene,
		before: ReadonlySet<Phaser.GameObjects.GameObject>,
		clearings: readonly LayerClearing[],
		extra: readonly Phaser.GameObjects.GameObject[],
	): void {
		const picked = new Set(extra);
		for (const object of scene.children.list) {
			if (before.has(object) || picked.has(object)) continue;
			const o = object as Phaser.GameObjects.GameObject & {
				x?: number;
				y?: number;
				scrollFactorX?: number;
				depth?: number;
			};
			if (typeof o.x !== "number" || typeof o.y !== "number") continue;
			if (o.scrollFactorX === 0 || (o.depth ?? 0) <= 0) continue;
			if (inLayerClearing({ x: o.x, y: o.y }, clearings)) picked.add(object);
		}
		this.risers = [...picked];
	}

	/** Raises the layer's objects out of the ground with a dust burst; instant under reduced motion. */
	rise(
		scene: Phaser.Scene,
		durationMs: number,
		dustAt: readonly Position[],
	): void {
		for (const object of this.risers) {
			const o = object as unknown as { y: number; alpha: number };
			this.restY.set(object, o.y);
			this.restAlpha.set(object, o.alpha);
		}
		if (durationMs <= 0) return;
		for (const object of this.risers) {
			const o = object as unknown as { y: number; alpha: number };
			const alphaOnly = this.alphaOnly(object);
			const restY = this.restY.get(object) ?? o.y;
			const restAlpha = this.restAlpha.get(object) ?? 1;
			if (!alphaOnly) o.y = restY + RISE_PX;
			o.alpha = 0;
			scene.tweens.add({
				targets: object,
				alpha: restAlpha,
				...(alphaOnly ? {} : { y: restY }),
				duration: durationMs,
				ease: "Cubic.easeOut",
			});
		}
		this.dust(scene, dustAt);
	}

	/** The reverse of rise(); `done` runs once everything is back underground. */
	sink(
		scene: Phaser.Scene,
		durationMs: number,
		dustAt: readonly Position[],
		done: () => void,
	): void {
		if (durationMs <= 0 || this.risers.length === 0) {
			done();
			return;
		}
		for (const object of this.risers) {
			const o = object as unknown as { y: number };
			scene.tweens.killTweensOf(object);
			scene.tweens.add({
				targets: object,
				alpha: 0,
				...(this.alphaOnly(object)
					? {}
					: { y: (this.restY.get(object) ?? o.y) + RISE_PX }),
				duration: durationMs,
				ease: "Cubic.easeIn",
			});
		}
		this.dust(scene, dustAt);
		scene.time.delayedCall(durationMs, done);
	}

	private alphaOnly(object: Phaser.GameObjects.GameObject): boolean {
		return (
			object instanceof Phaser.GameObjects.RenderTexture ||
			object instanceof Phaser.GameObjects.Graphics
		);
	}

	private dust(scene: Phaser.Scene, points: readonly Position[]): void {
		const color = this.skin.particles?.dust ?? DEFAULT_PARTICLES.dust;
		for (const point of points) {
			const emitter = scene.add.particles(point.x, point.y, FX_SPARK_KEY, {
				speed: { min: 20, max: 70 },
				angle: { min: 200, max: 340 },
				lifespan: { min: 450, max: 800 },
				scale: { start: 0.7, end: 0 },
				alpha: { start: 0.8, end: 0 },
				tint: color,
				emitting: false,
			});
			emitter.setDepth(4.9);
			emitter.explode(DUST_PARTICLES);
			scene.time.delayedCall(900, () => emitter.destroy());
		}
	}
}
