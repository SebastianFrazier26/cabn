import type {
	Cluster,
	Monster,
	Portal,
	Position,
	WorldChunk,
	WorldManifest,
} from "@cabn/world-schema";
import { WorldChunkSchema } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	ASSET_KEYS,
	biomeTileSheetKey,
	OPTIONAL_ASSET_KEYS,
	PORTAL_ARCH_FRAME_SIZE,
	WORLD_CABINET_KEY,
} from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { attachTimeOfDayGlow } from "../fx/GlowPipeline.js";
import { PALETTE, toCssColor } from "../palette.js";
import { dashedLine } from "../render/dashedLine.js";
import { attachLanternFlicker, attachWorldEffects } from "../render/effects.js";
import { bakeClusterGround } from "../render/groundBaker.js";
import { bakeGroundField } from "../render/groundField.js";
import {
	attachLightPools,
	type LightPoolOptions,
} from "../render/lightPools.js";
import { addHoverBob, createMonsterSprite } from "../render/monsterSprite.js";
import { bakePaths, type PathSegment } from "../render/pathBaker.js";
import { stampPointsAlongSegment } from "../render/pathStamps.js";
import {
	createMovementKeys,
	createPlayer,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
	updatePlayerMovement,
} from "../render/playerController.js";
import {
	type PlacedProp,
	placeProps,
	propLightWorldPos,
	propSmokeWorldPos,
} from "../render/propPlacement.js";
import {
	BONFIRE_RAW_SIZE_PX,
	BONFIRE_SCALE,
	CABINET_SCALE,
	MONSTER_HOVER_SIZE,
	PORTAL_SCALE,
} from "../render/scale.js";
import { touchChunk } from "../systems/chunkCache.js";
import { prefersReducedMotion } from "../systems/glowSettings.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import { clampPreviewLines } from "../systems/previewText.js";
import {
	applyOverridesToChunk,
	clearSave,
	computeWorldId,
	emptySaveData,
	loadSave,
	persistSave,
	previewSourceLines,
	type SaveData,
	withBagSlots,
	withDefeatedMonster,
	withFileOverride,
	withoutFileOverride,
	withPlayerPosition,
	withVisitedCluster,
} from "../systems/save.js";
import type { ScatterExclusion } from "../systems/scatter.js";
import { cabinTransitionDelayMs } from "../systems/sceneTransition.js";
import { subtleTint, type Theme, themeFromSeed } from "../systems/theme.js";
import {
	type AssetAvailability,
	BONFIRE_IDLE_ANIM,
	PORTAL_IDLE_ANIM,
} from "./PreloadScene.js";

export interface WorldSceneData {
	manifest: WorldManifest;
	worldBase: string;
	availability: AssetAvailability;
	/** Set when this world was entered from the shelf — lets Escape at spawn go back. */
	returnTo?: { shelfUrl: string };
}

const CLUSTER_LOAD_RADIUS = 260;
const PORTAL_APPROACH_RADIUS = 80;
const PORTAL_ENTER_RADIUS = 46;
const RETURN_TO_SHELF_RADIUS = 140;
const MAX_LOADED_CHUNKS = 8;
const WORLD_MARGIN = 500;
const PREVIEW_LINE_CHARS = 26;
const PREVIEW_MAX_LINES = 7;

// The arch opening isn't the sprite's full bounding box — these are eyeballed
// fractions of the portal sprite's display size, not measured from the
// source PNG's alpha channel, so treat them as "close enough for gameplay",
// not exact stone geometry.
const ARCH_OPENING_WIDTH_RATIO = 0.5;
const ARCH_OPENING_HEIGHT_RATIO = 0.4;
const ARCH_OPENING_Y_OFFSET_RATIO = -0.08;
const PORTAL_ARCH_DISPLAY_SIZE = PORTAL_ARCH_FRAME_SIZE * PORTAL_SCALE;

// M10b batch 3: the old radius formula (90 + min(count,40)*4, capping out at
// 250px for a 40-portal cluster) put arches 39px apart at that cap — well
// under PORTAL_ARCH_DISPLAY_SIZE (96px) itself, so a busy cluster's arches
// visibly overlapped ("packs file arches tightly around the bonfire",
// batch-3 review). This derives the ring radius from the actual spacing
// needed instead: circumference / count must be at least ARCH_RING_SPACING.
// Mirrored (deliberately duplicated, not shared) in
// packages/converter/src/layout.ts's estimatedClearingRadius(), which needs
// the same shape to keep whole *clusters* from crowding each other — see
// that file's own comment on why it's a duplication, not an import.
const ARCH_RING_SPACING = PORTAL_ARCH_DISPLAY_SIZE * 1.2;
const PORTAL_RING_MIN_RADIUS = 100;
/** Room beyond the outermost portal ring for the prop-framing annulus + the flower-ring edge marking — this is what actually grows a clearing to fit its own content, rather than a flat per-file increment. */
const CLEARING_OUTER_MARGIN = 90;

function portalRingRadius(portalCount: number): number {
	if (portalCount <= 1) return PORTAL_RING_MIN_RADIUS;
	return Math.max(
		PORTAL_RING_MIN_RADIUS,
		(portalCount * ARCH_RING_SPACING) / (Math.PI * 2),
	);
}

/** Ground radius scales with the portal ring it has to contain, so busier clusters get a clearing that actually fits their arches instead of just reading as "bigger" arbitrarily. */
function groundRadius(cluster: Cluster): number {
	return portalRingRadius(cluster.portalIds.length) + CLEARING_OUTER_MARGIN;
}

