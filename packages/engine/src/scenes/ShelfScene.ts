import type { ShelfManifest, ShelfWorldEntry } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	ASSET_KEYS,
	biomeTileSheetKey,
	CASTLE_KEEP_KEY,
	OPTIONAL_ASSET_KEYS,
	SHELF_CABIN_KEY,
} from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import {
	type AtmosphereHandle,
	attachAtmosphere,
} from "../render/atmosphere.js";
import {
	attachPointerInput,
	BOUNDS_INSET_PX,
	ClickWalker,
	drivePlayer,
	type PointerInputHandle,
	physicsBounds,
} from "../render/clickWalker.js";
import { dashedLine } from "../render/dashedLine.js";
import { attachLanternFlicker, attachWorldEffects } from "../render/effects.js";
import { bakeClusterGround } from "../render/groundBaker.js";
import { bakeGroundField } from "../render/groundField.js";
import type { LightPoolOptions } from "../render/lightPools.js";
import {
	bakePathRibbons,
	bakePaths,
	type PathSegment,
} from "../render/pathBaker.js";
import { stampPointsAlongSegment } from "../render/pathStamps.js";
import {
	createMovementKeys,
	createPlayer,
	DEFAULT_PLAYER_SPEED,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
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
	SHELF_CABIN_SCALE,
	WIZARD_TOWER_SCALE,
} from "../render/scale.js";
import {
	attachSky,
	boundsWithSky,
	dressEdges,
	type EdgeDressing,
} from "../render/worldDressing.js";
import { largestAngularGapMidpoint } from "../systems/angularGap.js";
import {
	type ClickTarget,
	clampToBounds,
	type Interactable,
} from "../systems/clickWalk.js";
import { labelAnchor, pickLabelSide } from "../systems/labelPlacement.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import type { ScatterExclusion } from "../systems/scatter.js";
import { cabinTransitionDelayMs } from "../systems/sceneTransition.js";
import { subtleTint, themeFromSeed } from "../systems/theme.js";
import { activeFocusOwner } from "../systems/uiFocus.js";
import type { AssetAvailability } from "./PreloadScene.js";

export interface ShelfSceneData {
	shelfManifest: ShelfManifest;
	shelfBase: string;
	shelfUrl: string;
	availability: AssetAvailability;
}

const CABIN_RING_RADIUS = 480;
const CABIN_ENTER_RADIUS = 70;
/** Where a click-walk to a cabin stops (and enters) — well inside CABIN_ENTER_RADIUS so arrival always lands within Enter's reach. */
const CABIN_ARRIVE_RADIUS = 40;
const LABEL_GAP_PX = 6;
/** Above the player (depth 5), below the night grade (5.5): a label the player walks past stays readable instead of being covered, and still dims with the scene at night. */
const LABEL_DEPTH = 5.2;
const WORLD_MARGIN = 400;
/** Clear space between the player's physics body and the tower's edge — see playerController.ts's body.setSize(24, 16). */
const TOWER_SPAWN_CLEARANCE = 24;
/** How far out the tower's own "clearing" (meadow patch + flower ring) extends. */
const TOWER_CLEARING_RADIUS = 170;
const TOWER_CLEARING_EXCLUSION_RADIUS = 90;
const CABIN_PATH_EXCLUSION_RADIUS = 26;
const CASTLE_KEEP_DISTANCE = 260;
/** How much of the per-world theme tint reaches the procedural cabin (systems/theme.ts's subtleTint). Higher than WorldScene's cabinet (0.35) because the cabin's tint is what tells worlds apart on the shelf, but still well short of full strength, which muddies the warm windows and ivy. */
const SHELF_CABIN_TINT_STRENGTH = 0.5;
/** A cabin sprite is ~116px across (procedural 832px art at SHELF_CABIN_SCALE; the photographic fallback is ~128px at CABIN_SCALE) — this keeps edge scenery a clear step back from it and its enter radius. */
const CABIN_SCENERY_CLEARANCE = 110;
const SHELF_PROPS_NEAR_TOWER = ["lamp-post", "bench", "flower-bed"] as const;

