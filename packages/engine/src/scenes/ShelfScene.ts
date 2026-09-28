import type { ShelfManifest, ShelfWorldEntry } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	ASSET_KEYS,
	biomeTileSheetKey,
	CASTLE_KEEP_KEY,
	OPTIONAL_ASSET_KEYS,
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
} from "../render/propPlacement.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import {
	CABIN_SCALE,
	CASTLE_KEEP_TARGET_HEIGHT_PX,
	fitSpriteToSize,
	WIZARD_TOWER_SCALE,
} from "../render/scale.js";
import { largestAngularGapMidpoint } from "../systems/angularGap.js";
import { prefersReducedMotion } from "../systems/glowSettings.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import type { ScatterExclusion } from "../systems/scatter.js";
import { cabinTransitionDelayMs } from "../systems/sceneTransition.js";
import { themeFromSeed } from "../systems/theme.js";
import type { AssetAvailability } from "./PreloadScene.js";

export interface ShelfSceneData {
	shelfManifest: ShelfManifest;
	shelfBase: string;
	shelfUrl: string;
	availability: AssetAvailability;
}

const CABIN_RING_RADIUS = 480;
const CABIN_ENTER_RADIUS = 70;
const WORLD_MARGIN = 400;
/** Clear space between the player's physics body and the tower's edge — see playerController.ts's body.setSize(24, 16). */
const TOWER_SPAWN_CLEARANCE = 24;
/** How far out the tower's own "clearing" (meadow patch + flower ring) extends. */
const TOWER_CLEARING_RADIUS = 170;
const TOWER_CLEARING_EXCLUSION_RADIUS = 90;
const CABIN_PATH_EXCLUSION_RADIUS = 26;
const CASTLE_KEEP_DISTANCE = 260;
const SHELF_PROPS_NEAR_TOWER = ["lamp-post", "bench", "flower-bed"] as const;

interface CabinPlacement {
	world: ShelfWorldEntry;
	pos: { x: number; y: number };
}

/**
 * The hub world: a wizard tower centered with one cabin per converted world
 * fanned around it. Walking into a cabin and pressing E boots that world
 * (BootScene), carrying this shelf's url so the world can hand the player
 * back here (see WorldScene.handleReturnToShelf).
 */
export class ShelfScene extends Phaser.Scene {
	private shelfManifest!: ShelfManifest;
	private shelfBase = "";
	private shelfUrl = "";
	private availability!: AssetAvailability;
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private cabins: CabinPlacement[] = [];
	private cabinsInRange = new Set<string>();
	/** Set the instant a cabin entry is confirmed, guarding the transition-hold window (see handleCabinEnter) against a second E press re-triggering scene.start before the first one fires. */
	private enteringWorld = false;
	private placedProps: PlacedProp[] = [];
	private castleKeepPos = { x: 0, y: 0 };
	private ambientEffects: { destroy(): void } | null = null;
	private ambientLights: { destroy(): void } | null = null;
	private unsubscribeAmbientTimeOfDay: (() => void) | null = null;

	private player!: PlayerHandle;
	private playerTextures!: PlayerTextures;
	private movementKeys!: MovementKeys;
	private enterKey!: Phaser.Input.Keyboard.Key;

	constructor() {
		super({ key: "shelf", active: false });
	}

	init(data: ShelfSceneData): void {
		this.shelfManifest = data.shelfManifest;
		this.shelfBase = data.shelfBase;
		this.shelfUrl = data.shelfUrl;
		this.availability = data.availability;
		this.store = this.registry.get("store");
		this.bus = this.registry.get("bus");
		this.cabins = [];
		this.cabinsInRange = new Set();
		this.placedProps = [];
	}

