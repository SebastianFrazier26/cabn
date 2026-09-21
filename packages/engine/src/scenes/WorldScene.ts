import type {
	Cluster,
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
	OPTIONAL_ASSET_KEYS,
	PORTAL_ARCH_FRAME_SIZE,
} from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { dashedLine } from "../render/dashedLine.js";
import {
	createMovementKeys,
	createPlayer,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
	updatePlayerMovement,
} from "../render/playerController.js";
import { BONFIRE_SCALE, CABINET_SCALE, PORTAL_SCALE } from "../render/scale.js";
import { touchChunk } from "../systems/chunkCache.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import { clampPreviewLines } from "../systems/previewText.js";
import { themeFromSeed } from "../systems/theme.js";
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

/** Ground radius scales with file count so busier clusters read as bigger clearings. */
function groundRadius(cluster: Cluster): number {
	return 130 + Math.min(cluster.portalIds.length, 40) * 3;
}

export class WorldScene extends Phaser.Scene {
	private manifest!: WorldManifest;
	private worldBase = "";
	private availability!: AssetAvailability;
	private returnTo: { shelfUrl: string } | undefined;
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private clustersById = new Map<string, Cluster>();
	private portalsById = new Map<string, Portal>();
	private portalWorldPos = new Map<string, Position>();
	private portalSprites = new Map<string, Phaser.GameObjects.Sprite>();

	/** clusterId -> path -> file content, populated lazily as clusters are approached. */
	private chunkContents = new Map<string, Record<string, string>>();
	private chunkLoadOrder: string[] = [];
	private chunkFetchesInFlight = new Set<string>();

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
		for (const portal of this.manifest.portals)
			this.portalsById.set(portal.id, portal);

		this.drawGround();
		this.drawPaths();
		this.drawClusters();
		this.drawPortals();
		this.createPlayer();
		this.createArchPreview();
		this.setupInput();
		this.setupCamera();
		this.publishPortalIndex();
		this.setupToolBusListeners();
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
				previewLine: portal.preview.lines[0] ?? "",
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

	private drawGround(): void {
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
	}

	private drawPaths(): void {
		const g = this.add.graphics().setDepth(1);
		g.lineStyle(2, PALETTE.trail, 0.8);
		for (const path of this.manifest.paths) {
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) continue; // schema guarantees this in a valid manifest; guard keeps a corrupt bundle from crashing the scene
			dashedLine(g, from.pos, to.pos);
		}
	}

	private drawClusters(): void {
		// Same seed for every cabinet in this world — a world is one converted
		// project, so it gets one theme, not one per cluster.
		const theme = themeFromSeed(this.manifest.meta.themeSeed ?? 0);

		for (const cluster of this.manifest.clusters) {
			const isRoot = cluster.path === ".";
			const sprite = isRoot
				? this.drawBonfire(cluster.pos)
				: this.add.image(cluster.pos.x, cluster.pos.y, ASSET_KEYS.cabinet);

			if (!isRoot)
				sprite.setScale(CABINET_SCALE).setTint(theme.tint).setDepth(2);

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

	private drawPortals(): void {
		for (const cluster of this.manifest.clusters) {
			const count = cluster.portalIds.length;
			const radius = 90 + Math.min(count, 40) * 4;
			cluster.portalIds.forEach((portalId, index) => {
				const angle =
					(Phaser.Math.PI2 * index) / Math.max(count, 1) - Math.PI / 2;
				const pos: Position = {
					x: cluster.pos.x + Math.cos(angle) * radius,
					y: cluster.pos.y + Math.sin(angle) * radius,
				};
				this.portalWorldPos.set(portalId, pos);

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

	private createPlayer(): void {
		const spawn = this.manifest.clusters[0]?.pos ?? { x: 0, y: 0 };
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

	private setupCamera(): void {
		const xs = this.manifest.clusters.map((c) => c.pos.x);
		const ys = this.manifest.clusters.map((c) => c.pos.y);
		const minX = Math.min(0, ...xs) - WORLD_MARGIN;
		const maxX = Math.max(0, ...xs) + WORLD_MARGIN;
		const minY = Math.min(0, ...ys) - WORLD_MARGIN;
		const maxY = Math.max(0, ...ys) + WORLD_MARGIN;

		this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.1);
	}

	update(_time: number, delta: number): void {
		if (this.store.getState().mode === "file") {
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
				this.chunkContents.set(cluster.id, {});
				for (const [path, file] of Object.entries(chunk.files)) {
					// biome-ignore lint/style/noNonNullAssertion: just set above, same tick
					this.chunkContents.get(cluster.id)![path] = file.content;
				}

				const { order, evicted } = touchChunk(
					this.chunkLoadOrder,
					cluster.id,
					MAX_LOADED_CHUNKS,
				);
				this.chunkLoadOrder = order;
				for (const evictedId of evicted) this.chunkContents.delete(evictedId);
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
			portal.preview.lines,
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
		const content =
			this.chunkContents.get(portal.clusterId)?.[portal.file.path] ?? null;

		this.store.getState().enterPortal(target, content);
		this.bus.emit("portal:enter", { portalId: target });

		// Binary/unreadable files (content === null) keep the M3 fallback: mode
		// flips to "file" but WorldScene keeps running underneath FileOverlay's
		// React "no preview available" message. A real text file gets the real
		// FileScene instead, via switch() (sleep this scene, start file fresh)
		// so returning later is scene.wake(), not a full WorldScene re-init —
		// camera position and the chunk cache survive the round trip.
		if (content !== null) {
			this.scene.switch("file", {
				portalId: target,
				file: portal.file,
				content,
				returnSceneKey: "world",
			});
		}
	};

	// The bonfire at world spawn doubles as the way back — Esc only returns to
	// the shelf near it, not from anywhere in the world, so it reads as a
	// deliberate portal-back rather than a global hotkey that fights the file
	// overlay's own Esc-to-close.
	private handleReturnToShelf(): void {
		if (!this.returnTo) return;
		if (!Phaser.Input.Keyboard.JustDown(this.keys.esc)) return;

		const spawn = this.manifest.clusters[0]?.pos ?? { x: 0, y: 0 };
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		if (
			Phaser.Math.Distance.Between(playerPos.x, playerPos.y, spawn.x, spawn.y) >
			RETURN_TO_SHELF_RADIUS
		) {
			return;
		}

		this.bus.emit("world:return-to-shelf", {
			shelfUrl: this.returnTo.shelfUrl,
		});
		this.scene.start("boot", { shelfUrl: this.returnTo.shelfUrl });
	}
}