// Matches the old fillEllipse(radius*2, radius*1.3) aspect ratio (Phaser's
// fillEllipse takes full width/height, so radiusY was always 0.65 * radiusX)
// — kept so the tiled ground reads the same footprint the ellipse did.
const GROUND_RADIUS_Y_RATIO = 0.65;
const DECALS_PER_CLUSTER = 14;
const PROPS_PER_CLUSTER = 4;
/** How far into the clearing's outer annulus props are confined (see systems/scatter.ts's minRadiusFrac) — "frame the edges/corners", not scatter anywhere between the plaza and the boundary. */
const PROP_ANNULUS_INNER_FRAC = 0.68;
/** How much of the per-world theme tint reaches the world-cabinet sprite (see systems/theme.ts's subtleTint) — low enough that the wood still reads as wood, not full-strength-tint noise. */
const CABINET_TINT_STRENGTH = 0.35;
// 58 = PORTAL_ARCH_DISPLAY_SIZE (96) / 2 + a 10px margin — batch 1 excluded
// only 44px around a portal, less than the arch's own half-width, so a prop
// could still land partway inside the sprite (the "arches and props overlap"
// bug flagged in review).
const PORTAL_EXCLUSION_RADIUS = 58;
const SPAWN_EXCLUSION_RADIUS = 56;
// Batch 1 never excluded the cluster center itself — cabinet/bonfire always
// sit exactly there, so a prop or decal could land directly on top of one.
const CLUSTER_CENTER_EXCLUSION_RADIUS = 60;
const PATH_CORRIDOR_EXCLUSION_RADIUS = 26;
const PATH_CORRIDOR_SAMPLE_SPACING = 40;
/** Fixed, not per-world — the field's own texture variety already comes from tile position, not from needing a different seed per world. */
const FIELD_SEED = 20260928;
/** Same reasoning as ShelfScene's TOWER_SPAWN_CLEARANCE — clear space between the player's physics body and the bonfire's edge. */
const BONFIRE_SPAWN_CLEARANCE = 24;
/** Subtle per-world identity tint over the tiled ground — a low-alpha overlay rather than Phaser's multiplicative sprite tint, which would recolor the tile art itself instead of just washing over it. */
const GROUND_THEME_TINT_ALPHA = 0.12;

export class WorldScene extends Phaser.Scene {
	private manifest!: WorldManifest;
	private worldBase = "";
	private availability!: AssetAvailability;
	private returnTo: { shelfUrl: string } | undefined;
	/** Set the instant a return-to-shelf is confirmed, guarding the transition-hold window (see handleReturnToShelf) against a second Esc press re-triggering scene.start before the first one fires. */
	private returningToShelf = false;
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private clustersById = new Map<string, Cluster>();
	private portalsById = new Map<string, Portal>();
	private portalWorldPos = new Map<string, Position>();
	private portalSprites = new Map<string, Phaser.GameObjects.Sprite>();
	private portalPathById = new Map<string, string>();
	private worldFiles = new Set<string>();

	private monstersById = new Map<string, Monster>();
	private portalMonsterIds = new Map<string, string[]>();
	private monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
	private monsterBobTweens = new Map<string, Phaser.Tweens.Tween>();

	/** clusterId -> path -> file content, exactly as fetched — never mutated, so a "reset this file" always has the pristine original to fall back to. */
	private chunkContents = new Map<string, Record<string, string>>();
	/** Same shape, with `save.fileOverrides` spliced in — what portal entry/exit and the arch preview actually read from; recomputed via refreshEffectiveChunk() whenever a chunk (re)loads or an override changes. */
	private effectiveChunkContents = new Map<string, Record<string, string>>();
	private chunkLoadOrder: string[] = [];
	private chunkFetchesInFlight = new Set<string>();

	private worldId = "";
	private save: SaveData = emptySaveData("");
	private editedMarkers = new Map<string, Phaser.GameObjects.Text>();
	/** Every prop drawGround() scattered, across every cluster — setupAmbientEffects() reads this afterward to find light-emitting props (cottage windows, lamp posts) without drawGround needing to know anything about lighting itself. */
	private placedProps: PlacedProp[] = [];
	private ambientEffects: { destroy(): void } | null = null;
	private ambientLights: { destroy(): void } | null = null;
	private unsubscribeBagSlots: (() => void) | null = null;
	private unsubscribeGlow: (() => void) | null = null;
	private unsubscribeAmbientTimeOfDay: (() => void) | null = null;

	private player!: PlayerHandle;
	private movementKeys!: MovementKeys;
	private playerTextures!: PlayerTextures;

	private keys!: {
		enter: Phaser.Input.Keyboard.Key;
		e: Phaser.Input.Keyboard.Key;
		esc: Phaser.Input.Keyboard.Key;
	};

	private previewPanel!: Phaser.GameObjects.Container;
	private previewText!: Phaser.GameObjects.Text;
	private previewMaskShape!: Phaser.GameObjects.Graphics;
	private portalsInRange = new Set<string>();

	/** One theme per world (see drawClusters' doc comment) — computed once in create() so drawGround's ground-tint overlay and drawClusters' cabinet/bonfire tint always agree. */
	private theme!: Theme;

	/** Non-null while a tool-triggered auto-walk (spyglass/orb result click) is in flight — suppresses WASD so it doesn't fight the tween. */
	private autoWalkTween: Phaser.Tweens.Tween | null = null;

	constructor() {
		super({ key: "world", active: false });
	}

	init(data: WorldSceneData): void {
		this.manifest = data.manifest;
		this.worldBase = data.worldBase;
		this.availability = data.availability;
		this.returnTo = data.returnTo;
		this.store = this.registry.get("store");
		this.bus = this.registry.get("bus");
	}