	create(): void {
		this.layoutCabins();
		const tower = this.drawTower();

		// Spawn beside the tower, not on top of it (M10b batch-1 fix — the
		// tower used to sit at this same (0,0) point the player spawned at).
		// East of the tower rather than toward the first cabin (due north,
		// see layoutCabins' angle) so spawning never starts the player
		// standing in that path's way. Derived from the tower sprite's own
		// displayWidth rather than a hardcoded offset so the cabinet-fallback
		// tower (much smaller — see drawTower) still gets a correctly-sized gap.
		const spawn = { x: tower.displayWidth / 2 + TOWER_SPAWN_CLEARANCE, y: 0 };

		this.drawGround(spawn);
		this.drawPaths();
		this.drawCabins();

		this.playerTextures = {
			front: ASSET_KEYS.characterIdle,
			back: this.availability.characterBack
				? OPTIONAL_ASSET_KEYS.characterIdleBack
				: null,
		};
		this.player = createPlayer(this, spawn, this.playerTextures);
		this.movementKeys = createMovementKeys(this);
		const kb = this.input.keyboard;
		if (!kb) throw new Error("ShelfScene requires keyboard input");
		this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);

		this.setupCamera();
		this.store.getState().setPlayerPos(spawn);

		const unsubscribeGlow = attachTimeOfDayGlow(this, this.store);
		this.setupAmbientEffects(tower);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			unsubscribeGlow();
			this.unsubscribeAmbientTimeOfDay?.();
			this.unsubscribeAmbientTimeOfDay = null;
			this.ambientEffects?.destroy();
			this.ambientEffects = null;
			this.ambientLights?.destroy();
			this.ambientLights = null;
		});
	}

	/** Same shape as WorldScene's — fireflies/motes plus the tower-area lamp post's flicker (no chimney smoke on the shelf: SHELF_PROPS_NEAR_TOWER never includes "cottage"). */
	/** `tower` is the sprite drawTower() already created — the tower's own window light position is derived from its actual displayWidth/Height, same fractional-offset trick as propLightWorldPos, rather than a hardcoded pixel offset that would drift if the tower's scale ever changes again. */
	private setupAmbientEffects(tower: Phaser.GameObjects.Image): void {
		const reducedMotion = prefersReducedMotion();
		for (const prop of this.placedProps) {
			if (prop.name === "lamp-post")
				attachLanternFlicker(this, prop.sprite, reducedMotion);
		}

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
		// The wizard tower's window sits almost exactly at its sprite center
		// (see tools/asset-pipeline/src/pixelmaps/wizard-tower.ts's "w" rows:
		// 40-44 of 80, columns 21-26 of 48 — both within a couple percent of
		// center) — no offset needed beyond the tower's own position.
		const towerLight: LightPoolOptions | null = this.availability.wizardTower
			? {
					x: tower.x,
					y: tower.y,
					radiusPx: 46,
					color: PALETTE.gold,
					alpha: 0.6,
				}
			: null;

		const rebuild = (): void => {
			this.ambientEffects?.destroy();
			this.ambientLights?.destroy();
			const timeOfDay = this.store.getState().timeOfDay;
			this.ambientEffects = attachWorldEffects(this, {
				bounds: this.computeWorldBounds(),
				timeOfDay,
				reducedMotion,
			});
			this.ambientLights =
				timeOfDay === "night"
					? attachLightPools(this, [
							...propLights,
							...(towerLight ? [towerLight] : []),
						])
					: null;
		};
		rebuild();
		this.unsubscribeAmbientTimeOfDay = this.store.subscribe((state, prev) => {
			if (state.timeOfDay !== prev.timeOfDay) rebuild();
		});
	}

	private layoutCabins(): void {
		const worlds = this.shelfManifest.worlds;
		const count = worlds.length;
		this.cabins = worlds.map((world, index) => {
			const angle =
				(Phaser.Math.PI2 * index) / Math.max(count, 1) - Math.PI / 2;
			return {
				world,
				pos: {
					x: Math.cos(angle) * CABIN_RING_RADIUS,
					y: Math.sin(angle) * CABIN_RING_RADIUS,
				},
			};
		});
	}

	private drawTower(): Phaser.GameObjects.Image {
		const available = this.availability.wizardTower;
		const sprite = this.add.image(
			0,
			0,
			available ? OPTIONAL_ASSET_KEYS.wizardTower : ASSET_KEYS.cabinet,
		);
		sprite.setScale(available ? WIZARD_TOWER_SCALE : CABIN_SCALE).setDepth(2);
		// The tower has no per-world theme of its own; a fixed neutral tint just
		// distinguishes the cabinet-fallback tower from a regular cabinet.
		if (!available) sprite.setTint(PALETTE.trail);

		this.add
			.text(0, sprite.displayHeight / 2 + 6, this.shelfManifest.meta.name, {
				fontFamily: '"Courier New", monospace',
				fontSize: "16px",
				fontStyle: "bold",
				color: toCssColor(PALETTE.cream),
				stroke: toCssColor(PALETTE.ink),
				strokeThickness: 3,
			})
			.setOrigin(0.5, 0)
			.setDepth(2);

		return sprite;
	}

	/** Shared by the field bake, the path bake, and the camera — one box, not three slightly different ones (see WorldScene's identical method for why that used to matter). */
	private computeWorldBounds(): {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	} {
		const xs = this.cabins.map((c) => c.pos.x);
		const ys = this.cabins.map((c) => c.pos.y);
		// See WorldScene's identical computeWorldBounds for why this grows
		// with the viewport rather than staying a flat margin — the shelf's
		// own two-cabin demo layout is exactly the narrow-bounds case that
		// used to show the ground field ending in a hard black edge.
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

	/**
	 * One continuous grass field across the shelf (M10b batch-2 fix — the
	 * shelf previously had no ground at all, just the tower/cabins floating
	 * over the void), a meadow "clearing" patch + flower ring around the
	 * tower, a couple of cottagecore props tucked in beside it, and one
	 * decorative castle keep placed in whichever direction has the most
	 * angular room between cabin spokes (`largestAngularGapMidpoint`) so it
	 * never sits on top of a cabin or its path, regardless of how many
	 * worlds this shelf has.
	 */
	private drawGround(spawn: { x: number; y: number }): void {
		if (!this.availability.worldArt) return;

		const bounds = this.computeWorldBounds();
		for (const field of bakeGroundField(
			this,
			bounds,
			biomeTileSheetKey("meadow"),
			20260928,
		)) {
			field.setDepth(0);
		}

		const cabinAngles = this.cabins.map((c) => Math.atan2(c.pos.y, c.pos.x));
		const keepAngle = largestAngularGapMidpoint(cabinAngles);
		this.castleKeepPos = {
			x: Math.cos(keepAngle) * CASTLE_KEEP_DISTANCE,
			y: Math.sin(keepAngle) * CASTLE_KEEP_DISTANCE,
		};

		const exclusions: ScatterExclusion[] = [
			{ x: 0, y: 0, radius: TOWER_CLEARING_EXCLUSION_RADIUS },
			{ x: spawn.x, y: spawn.y, radius: TOWER_SPAWN_CLEARANCE + 30 },
			{ x: this.castleKeepPos.x, y: this.castleKeepPos.y, radius: 70 },
		];
		const clearingOuterRadius =
			TOWER_CLEARING_RADIUS + CABIN_PATH_EXCLUSION_RADIUS;
		for (const cabin of this.cabins) {
			for (const point of stampPointsAlongSegment(
				{ x: 0, y: 0 },
				cabin.pos,
				40,
			)) {
				if (
					Phaser.Math.Distance.Between(point.x, point.y, 0, 0) <=
					clearingOuterRadius
				) {
					exclusions.push({
						x: point.x,
						y: point.y,
						radius: CABIN_PATH_EXCLUSION_RADIUS,
					});
				}
			}
		}

		bakeClusterGround({
			scene: this,
			clusterId: "shelf-tower",
			biomeSheetKey: biomeTileSheetKey("meadow"),
			centerX: 0,
			centerY: 0,
			radiusX: TOWER_CLEARING_RADIUS,
			radiusY: TOWER_CLEARING_RADIUS * 0.72,
			exclusions,
			decalCount: 10,
			ringFlowerCount: 10,
			seed: 20260928,
		}).setDepth(0.5);

		this.placedProps = placeProps({
			scene: this,
			clusterId: "shelf-tower",
			centerX: 0,
			centerY: 0,
			radiusX: TOWER_CLEARING_RADIUS,
			radiusY: TOWER_CLEARING_RADIUS * 0.72,
			exclusions,
			count: 3,
			depth: 2,
			allowedNames: SHELF_PROPS_NEAR_TOWER,
			// Same "frame the edge" reasoning as WorldScene's clearings.
			minRadiusFrac: 0.6,
		});

		const keep = this.add
			.image(this.castleKeepPos.x, this.castleKeepPos.y, CASTLE_KEEP_KEY)
			.setDepth(2);
		fitSpriteToSize(keep, CASTLE_KEEP_TARGET_HEIGHT_PX);
	}

	private drawPaths(): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(1);
			g.lineStyle(2, PALETTE.trail, 0.8);
			for (const cabin of this.cabins) dashedLine(g, { x: 0, y: 0 }, cabin.pos);
			return;
		}

		if (this.cabins.length === 0) return;
		const segments: PathSegment[] = this.cabins.map((cabin) => ({
			id: `spoke::${cabin.world.id}`,
			from: { x: 0, y: 0 },
			to: cabin.pos,
		}));
		bakePaths(this, this.computeWorldBounds(), segments).setDepth(1);
	}

	private drawCabins(): void {
		for (const cabin of this.cabins) {
			const theme = themeFromSeed(cabin.world.themeSeed);
			const sprite = this.add.image(cabin.pos.x, cabin.pos.y, ASSET_KEYS.cabin);
			sprite.setScale(CABIN_SCALE).setTint(theme.tint).setDepth(2);

			this.add
				.text(
					cabin.pos.x,
					cabin.pos.y + sprite.displayHeight / 2 + 6,
					cabin.world.name,
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

	private setupCamera(): void {
		const { minX, minY, maxX, maxY } = this.computeWorldBounds();

		this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.1);
	}

	update(_time: number, delta: number): void {
		const { pos } = updatePlayerMovement(
			this.player,
			this.movementKeys,
			delta,
			this.playerTextures,
		);
		this.store.getState().setPlayerPos(pos);
		this.handleCabinApproach(pos);
		this.handleCabinEnter(pos);
	}

	private handleCabinApproach(pos: { x: number; y: number }): void {
		const points: PortalPoint[] = this.cabins.map((cabin) => ({
			portalId: cabin.world.id,
			pos: cabin.pos,
		}));
		const { inRange } = newlyApproached(
			points,
			pos,
			CABIN_ENTER_RADIUS,
			this.cabinsInRange,
		);
		this.cabinsInRange = inRange;
	}

	private handleCabinEnter(pos: { x: number; y: number }): void {
		if (this.enteringWorld) return;
		if (!Phaser.Input.Keyboard.JustDown(this.enterKey)) return;

		let closest: CabinPlacement | null = null;
		let closestDist = Number.POSITIVE_INFINITY;
		for (const cabin of this.cabins) {
			if (!this.cabinsInRange.has(cabin.world.id)) continue;
			const dist = Phaser.Math.Distance.Between(
				pos.x,
				pos.y,
				cabin.pos.x,
				cabin.pos.y,
			);
			if (dist < closestDist) {
				closestDist = dist;
				closest = cabin;
			}
		}
		if (!closest) return;

		this.enteringWorld = true;
		const worldUrl = resolveRelativeUrl(this.shelfBase, closest.world.worldUrl);
		this.bus.emit("shelf:enter-world", { worldId: closest.world.id });
		// Delayed rather than immediate: SceneTransitionOverlay (React) starts a
		// Stardew-style fade-to-black the instant it hears shelf:enter-world —
		// this hold gives that fade time to finish covering the screen before
		// the hard scene.start cut happens, so the cut itself is never visible.
		// See systems/sceneTransition.ts for why the two share one constant.
		this.time.delayedCall(
			cabinTransitionDelayMs(prefersReducedMotion()),
			() => {
				this.scene.start("boot", {
					worldUrl,
					returnTo: { shelfUrl: this.shelfUrl },
				});
			},
		);
	}
}