interface CabinPlacement {
	world: ShelfWorldEntry;
	pos: { x: number; y: number };
	/** Click/hover hit radius, set from the drawn sprite's size in drawCabins(). */
	hitRadius: number;
}

/**
 * The hub world: a wizard tower centered with one cabin per converted world
 * fanned around it. Walking into a cabin and pressing Enter (or clicking
 * it, which walks there first) boots that world
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
	/** Set the instant a cabin entry is confirmed, guarding the transition-hold window (see enterCabin) against a second Enter press re-triggering scene.start before the first one fires. */
	private enteringWorld = false;
	private placedProps: PlacedProp[] = [];
	private castleKeepPos = { x: 0, y: 0 };
	private castleKeepSize: { w: number; h: number } | null = null;
	private cabinWindowLights: LightPoolOptions[] = [];
	private ambientEffects: { destroy(): void } | null = null;
	private atmosphere: AtmosphereHandle | null = null;
	private edgeDressing: EdgeDressing | null = null;
	private sky: { destroy(): void } | null = null;
	private unsubscribeAmbientTimeOfDay: (() => void) | null = null;

	private player!: PlayerHandle;
	private playerTextures!: PlayerTextures;
	private movementKeys!: MovementKeys;
	private enterKey!: Phaser.Input.Keyboard.Key;
	private walker!: ClickWalker;
	private pointerInput!: PointerInputHandle;

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
		this.cabinWindowLights = [];
		this.enteringWorld = false;
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
		this.drawEdgeScenery(spawn);
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
		this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

		this.setupCamera();
		this.setupPointerInput();
		this.store.getState().setPlayerPos(spawn);

		this.setupAmbientEffects(tower);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.unsubscribeAmbientTimeOfDay?.();
			this.unsubscribeAmbientTimeOfDay = null;
			this.ambientEffects?.destroy();
			this.ambientEffects = null;
			this.atmosphere?.destroy();
			this.atmosphere = null;
			this.sky?.destroy();
			this.sky = null;
			this.edgeDressing?.destroy();
			this.edgeDressing = null;
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
					radiusPx: 44,
					color: PALETTE.gold,
					alpha: 0.7,
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
					radiusPx: 60,
					color: PALETTE.gold,
					alpha: 0.7,
				}
			: null;

		this.atmosphere = attachAtmosphere(this, this.store, {
			lights: [
				...this.castleKeepLights(),
				...this.cabinWindowLights,
				...propLights,
				...(towerLight ? [towerLight] : []),
				...(this.edgeDressing?.lights ?? []),
			],
			reducedMotion,
		});
		if (this.availability.atmosphereArt) {
			this.sky = attachSky(
				this,
				this.computeWorldBounds(),
				`shelf:${this.shelfUrl}`,
				this.atmosphere,
				reducedMotion,
			);
		}

		const rebuild = (): void => {
			this.ambientEffects?.destroy();
			this.ambientEffects = attachWorldEffects(this, {
				bounds: this.computeWorldBounds(),
				timeOfDay: this.store.getState().timeOfDay,
				reducedMotion,
			});
		};
		rebuild();
		this.unsubscribeAmbientTimeOfDay = this.store.subscribe((state, prev) => {
			if (state.timeOfDay !== prev.timeOfDay) rebuild();
		});
	}

	/**
	 * The keep's two lit windows (props.ts castleKeep: 2x5-cell windows at
	 * columns 9 and 21, rows 27-31, of its 32x44 grid) as fractions of its
	 * display size, the same fractional-offset trick as propLightWorldPos.
	 */
	private castleKeepLights(): LightPoolOptions[] {
		const size = this.castleKeepSize;
		if (!size) return [];
		return [-0.19, 0.19].map((xFrac) => ({
			x: this.castleKeepPos.x + xFrac * size.w,
			y: this.castleKeepPos.y + 0.17 * size.h,
			radiusPx: 22,
			color: PALETTE.gold,
			alpha: 0.6,
		}));
	}

	/**
	 * The procedural cabin's two lit windows (world-art/shelf-cabin.ts: 9x9
	 * windows at columns 9 and 34, rows 28-36, of its 52x48 grid) as
	 * fractions of its display size, like castleKeepLights. The photographic
	 * fallback gets none — its windows aren't at known positions.
	 */
	private shelfCabinLights(
		sprite: Phaser.GameObjects.Image,
	): LightPoolOptions[] {
		return [-0.24, 0.24].map((xFrac) => ({
			x: sprite.x + xFrac * sprite.displayWidth,
			y: sprite.y + 0.18 * sprite.displayHeight,
			radiusPx: 26,
			color: PALETTE.gold,
			alpha: 0.65,
		}));
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
				hitRadius: CABIN_ARRIVE_RADIUS,
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

		// Spokes leave the tower toward every cabin, so a caption straight
		// below it sits on the south spoke whenever there is one (the demo's
		// two-cabin shelf) — pickLabelSide moves it off every spoke. The
		// player always spawns due east of the tower (see create()), so east
		// counts as taken too.
		const anchor = labelAnchor(
			pickLabelSide([...this.cabins.map((cabin) => cabin.pos), { x: 1, y: 0 }]),
			{ x: 0, y: 0 },
			sprite.displayWidth,
			sprite.displayHeight,
			LABEL_GAP_PX,
		);
		this.add
			.text(anchor.x, anchor.y, this.shelfManifest.meta.name, {
				fontFamily: '"Courier New", monospace',
				fontSize: "16px",
				fontStyle: "bold",
				color: toCssColor(PALETTE.cream),
				stroke: toCssColor(PALETTE.ink),
				strokeThickness: 3,
			})
			.setOrigin(anchor.originX, anchor.originY)
			.setDepth(LABEL_DEPTH);

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
		this.castleKeepSize = { w: keep.displayWidth, h: keep.displayHeight };
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
		if (this.availability.atmosphereArt) {
			bakePathRibbons(this, this.computeWorldBounds(), segments).rt.setDepth(1);
		} else {
			bakePaths(this, this.computeWorldBounds(), segments).setDepth(1);
		}
	}

	/** Same edge dressing as WorldScene (render/worldDressing.ts), keeping clear of the tower clearing, every cabin, the castle keep, the spawn point and the spokes. */
	private drawEdgeScenery(spawn: { x: number; y: number }): void {
		if (!this.availability.atmosphereArt) return;
		this.edgeDressing = dressEdges({
			scene: this,
			bounds: this.computeWorldBounds(),
			seed: `shelf:${this.shelfUrl}`,
			circles: [
				{ x: 0, y: 0, radius: TOWER_CLEARING_RADIUS + 40 },
				{ x: spawn.x, y: spawn.y, radius: 60 },
				{ x: this.castleKeepPos.x, y: this.castleKeepPos.y, radius: 110 },
				...this.cabins.map((cabin) => ({
					x: cabin.pos.x,
					y: cabin.pos.y,
					radius: CABIN_SCENERY_CLEARANCE,
				})),
			],
			segments: this.cabins.map((cabin) => ({
				ax: 0,
				ay: 0,
				bx: cabin.pos.x,
				by: cabin.pos.y,
				halfWidth: 20,
			})),
			reducedMotion: prefersReducedMotion(),
		});
	}

	private drawCabins(): void {
		for (const cabin of this.cabins) {
			const theme = themeFromSeed(cabin.world.themeSeed);
			const procedural = this.availability.shelfCabin;
			const sprite = this.add.image(
				cabin.pos.x,
				cabin.pos.y,
				procedural ? SHELF_CABIN_KEY : ASSET_KEYS.cabin,
			);
			sprite
				.setScale(procedural ? SHELF_CABIN_SCALE : CABIN_SCALE)
				.setTint(
					procedural
						? subtleTint(theme.tint, SHELF_CABIN_TINT_STRENGTH)
						: theme.tint,
				)
				.setDepth(2);
			if (procedural) {
				this.cabinWindowLights.push(...this.shelfCabinLights(sprite));
			}

			cabin.hitRadius = Math.max(sprite.displayWidth, sprite.displayHeight) / 2;

			// The cabin's one path is its spoke back to the tower at (0,0); a
			// north cabin's caption used to sit right on it, under the player.
			const anchor = labelAnchor(
				pickLabelSide([{ x: -cabin.pos.x, y: -cabin.pos.y }]),
				cabin.pos,
				sprite.displayWidth,
				sprite.displayHeight,
				LABEL_GAP_PX,
			);
			this.add
				.text(anchor.x, anchor.y, cabin.world.name, {
					fontFamily: '"Courier New", monospace',
					fontSize: "14px",
					fontStyle: "bold",
					color: toCssColor(PALETTE.cream),
					stroke: toCssColor(PALETTE.ink),
					strokeThickness: 3,
				})
				.setOrigin(anchor.originX, anchor.originY)
				.setDepth(LABEL_DEPTH);
		}
	}

	private setupCamera(): void {
		const { minX, minY, maxX, maxY } = this.computeWorldBounds();

		if (this.availability.atmosphereArt) {
			const { camera, physics } = boundsWithSky({ minX, minY, maxX, maxY });
			this.physics.world.setBounds(
				physics.minX,
				physics.minY,
				physics.maxX - physics.minX,
				physics.maxY - physics.minY,
			);
			this.cameras.main.setBounds(
				camera.minX,
				camera.minY,
				camera.maxX - camera.minX,
				camera.maxY - camera.minY,
			);
		} else {
			this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);
			this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
		}
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.1);
	}

	private setupPointerInput(): void {
		this.walker = new ClickWalker(this, prefersReducedMotion());
		this.pointerInput = attachPointerInput(this, {
			interactables: () => this.cabinInteractables(),
			enabled: () => !this.enteringWorld,
			onClick: this.onClick,
		});
		this.bus.on("tool:opener-use", this.onOpenerUse);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.bus.off("tool:opener-use", this.onOpenerUse);
		});
	}

	private cabinInteractables(): Interactable[] {
		return this.cabins.map((cabin) => ({
			id: cabin.world.id,
			kind: "cabin",
			pos: cabin.pos,
			hitRadius: cabin.hitRadius,
			arriveRadius: CABIN_ARRIVE_RADIUS,
		}));
	}

	private onClick = (target: ClickTarget): void => {
		const from = { x: this.player.body.x, y: this.player.body.y };
		if (target.kind === "ground") {
			this.walker.walkTo(
				clampToBounds(target.point, physicsBounds(this), BOUNDS_INSET_PX),
				{ from, speed: DEFAULT_PLAYER_SPEED },
			);
			return;
		}
		this.walker.walkTo(target.target.pos, {
			from,
			speed: DEFAULT_PLAYER_SPEED,
			target: target.target,
		});
	};

	private onOpenerUse = (): void => {
		if (!this.scene.isActive()) return;
		this.enterClosestCabinInRange({
			x: this.player.body.x,
			y: this.player.body.y,
		});
	};

	update(_time: number, delta: number): void {
		const { pos, arrivedAt } = drivePlayer(
			this.player,
			this.movementKeys,
			this.walker,
			delta,
			this.playerTextures,
		);
		this.store.getState().setPlayerPos(pos);
		this.handleCabinApproach(pos);
		if (arrivedAt?.kind === "cabin") {
			const cabin = this.cabins.find((c) => c.world.id === arrivedAt.id);
			if (cabin) this.enterCabin(cabin);
		}
		this.handleCabinEnter(pos);
		this.pointerInput.refreshHover();
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
		if (!Phaser.Input.Keyboard.JustDown(this.enterKey)) return;
		// A focused button (e.g. tabbed-to) gets this Enter natively too.
		if (activeFocusOwner() === "control") return;
		this.enterClosestCabinInRange(pos);
	}

	private enterClosestCabinInRange(pos: { x: number; y: number }): void {
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
		if (closest) this.enterCabin(closest);
	}

	private enterCabin(cabin: CabinPlacement): void {
		if (this.enteringWorld) return;
		this.enteringWorld = true;
		this.walker.cancel();
		const worldUrl = resolveRelativeUrl(this.shelfBase, cabin.world.worldUrl);
		this.bus.emit("shelf:enter-world", { worldId: cabin.world.id });
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
					shelfIndex: this.shelfManifest.worlds.findIndex(
						(w) => w.id === cabin.world.id,
					),
				});
			},
		);
	}
}