	create(): void {
		for (const cluster of this.manifest.clusters)
			this.clustersById.set(cluster.id, cluster);
		for (const portal of this.manifest.portals) {
			this.portalsById.set(portal.id, portal);
			this.portalPathById.set(portal.id, portal.file.path);
			this.worldFiles.add(portal.file.path);
		}
		for (const monster of this.manifest.monsters) {
			this.monstersById.set(monster.id, monster);
			if (monster.portalId) {
				const list = this.portalMonsterIds.get(monster.portalId) ?? [];
				list.push(monster.id);
				this.portalMonsterIds.set(monster.portalId, list);
			}
		}

		this.worldId = computeWorldId(this.manifest.meta);
		this.save = loadSave(this.worldId);
		this.theme = themeFromSeed(this.manifest.meta.themeSeed ?? 0);

		// Portal positions and the player spawn point both have to exist before
		// drawGround() runs — its decal/prop scatter must exclude them — so
		// they're computed (not yet rendered) ahead of everything else.
		this.computePortalPositions();
		const spawn = this.resolveSpawnPos();

		this.drawGround(spawn);
		this.drawPaths();
		this.drawClusters();
		this.drawPortals();
		this.drawEditedMarkers();
		this.drawMonsters();
		this.createPlayer(spawn);
		this.createArchPreview();
		this.setupInput();
		this.setupCamera();
		this.publishPortalIndex();
		this.publishMonsterIndex();
		this.setupToolBusListeners();
		this.setupSaveListeners();
		this.unsubscribeGlow = attachTimeOfDayGlow(this, this.store);
		this.setupAmbientEffects();
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.unsubscribeGlow?.();
			this.unsubscribeGlow = null;
			this.unsubscribeAmbientTimeOfDay?.();
			this.unsubscribeAmbientTimeOfDay = null;
			this.ambientEffects?.destroy();
			this.ambientEffects = null;
			this.ambientLights?.destroy();
			this.ambientLights = null;
		});
	}

	/** Fireflies/motes/embers/smoke (fx/effects.ts) plus the lamp-post/cottage-window flicker — re-created (not just re-tinted) whenever timeOfDay changes, since fireflies-vs-motes is a swap, not a param tweak. */
	private setupAmbientEffects(): void {
		const reducedMotion = prefersReducedMotion();
		const root =
			this.manifest.clusters.find((c) => c.path === ".") ??
			this.manifest.clusters[0];
		const chimneyPositions = this.placedProps
			.map(propSmokeWorldPos)
			.filter((pos): pos is { x: number; y: number } => pos !== null);
		for (const prop of this.placedProps) {
			if (prop.name === "lamp-post" || prop.name === "cottage") {
				attachLanternFlicker(this, prop.sprite, reducedMotion);
			}
		}

		// M10b batch-3 review: night lighting read as "mostly whole-frame
		// darkening" — real light pools at every lit prop plus a bigger,
		// flickering one at the bonfire, night-only (rebuilt whenever
		// timeOfDay flips, same as the fireflies/motes swap below).
		const propLights: LightPoolOptions[] = this.placedProps.flatMap((prop) => {
			const pos = propLightWorldPos(prop);
			if (!pos) return [];
			return [
				{
					x: pos.x,
					y: pos.y,
					radiusPx: 38,
					color: PALETTE.gold,
					alpha: 0.6,
					flicker: true,
				},
			];
		});

		const rebuild = (): void => {
			this.ambientEffects?.destroy();
			this.ambientLights?.destroy();
			const timeOfDay = this.store.getState().timeOfDay;
			this.ambientEffects = attachWorldEffects(this, {
				bounds: this.computeWorldBounds(),
				timeOfDay,
				bonfirePos: root?.pos,
				chimneyPositions,
				reducedMotion,
			});
			this.ambientLights =
				timeOfDay === "night"
					? attachLightPools(this, [
							...propLights,
							...(root
								? [
										{
											x: root.pos.x,
											y: root.pos.y,
											radiusPx: 90,
											color: PALETTE.gold,
											alpha: 0.65,
											flicker: true,
										},
									]
								: []),
						])
					: null;
		};
		rebuild();
		this.unsubscribeAmbientTimeOfDay = this.store.subscribe((state, prev) => {
			if (state.timeOfDay !== prev.timeOfDay) rebuild();
		});
	}

	// The spyglass panel and the orb's world-search results both read this off
	// the store rather than holding their own copy of the manifest — React
	// only ever gets game state through {store, bus}, never a manifest prop.
	private publishPortalIndex(): void {
		this.store.getState().setActiveWorldBase(this.worldBase);
		this.store.getState().setPortals(
			this.manifest.portals.map((portal) => ({
				id: portal.id,
				clusterId: portal.clusterId,
				name: portal.file.name,
				path: portal.file.path,
				kind: portal.file.kind,
				bytes: portal.file.bytes,
				previewLine:
					previewSourceLines(
						portal.id,
						portal.preview.lines,
						this.save.fileOverrides,
					)[0] ?? "",
				edited: portal.id in this.save.fileOverrides,
			})),
		);
	}

	// mitt's on/off take no context argument (unlike Phaser's own EventEmitter,
	// used for the SHUTDOWN hook right below) — both listeners are arrow class
	// fields specifically so `this` is already bound and the same function
	// reference can be handed to both on() and off().
	private setupToolBusListeners(): void {
		this.bus.on("tool:opener-use", this.enterNearestPortalInRange);
		this.bus.on("tool:walk-to-portal", this.onWalkToPortal);
		this.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.teardownToolBusListeners,
			this,
		);
	}

	private teardownToolBusListeners(): void {
		this.bus.off("tool:opener-use", this.enterNearestPortalInRange);
		this.bus.off("tool:walk-to-portal", this.onWalkToPortal);
	}

	private onWalkToPortal = ({ portalId }: { portalId: string }): void => {
		const target = this.portalWorldPos.get(portalId);
		if (!target) return;

		this.autoWalkTween?.stop();
		const from = { x: this.player.body.x, y: this.player.body.y };
		const dist = Phaser.Math.Distance.Between(
			from.x,
			from.y,
			target.x,
			target.y,
		);
		const speed = 320; // px/s, faster than WASD walk speed — a summoned walk should read as brisk, not a full retrace
		this.autoWalkTween = this.tweens.add({
			targets: this.player.body,
			x: target.x,
			y: target.y,
			duration: Math.max(dist / speed, 0.1) * 1000,
			ease: "Sine.easeInOut",
			onComplete: () => {
				this.autoWalkTween = null;
			},
		});
	};

	/** manifest.paths touching this cluster, sampled near this cluster's own ground so decals/props never land on the dirt track leading out of it — reuses stampPointsAlongSegment purely as a "points along a line" sampler, nothing drawn here. */
	private pathExclusionsForCluster(cluster: Cluster): ScatterExclusion[] {
		const exclusions: ScatterExclusion[] = [];
		const radius = groundRadius(cluster) + PATH_CORRIDOR_EXCLUSION_RADIUS;
		for (const path of this.manifest.paths) {
			if (path.from !== cluster.id && path.to !== cluster.id) continue;
			const otherId = path.from === cluster.id ? path.to : path.from;
			const other = this.clustersById.get(otherId);
			if (!other) continue;
			for (const point of stampPointsAlongSegment(
				cluster.pos,
				other.pos,
				PATH_CORRIDOR_SAMPLE_SPACING,
			)) {
				if (
					Phaser.Math.Distance.Between(
						point.x,
						point.y,
						cluster.pos.x,
						cluster.pos.y,
					) <= radius
				) {
					exclusions.push({
						x: point.x,
						y: point.y,
						radius: PATH_CORRIDOR_EXCLUSION_RADIUS,
					});
				}
			}
		}
		return exclusions;
	}

	private clusterExclusions(
		cluster: Cluster,
		spawn: Position,
	): ScatterExclusion[] {
		const exclusions = this.pathExclusionsForCluster(cluster);
		exclusions.push({
			x: cluster.pos.x,
			y: cluster.pos.y,
			radius: CLUSTER_CENTER_EXCLUSION_RADIUS,
		});
		for (const portalId of cluster.portalIds) {
			const pos = this.portalWorldPos.get(portalId);
			if (pos)
				exclusions.push({
					x: pos.x,
					y: pos.y,
					radius: PORTAL_EXCLUSION_RADIUS,
				});
		}
		if (
			Phaser.Math.Distance.Between(
				spawn.x,
				spawn.y,
				cluster.pos.x,
				cluster.pos.y,
			) <=
			groundRadius(cluster) + SPAWN_EXCLUSION_RADIUS
		) {
			exclusions.push({
				x: spawn.x,
				y: spawn.y,
				radius: SPAWN_EXCLUSION_RADIUS,
			});
		}
		return exclusions;
	}

	/**
	 * One continuous grass field across the whole world (`groundField.ts`,
	 * chunked), with clusters marked as clearings on top of it — a subtle
	 * biome-tinted patch, a ring of flowers at its edge, and scattered decals
	 * — rather than batch 1's isolated per-cluster ellipses floating over an
	 * empty background. Falls back to the old tinted-ellipse-only fill (no
	 * field at all) when the batch-1/2 art didn't load — never a half-tiled
	 * scene. Props (trees, fences, etc.) are placed here too since they share
	 * the same per-cluster exclusion zones, even though they render as their
	 * own sprites rather than being baked (see propPlacement.ts's doc comment).
	 */
	private drawGround(spawn: Position): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(0);
			for (const cluster of this.manifest.clusters) {
				g.fillStyle(PALETTE.biome[cluster.biome], 0.35);
				g.fillEllipse(
					cluster.pos.x,
					cluster.pos.y,
					groundRadius(cluster) * 2,
					groundRadius(cluster) * 1.3,
				);
			}
			return;
		}

		for (const field of bakeGroundField(
			this,
			this.computeWorldBounds(),
			biomeTileSheetKey("meadow"),
			FIELD_SEED,
		)) {
			field.setDepth(0);
		}

		const tintOverlay = this.add.graphics().setDepth(0.6);
		for (const cluster of this.manifest.clusters) {
			const radiusX = groundRadius(cluster);
			const radiusY = radiusX * GROUND_RADIUS_Y_RATIO;
			const exclusions = this.clusterExclusions(cluster, spawn);

			bakeClusterGround({
				scene: this,
				clusterId: cluster.id,
				biomeSheetKey: biomeTileSheetKey(cluster.biome),
				centerX: cluster.pos.x,
				centerY: cluster.pos.y,
				radiusX,
				radiusY,
				exclusions,
				decalCount: DECALS_PER_CLUSTER,
				ringFlowerCount: Math.max(6, Math.round(radiusX / 22)),
				seed: 20260928,
			}).setDepth(0.5);

			tintOverlay.fillStyle(this.theme.tint, GROUND_THEME_TINT_ALPHA);
			tintOverlay.fillEllipse(
				cluster.pos.x,
				cluster.pos.y,
				radiusX * 2,
				radiusY * 2,
			);

			this.placedProps.push(
				...placeProps({
					scene: this,
					clusterId: cluster.id,
					centerX: cluster.pos.x,
					centerY: cluster.pos.y,
					radiusX,
					radiusY,
					exclusions,
					count: PROPS_PER_CLUSTER,
					depth: 2,
					minRadiusFrac: PROP_ANNULUS_INNER_FRAC,
				}),
			);
		}
	}

	private drawPaths(): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(1);
			g.lineStyle(2, PALETTE.trail, 0.8);
			for (const path of this.manifest.paths) {
				const from = this.clustersById.get(path.from);
				const to = this.clustersById.get(path.to);
				if (!from || !to) continue; // schema guarantees this in a valid manifest; guard keeps a corrupt bundle from crashing the scene
				dashedLine(g, from.pos, to.pos);
			}
			return;
		}

		const segments: PathSegment[] = [];
		for (const path of this.manifest.paths) {
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) continue;
			segments.push({
				id: `${path.from}::${path.to}`,
				from: from.pos,
				to: to.pos,
			});
		}
		if (segments.length === 0) return;

		// Same bounds as the ground field/camera (computeWorldBounds), not a
		// tighter box hugging just the path endpoints — a mismatch there used
		// to leave the path's own bake canvas clipping a stamp right at its edge.
		bakePaths(this, this.computeWorldBounds(), segments).setDepth(1);
	}

	// Same seed for every cabinet in this world (this.theme, set once in
	// create()) — a world is one converted project, so it gets one theme, not
	// one per cluster.
	private drawClusters(): void {
		for (const cluster of this.manifest.clusters) {
			const isRoot = cluster.path === ".";
			let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

			if (isRoot) {
				sprite = this.drawBonfire(cluster.pos);
			} else if (this.availability.worldArt) {
				// world-cabinet is already sized/detailed to stand alone
				// unscaled (same convention as every other prop —
				// propPlacement.ts never calls setScale either) — CABINET_SCALE
				// below is only for the photographic fallback's much bigger
				// source resolution. Tint is deliberately lightened toward
				// white first (subtleTint) rather than applied at full
				// strength — M10b batch-3 review: "stays subtle".
				sprite = this.add.image(
					cluster.pos.x,
					cluster.pos.y,
					WORLD_CABINET_KEY,
				);
				sprite
					.setTint(subtleTint(this.theme.tint, CABINET_TINT_STRENGTH))
					.setDepth(2);
			} else {
				sprite = this.add.image(
					cluster.pos.x,
					cluster.pos.y,
					ASSET_KEYS.cabinet,
				);
				sprite.setScale(CABINET_SCALE).setTint(this.theme.tint).setDepth(2);
			}

			this.add
				.text(
					cluster.pos.x,
					cluster.pos.y + sprite.displayHeight / 2 + 6,
					cluster.label,
					{
						fontFamily: '"Courier New", monospace',
						fontSize: "14px",
						fontStyle: "bold",
						color: toCssColor(PALETTE.cream),
						stroke: toCssColor(PALETTE.ink),
						strokeThickness: 3,
					},
				)
				.setOrigin(0.5, 0)
				.setDepth(2);
		}
	}

	// World spawn is a bonfire, not a cabin (M4 world-hierarchy redesign — a
	// cabin now represents a whole *world* on the shelf, never a place inside
	// one). Falls back to a tinted, static first frame of the portal arch
	// spritesheet when the real bonfire art hasn't landed yet.
	private drawBonfire(pos: Position): Phaser.GameObjects.Sprite {
		if (this.availability.bonfire) {
			const sprite = this.add.sprite(
				pos.x,
				pos.y,
				OPTIONAL_ASSET_KEYS.bonfireFrame(0),
			);
			sprite.setScale(BONFIRE_SCALE).setDepth(2);
			sprite.play(BONFIRE_IDLE_ANIM);
			return sprite;
		}
		const sprite = this.add.sprite(pos.x, pos.y, ASSET_KEYS.portalArchStrip, 0);
		sprite.setScale(BONFIRE_SCALE).setTint(PALETTE.gold).setDepth(2);
		return sprite;
	}

	/** Fills portalWorldPos without creating any sprites — drawGround()'s scatter exclusions need real portal positions before drawPortals() itself runs (see create()'s ordering comment). */
	private computePortalPositions(): void {
		for (const cluster of this.manifest.clusters) {
			const count = cluster.portalIds.length;
			const radius = portalRingRadius(count);
			cluster.portalIds.forEach((portalId, index) => {
				const angle =
					(Phaser.Math.PI2 * index) / Math.max(count, 1) - Math.PI / 2;
				this.portalWorldPos.set(portalId, {
					x: cluster.pos.x + Math.cos(angle) * radius,
					y: cluster.pos.y + Math.sin(angle) * radius,
				});
			});
		}
	}

	private drawPortals(): void {
		for (const cluster of this.manifest.clusters) {
			cluster.portalIds.forEach((portalId) => {
				const pos = this.portalWorldPos.get(portalId);
				if (!pos) return; // computePortalPositions() populates every id from this same manifest — defensive only

				const sprite = this.add.sprite(
					pos.x,
					pos.y,
					ASSET_KEYS.portalArchStrip,
				);
				sprite.setScale(PORTAL_SCALE).setDepth(3);
				sprite.play(PORTAL_IDLE_ANIM);
				this.portalSprites.set(portalId, sprite);
			});
		}
	}

	private drawEditedMarkers(): void {
		for (const portalId of Object.keys(this.save.fileOverrides)) {
			this.drawEditedMarker(portalId);
		}
	}

	// A drawn glyph rather than new art (no quill/sparkle sprite exists yet,
	// same placeholder-first approach as the tool icons) — a small pencil
	// character at the arch's upper-right reads fine at this scale.
	private drawEditedMarker(portalId: string): void {
		if (this.editedMarkers.has(portalId)) return;
		const pos = this.portalWorldPos.get(portalId);
		if (!pos) return;
		const offset = PORTAL_ARCH_DISPLAY_SIZE * 0.22;
		const marker = this.add
			.text(pos.x + offset, pos.y - offset, "✎", {
				fontFamily: '"Courier New", monospace',
				fontSize: "16px",
				color: toCssColor(PALETTE.gold),
			})
			.setOrigin(0.5)
			.setDepth(5);
		this.editedMarkers.set(portalId, marker);
	}

	private removeEditedMarker(portalId: string): void {
		this.editedMarkers.get(portalId)?.destroy();
		this.editedMarkers.delete(portalId);
	}

	// A monster hovers near its portal's arch (fanned apart if a file has more
	// than one) or, for a cross-cluster ouroboros, sits at the midpoint of the
	// WorldPath it's attached to — see run.ts's attachCycle for how that
	// pathId (`${from}::${to}`, parsed back out below) gets assigned. Neither
	// kind is walk-into-and-E encounterable here; only FileScene's
	// portal-attached monsters are (see FileScene's onMonsterEncounterKey doc
	// comment for why a world-space path monster doesn't fit that flow).
	private drawMonsters(): void {
		for (const monster of this.manifest.monsters) {
			if (this.save.defeatedMonsterIds.includes(monster.id)) continue;
			if (monster.portalId) this.drawPortalMonster(monster);
			else if (monster.pathId) this.drawPathMonster(monster);
		}
	}

	private drawPortalMonster(monster: Monster): void {
		const portalId = monster.portalId;
		if (!portalId) return;
		const pos = this.portalWorldPos.get(portalId);
		if (!pos) return;

		const siblings = this.portalMonsterIds.get(portalId) ?? [];
		const index = Math.max(siblings.indexOf(monster.id), 0);
		const angle = -Math.PI / 2 + index * 0.7;
		const radius = PORTAL_ARCH_DISPLAY_SIZE * 0.55;
		const x = pos.x + Math.cos(angle) * radius;
		const y =
			pos.y + Math.sin(angle) * radius - PORTAL_ARCH_DISPLAY_SIZE * 0.25;

		const sprite = createMonsterSprite(
			this,
			x,
			y,
			monster.species,
			MONSTER_HOVER_SIZE[monster.species] ?? 32,
		);
		sprite.setDepth(4);
		if (monster.species === "will-o-wisp") sprite.setAlpha(0.7); // wisps are cosmetic and meant to read as faint, not a real threat
		this.monsterSprites.set(monster.id, sprite);
		this.monsterBobTweens.set(monster.id, addHoverBob(this, sprite));
	}

	private drawPathMonster(monster: Monster): void {
		const pathId = monster.pathId;
		if (!pathId) return;
		const [fromId, toId] = pathId.split("::");
		const from = fromId ? this.clustersById.get(fromId) : undefined;
		const to = toId ? this.clustersById.get(toId) : undefined;
		if (!from || !to) return;

		const x = (from.pos.x + to.pos.x) / 2;
		const y = (from.pos.y + to.pos.y) / 2;
		const sprite = createMonsterSprite(
			this,
			x,
			y,
			monster.species,
			MONSTER_HOVER_SIZE[monster.species] ?? 48,
		);
		sprite.setDepth(4);
		this.monsterSprites.set(monster.id, sprite);
		this.monsterBobTweens.set(monster.id, addHoverBob(this, sprite, 6));
	}

	private removeMonsterSprite(monsterId: string): void {
		this.monsterBobTweens.get(monsterId)?.stop();
		this.monsterBobTweens.delete(monsterId);
		this.monsterSprites.get(monsterId)?.destroy();
		this.monsterSprites.delete(monsterId);
	}

	// The HUD counter and FileScene's encounter banner both read monsters off
	// the store rather than holding their own copy of the manifest, same
	// reasoning as publishPortalIndex above.
	private publishMonsterIndex(): void {
		this.store.getState().setMonsters(
			this.manifest.monsters.map((m) => ({
				id: m.id,
				species: m.species,
				message: m.error.message,
				tier: m.tier,
				...(m.portalId !== undefined ? { portalId: m.portalId } : {}),
				...(m.pathId !== undefined ? { pathId: m.pathId } : {}),
			})),
		);
		this.store.getState().setDefeatedMonsterIds(this.save.defeatedMonsterIds);
	}

	/**
	 * Pure computation of where the player starts — split out of
	 * createPlayer() so drawGround()'s scatter exclusions can use the same
	 * spawn point before any sprite exists (see create()'s ordering comment).
	 * A first-ever visit (no saved position) used to spawn exactly on the
	 * root cluster's own position — the bonfire's position too, since
	 * drawBonfire() draws it there — which is the M10b batch-2 review's
	 * "player spawns on top of the bonfire". Offset east of it instead, by
	 * its actual display size (computed from the same scale constants
	 * drawBonfire() uses, not read off a live sprite — the bonfire hasn't
	 * been drawn yet at this point in create()'s ordering).
	 */
	private resolveSpawnPos(): Position {
		const saved = this.save.playerPositions.world;
		if (saved) return saved;

		const root =
			this.manifest.clusters.find((c) => c.path === ".") ??
			this.manifest.clusters[0];
		if (!root) return { x: 0, y: 0 };
		const bonfireWidth = this.availability.bonfire
			? BONFIRE_RAW_SIZE_PX * BONFIRE_SCALE
			: PORTAL_ARCH_FRAME_SIZE * BONFIRE_SCALE;
		return {
			x: root.pos.x + bonfireWidth / 2 + BONFIRE_SPAWN_CLEARANCE,
			y: root.pos.y,
		};
	}

	private createPlayer(spawn: Position): void {
		this.playerTextures = {
			front: ASSET_KEYS.characterIdle,
			back: this.availability.characterBack
				? OPTIONAL_ASSET_KEYS.characterIdleBack
				: null,
		};
		this.player = createPlayer(this, spawn, this.playerTextures);
		this.store.getState().setPlayerPos(spawn);
	}

	// Renders the preview INSIDE the portal arch's opening (parchment backing,
	// masked to the interior) instead of a floating panel above the sprite —
	// only one instance is needed since only the closest in-range portal ever
	// shows a preview at a time (see handlePortalApproach).
	private createArchPreview(): void {
		const width = PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_WIDTH_RATIO;
		const height = PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_HEIGHT_RATIO;

		const bg = this.add.graphics();
		bg.fillStyle(PALETTE.parchment, 0.92);
		bg.fillRoundedRect(-width / 2, -height / 2, width, height, 4);

		this.previewText = this.add.text(-width / 2 + 4, -height / 2 + 3, "", {
			fontFamily: '"Courier New", monospace',
			fontSize: "7px",
			color: toCssColor(PALETTE.ink),
			wordWrap: { width: width - 8 },
		});

		this.previewPanel = this.add
			.container(0, 0, [bg, this.previewText])
			.setDepth(4);

		// A geometry mask's shape is positioned in world space independently of
		// the object it masks — this graphics object is never added to the
		// display list (this.make, not this.add), only used as mask geometry,
		// and must be re-positioned in lockstep with previewPanel every frame.
		this.previewMaskShape = this.make.graphics(undefined, false);
		this.previewMaskShape.fillStyle(0xffffff);
		this.previewMaskShape.fillRoundedRect(
			-width / 2,
			-height / 2,
			width,
			height,
			4,
		);
		this.previewPanel.setMask(this.previewMaskShape.createGeometryMask());

		this.previewPanel.setVisible(false).setAlpha(0);
	}

	private setupInput(): void {
		const kb = this.input.keyboard;
		if (!kb) throw new Error("WorldScene requires keyboard input");
		this.movementKeys = createMovementKeys(this);
		this.keys = {
			enter: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
			e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
			esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
		};
	}

	/** One shared bounds calc for the camera, the ground field bake, and the path bake — the three used to each compute a slightly different box, which is exactly how a field baked for one area and a camera clamped to another used to leave a sliver of void at the edge. */
	private computeWorldBounds(): {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	} {
		const xs = this.manifest.clusters.map((c) => c.pos.x);
		const ys = this.manifest.clusters.map((c) => c.pos.y);
		// A world with few clusters clustered near the origin (e.g. two
		// clusters directly north/south of each other) can have bounds
		// narrower than the actual browser viewport — the camera can't scroll
		// past its own bounds, so on a wide window that used to show the
		// M10b batch-2 continuous ground field ending in a hard black edge
		// mid-screen rather than reaching it. Margin grows with the viewport
		// (half its width/height + padding) so the field/camera bounds always
		// comfortably exceed whatever's actually on screen.
		const margin = Math.max(
			WORLD_MARGIN,
			this.scale.width / 2 + 150,
			this.scale.height / 2 + 150,
		);
		return {
			minX: Math.min(0, ...xs) - margin,
			maxX: Math.max(0, ...xs) + margin,
			minY: Math.min(0, ...ys) - margin,
			maxY: Math.max(0, ...ys) + margin,
		};
	}

	private setupCamera(): void {
		const { minX, minY, maxX, maxY } = this.computeWorldBounds();

		this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.1);
	}

	update(_time: number, delta: number): void {
		// Covers "file" and the new "editor" mode alike — both mean FileScene (or
		// its overlay) owns input right now, not just the one this scene used to
		// know about (in practice this scene is asleep whenever either is true,
		// via scene.switch, so this is defense-in-depth, not the load-bearing gate).
		if (this.store.getState().mode !== "world") {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			return;
		}

		this.handleMovement(delta);
		this.handleChunkLoading();
		this.handlePortalApproach();
		this.handlePortalEnter();
		this.handleReturnToShelf();
	}

	private handleMovement(delta: number): void {
		if (this.autoWalkTween) {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			this.store
				.getState()
				.setPlayerPos({ x: this.player.body.x, y: this.player.body.y });
			return;
		}
		const { pos } = updatePlayerMovement(
			this.player,
			this.movementKeys,
			delta,
			this.playerTextures,
		);
		this.store.getState().setPlayerPos(pos);
	}

	private nearestClusterInRange(): Cluster | null {
		const pos = { x: this.player.body.x, y: this.player.body.y };
		let best: { cluster: Cluster; dist: number } | null = null;
		for (const cluster of this.manifest.clusters) {
			const dist = Phaser.Math.Distance.Between(
				pos.x,
				pos.y,
				cluster.pos.x,
				cluster.pos.y,
			);
			if (dist <= CLUSTER_LOAD_RADIUS && (!best || dist < best.dist)) {
				best = { cluster, dist };
			}
		}
		return best?.cluster ?? null;
	}

	private handleChunkLoading(): void {
		const cluster = this.nearestClusterInRange();
		const state = this.store.getState();

		if (cluster && cluster.id !== state.activeClusterId) {
			state.setActiveCluster(cluster.id);
			this.bus.emit("cluster:enter", { clusterId: cluster.id });
		} else if (!cluster && state.activeClusterId !== null) {
			state.setActiveCluster(null);
		}

		if (
			cluster &&
			!this.chunkContents.has(cluster.id) &&
			!this.chunkFetchesInFlight.has(cluster.id)
		) {
			this.loadChunk(cluster);
		}
	}

	private loadChunk(cluster: Cluster): void {
		this.chunkFetchesInFlight.add(cluster.id);
		fetch(`${this.worldBase}${cluster.chunk}`)
			.then((res) => res.json())
			.then((raw) => {
				const chunk: WorldChunk = WorldChunkSchema.parse(raw);
				const files: Record<string, string> = {};
				for (const [path, file] of Object.entries(chunk.files)) {
					files[path] = file.content;
				}
				this.chunkContents.set(cluster.id, files);
				this.refreshEffectiveChunk(cluster.id);

				const { order, evicted } = touchChunk(
					this.chunkLoadOrder,
					cluster.id,
					MAX_LOADED_CHUNKS,
				);
				this.chunkLoadOrder = order;
				for (const evictedId of evicted) {
					this.chunkContents.delete(evictedId);
					this.effectiveChunkContents.delete(evictedId);
				}
				this.store.getState().setLoadedChunks(order);
				this.bus.emit("chunk:loaded", { clusterId: cluster.id });
			})
			.catch((err) => {
				console.error(
					`cabn: failed to load chunk for cluster "${cluster.id}"`,
					err,
				);
			})
			.finally(() => {
				this.chunkFetchesInFlight.delete(cluster.id);
			});
	}

	/** Recomputes `effectiveChunkContents` for one cluster from its pristine chunk plus the current save's overrides — called after a (re)load and whenever an override is saved/reset. No-op if the chunk isn't loaded yet (the next loadChunk() will pick up the then-current save). */
	private refreshEffectiveChunk(clusterId: string): void {
		const files = this.chunkContents.get(clusterId);
		if (!files) return;
		this.effectiveChunkContents.set(
			clusterId,
			applyOverridesToChunk(
				files,
				this.portalPathById,
				this.save.fileOverrides,
			),
		);
	}

	private handlePortalApproach(): void {
		const points: PortalPoint[] = [...this.portalWorldPos.entries()].map(
			([portalId, pos]) => ({ portalId, pos }),
		);
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		const { inRange, entered } = newlyApproached(
			points,
			playerPos,
			PORTAL_APPROACH_RADIUS,
			this.portalsInRange,
		);
		this.portalsInRange = inRange;

		for (const portalId of entered) {
			this.bus.emit("portal:approach", { portalId });
		}

		if (inRange.size === 0) {
			this.previewPanel.setVisible(false).setAlpha(0);
			return;
		}

		// Closest in-range portal wins the preview when more than one is close.
		let closestId: string | null = null;
		let closestDist = Number.POSITIVE_INFINITY;
		for (const portalId of inRange) {
			const pos = this.portalWorldPos.get(portalId);
			if (!pos) continue;
			const dist = Phaser.Math.Distance.Between(
				playerPos.x,
				playerPos.y,
				pos.x,
				pos.y,
			);
			if (dist < closestDist) {
				closestDist = dist;
				closestId = portalId;
			}
		}
		if (!closestId) return;

		const portal = this.portalsById.get(closestId);
		const pos = this.portalWorldPos.get(closestId);
		if (!portal || !pos) return;

		const clamped = clampPreviewLines(
			previewSourceLines(
				portal.id,
				portal.preview.lines,
				this.save.fileOverrides,
			),
			PREVIEW_LINE_CHARS,
			PREVIEW_MAX_LINES,
		);
		this.previewText.setText(
			clamped.lines.length > 0 ? clamped.lines.join("\n") : "(no preview)",
		);

		const archX = pos.x;
		const archY =
			pos.y + PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_Y_OFFSET_RATIO;
		this.previewPanel.setPosition(archX, archY);
		this.previewMaskShape.setPosition(archX, archY);

		// Fades in over the outer half of the approach radius rather than
		// snapping on, so it reads as "coming into focus inside the arch".
		const fade = Phaser.Math.Clamp(
			1 - closestDist / PORTAL_APPROACH_RADIUS,
			0,
			1,
		);
		this.previewPanel.setVisible(true).setAlpha(fade);
	}

	private handlePortalEnter(): void {
		const pressed =
			Phaser.Input.Keyboard.JustDown(this.keys.enter) ||
			Phaser.Input.Keyboard.JustDown(this.keys.e);
		if (!pressed) return;
		this.enterNearestPortalInRange();
	}

	// Shared by the direct E/Enter key check above (frame-polled, for input
	// latency) and the "tool:opener-use" bus listener (fired when the opener
	// tool is dispatched some other way, e.g. a hotbar click) — one path, two
	// triggers, see systems/tools.ts.
	private enterNearestPortalInRange = (): void => {
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		let target: string | null = null;
		for (const portalId of this.portalsInRange) {
			const pos = this.portalWorldPos.get(portalId);
			if (!pos) continue;
			if (
				Phaser.Math.Distance.Between(playerPos.x, playerPos.y, pos.x, pos.y) <=
				PORTAL_ENTER_RADIUS
			) {
				target = portalId;
				break;
			}
		}
		if (!target) return;

		const portal = this.portalsById.get(target);
		if (!portal) return;
		// effectiveChunkContents (pristine + any saved override), not
		// chunkContents directly — a portal with a quill edit always opens to
		// the edited text, here and everywhere else that reads file content.
		const content =
			this.effectiveChunkContents.get(portal.clusterId)?.[portal.file.path] ??
			null;

		this.store.getState().enterPortal(target, content);
		this.bus.emit("portal:enter", { portalId: target });

		// Binary/unreadable files (content === null) keep the M3 fallback: mode
		// flips to "file" but WorldScene keeps running underneath FileOverlay's
		// React "no preview available" message. A real text file gets the real
		// FileScene instead, via switch() (sleep this scene, start file fresh)
		// so returning later is scene.wake(), not a full WorldScene re-init —
		// camera position and the chunk cache survive the round trip.
		if (content !== null) {
			this.persistPlayerPos();
			const monsters = (this.portalMonsterIds.get(target) ?? [])
				.map((id) => this.monstersById.get(id))
				.filter(
					(m): m is Monster =>
						m !== undefined && !this.save.defeatedMonsterIds.includes(m.id),
				);
			this.scene.switch("file", {
				portalId: target,
				file: portal.file,
				content,
				returnSceneKey: "world",
				monsters,
				worldFiles: [...this.worldFiles],
			});
		}
	};

	private persistPlayerPos(): void {
		this.save = withPlayerPosition(this.save, "world", {
			x: this.player.body.x,
			y: this.player.body.y,
		});
		persistSave(this.save);
	}

	// The bonfire at world spawn doubles as the way back — Esc only returns to
	// the shelf near it, not from anywhere in the world, so it reads as a
	// deliberate portal-back rather than a global hotkey that fights the file
	// overlay's own Esc-to-close.
	private handleReturnToShelf(): void {
		if (!this.returnTo || this.returningToShelf) return;
		if (!Phaser.Input.Keyboard.JustDown(this.keys.esc)) return;

		const spawn = this.manifest.clusters[0]?.pos ?? { x: 0, y: 0 };
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		if (
			Phaser.Math.Distance.Between(playerPos.x, playerPos.y, spawn.x, spawn.y) >
			RETURN_TO_SHELF_RADIUS
		) {
			return;
		}

		this.returningToShelf = true;
		this.persistPlayerPos();
		const shelfUrl = this.returnTo.shelfUrl;
		this.bus.emit("world:return-to-shelf", { shelfUrl });
		// Same fade-covers-the-cut reasoning as ShelfScene.handleCabinEnter — see
		// systems/sceneTransition.ts.
		this.time.delayedCall(
			cabinTransitionDelayMs(prefersReducedMotion()),
			() => {
				this.scene.start("boot", { shelfUrl });
			},
		);
	}

	// --- Save persistence ---------------------------------------------
	// WorldScene owns `this.save` for the whole session (it outlives FileScene
	// switches — see the M4 scene.switch/wake comment above) so it's the
	// single place fileOverrides/visitedClusters/bagSlots get written, even
	// though the events that trigger a write (an editor save, a bag grab)
	// happen while this scene is asleep underneath FileScene. mitt listeners
	// and zustand subscriptions aren't Phaser scene lifecycle, so they still
	// fire while asleep.

	private setupSaveListeners(): void {
		this.bus.on("cluster:enter", this.onClusterEnterForSave);
		this.bus.on("editor:save", this.onEditorSave);
		this.bus.on("tool:reset-file-edits", this.onResetFileEdits);
		this.bus.on("tool:reset-world", this.onResetWorld);
		this.bus.on("monster:defeated", this.onMonsterDefeated);
		this.unsubscribeBagSlots = this.store.subscribe((state, prev) => {
			if (state.bagSlots === prev.bagSlots) return;
			this.save = withBagSlots(this.save, state.bagSlots);
			persistSave(this.save);
		});
		this.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.teardownSaveListeners,
			this,
		);
	}

	private teardownSaveListeners(): void {
		this.bus.off("cluster:enter", this.onClusterEnterForSave);
		this.bus.off("editor:save", this.onEditorSave);
		this.bus.off("tool:reset-file-edits", this.onResetFileEdits);
		this.bus.off("tool:reset-world", this.onResetWorld);
		this.bus.off("monster:defeated", this.onMonsterDefeated);
		this.unsubscribeBagSlots?.();
		this.unsubscribeBagSlots = null;
	}

	private onClusterEnterForSave = ({
		clusterId,
	}: {
		clusterId: string;
	}): void => {
		if (this.save.visitedClusters.includes(clusterId)) return;
		this.save = withVisitedCluster(this.save, clusterId);
		persistSave(this.save);
	};

	private onEditorSave = ({
		portalId,
		content,
	}: {
		portalId: string;
		content: string;
	}): void => {
		this.save = withFileOverride(
			this.save,
			portalId,
			content,
			new Date().toISOString(),
		);
		persistSave(this.save);
		const portal = this.portalsById.get(portalId);
		if (portal) this.refreshEffectiveChunk(portal.clusterId);
		this.drawEditedMarker(portalId);
		this.publishPortalIndex();
	};

	private onResetFileEdits = ({ portalId }: { portalId: string }): void => {
		this.save = withoutFileOverride(this.save, portalId);
		persistSave(this.save);
		this.removeEditedMarker(portalId);
		this.publishPortalIndex();

		const portal = this.portalsById.get(portalId);
		if (!portal) return;
		this.refreshEffectiveChunk(portal.clusterId);
		if (this.store.getState().activePortalId !== portalId) return;

		// That file is the one currently open (in FileScene or its editor) —
		// swap the live view back to the pristine chunk content too, not just
		// the saved state.
		const pristine =
			this.chunkContents.get(portal.clusterId)?.[portal.file.path] ?? "";
		this.store.getState().setActivePortalContent(pristine);
		this.bus.emit("file:content-reset", { portalId, content: pristine });
	};

	/** FileScene resolved a battle in this monster's favor (its originating annotator no longer flags anything with the same rule) — drop it from the save and every scene that renders it. */
	private onMonsterDefeated = ({ monsterId }: { monsterId: string }): void => {
		if (this.save.defeatedMonsterIds.includes(monsterId)) return;
		this.save = withDefeatedMonster(this.save, monsterId);
		persistSave(this.save);
		this.removeMonsterSprite(monsterId);
		this.publishMonsterIndex();
	};

	private onResetWorld = (): void => {
		const resetPortalIds = Object.keys(this.save.fileOverrides);
		const revivedMonsterIds = [...this.save.defeatedMonsterIds];
		this.save = emptySaveData(this.worldId);
		clearSave(this.worldId);
		for (const clusterId of this.chunkContents.keys())
			this.refreshEffectiveChunk(clusterId);
		for (const portalId of resetPortalIds) this.removeEditedMarker(portalId);
		for (const monsterId of revivedMonsterIds) {
			const monster = this.monstersById.get(monsterId);
			if (!monster) continue;
			if (monster.portalId) this.drawPortalMonster(monster);
			else if (monster.pathId) this.drawPathMonster(monster);
		}
		this.publishPortalIndex();
		this.publishMonsterIndex();

		const activePortalId = this.store.getState().activePortalId;
		const portal = activePortalId
			? this.portalsById.get(activePortalId)
			: undefined;
		if (!activePortalId || !portal) return;
		const pristine =
			this.chunkContents.get(portal.clusterId)?.[portal.file.path] ?? "";
		this.store.getState().setActivePortalContent(pristine);
		this.bus.emit("file:content-reset", {
			portalId: activePortalId,
			content: pristine,
		});
	};
}
