import type { ShelfManifest, ShelfWorldEntry } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { ASSET_KEYS, OPTIONAL_ASSET_KEYS } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { attachGlowLifecycle } from "../fx/GlowPipeline.js";
import { PALETTE, toCssColor } from "../palette.js";
import { dashedLine } from "../render/dashedLine.js";
import { bakePaths, type PathSegment } from "../render/pathBaker.js";
import {
	createMovementKeys,
	createPlayer,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
	updatePlayerMovement,
} from "../render/playerController.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import { CABIN_SCALE, WIZARD_TOWER_SCALE } from "../render/scale.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
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
	}

	create(): void {
		this.layoutCabins();
		const tower = this.drawTower();
		this.drawPaths();
		this.drawCabins();

		// Spawn beside the tower, not on top of it (M10b batch-1 fix — the
		// tower used to sit at this same (0,0) point the player spawned at).
		// East of the tower rather than toward the first cabin (due north,
		// see layoutCabins' angle) so spawning never starts the player
		// standing in that path's way. Derived from the tower sprite's own
		// displayWidth rather than a hardcoded offset so the cabinet-fallback
		// tower (much smaller — see drawTower) still gets a correctly-sized gap.
		const spawn = { x: tower.displayWidth / 2 + TOWER_SPAWN_CLEARANCE, y: 0 };

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

		const unsubscribeGlow = attachGlowLifecycle(this, this.store);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribeGlow);
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

	private drawPaths(): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(1);
			g.lineStyle(2, PALETTE.trail, 0.8);
			for (const cabin of this.cabins) dashedLine(g, { x: 0, y: 0 }, cabin.pos);
			return;
		}

		if (this.cabins.length === 0) return;
		const xs = this.cabins.map((c) => c.pos.x);
		const ys = this.cabins.map((c) => c.pos.y);
		const margin = 200;
		const segments: PathSegment[] = this.cabins.map((cabin) => ({
			id: `spoke::${cabin.world.id}`,
			from: { x: 0, y: 0 },
			to: cabin.pos,
		}));
		bakePaths(
			this,
			{
				minX: Math.min(0, ...xs) - margin,
				minY: Math.min(0, ...ys) - margin,
				maxX: Math.max(0, ...xs) + margin,
				maxY: Math.max(0, ...ys) + margin,
			},
			segments,
		).setDepth(1);
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
		const xs = this.cabins.map((c) => c.pos.x);
		const ys = this.cabins.map((c) => c.pos.y);
		const minX = Math.min(0, ...xs) - WORLD_MARGIN;
		const maxX = Math.max(0, ...xs) + WORLD_MARGIN;
		const minY = Math.min(0, ...ys) - WORLD_MARGIN;
		const maxY = Math.max(0, ...ys) + WORLD_MARGIN;

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

		const worldUrl = resolveRelativeUrl(this.shelfBase, closest.world.worldUrl);
		this.bus.emit("shelf:enter-world", { worldId: closest.world.id });
		this.scene.start("boot", {
			worldUrl,
			returnTo: { shelfUrl: this.shelfUrl },
		});
	}
}
