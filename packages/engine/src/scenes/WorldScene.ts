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
import { ASSET_KEYS } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { touchChunk } from "../systems/chunkCache.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import { clampPreviewLines } from "../systems/previewText.js";
import { PORTAL_IDLE_ANIM } from "./PreloadScene.js";

export interface WorldSceneData {
	manifest: WorldManifest;
	worldBase: string;
}

const CLUSTER_LOAD_RADIUS = 260;
const PORTAL_APPROACH_RADIUS = 80;
const PORTAL_ENTER_RADIUS = 46;
const MAX_LOADED_CHUNKS = 8;
const PLAYER_SPEED = 220;
const WORLD_MARGIN = 500;
const CHARACTER_SCALE = 0.125; // asset is @16x a 24x32 logical sprite -> display at 2x logical
const CABIN_SCALE = 0.5;
const CABINET_SCALE = 0.375;
const PORTAL_SCALE = 0.375;
const PREVIEW_LINE_CHARS = 34;
const PREVIEW_MAX_LINES = 6;

function dashedLine(
	graphics: Phaser.GameObjects.Graphics,
	from: Position,
	to: Position,
	dash = 14,
	gap = 10,
): void {
	const total = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
	const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
	const step = dash + gap;
	for (let d = 0; d < total; d += step) {
		const segEnd = Math.min(d + dash, total);
		const x1 = from.x + Math.cos(angle) * d;
		const y1 = from.y + Math.sin(angle) * d;
		const x2 = from.x + Math.cos(angle) * segEnd;
		const y2 = from.y + Math.sin(angle) * segEnd;
		graphics.lineBetween(x1, y1, x2, y2);
	}
}

/** Ground radius scales with file count so busier clusters read as bigger clearings. */
function groundRadius(cluster: Cluster): number {
	return 130 + Math.min(cluster.portalIds.length, 40) * 3;
}

export class WorldScene extends Phaser.Scene {
	private manifest!: WorldManifest;
	private worldBase = "";
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

	private playerBody!: Phaser.GameObjects.Container;
	private playerSprite!: Phaser.GameObjects.Sprite;
	private walkTime = 0;

	private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
	private keys!: {
		w: Phaser.Input.Keyboard.Key;
		a: Phaser.Input.Keyboard.Key;
		s: Phaser.Input.Keyboard.Key;
		d: Phaser.Input.Keyboard.Key;
		enter: Phaser.Input.Keyboard.Key;
		e: Phaser.Input.Keyboard.Key;
	};

	private previewPanel!: Phaser.GameObjects.Container;
	private previewText!: Phaser.GameObjects.Text;
	private portalsInRange = new Set<string>();

	constructor() {
		super({ key: "world", active: false });
	}

	init(data: WorldSceneData): void {
		this.manifest = data.manifest;
		this.worldBase = data.worldBase;
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
		this.createPreviewPanel();
		this.setupInput();
		this.setupCamera();
	}

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
		for (const cluster of this.manifest.clusters) {
			const isRoot = cluster.path === ".";
			const sprite = this.add.image(
				cluster.pos.x,
				cluster.pos.y,
				isRoot ? ASSET_KEYS.cabin : ASSET_KEYS.cabinet,
			);
			sprite.setScale(isRoot ? CABIN_SCALE : CABINET_SCALE).setDepth(2);

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
		this.playerBody = this.add.container(spawn.x, spawn.y).setDepth(5);
		this.physics.add.existing(this.playerBody);
		const body = this.playerBody.body as Phaser.Physics.Arcade.Body;
		body.setSize(24, 16);
		body.setOffset(-12, 8);
		body.setCollideWorldBounds(true);

		this.playerSprite = this.add.sprite(0, 0, ASSET_KEYS.characterIdle);
		this.playerSprite.setScale(CHARACTER_SCALE);
		this.playerBody.add(this.playerSprite);

		this.store.getState().setPlayerPos(spawn);
	}

	private createPreviewPanel(): void {
		const bg = this.add.graphics();
		bg.fillStyle(PALETTE.parchment, 0.95);
		bg.fillRoundedRect(-110, -60, 220, 84, 8);
		bg.lineStyle(2, PALETTE.ink, 0.9);
		bg.strokeRoundedRect(-110, -60, 220, 84, 8);

		this.previewText = this.add.text(-100, -50, "", {
			fontFamily: '"Courier New", monospace',
			fontSize: "8px",
			color: toCssColor(PALETTE.ink),
			wordWrap: { width: 200 },
		});

		this.previewPanel = this.add.container(0, 0, [bg, this.previewText]);
		this.previewPanel.setDepth(10).setVisible(false).setAlpha(0);
	}

	private setupInput(): void {
		this.cursors =
			this.input.keyboard?.createCursorKeys() as Phaser.Types.Input.Keyboard.CursorKeys;
		const kb = this.input.keyboard;
		if (!kb) throw new Error("WorldScene requires keyboard input");
		this.keys = {
			w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
			a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
			s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
			d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
			enter: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
			e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
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
		this.cameras.main.startFollow(this.playerBody, true, 0.1, 0.1);
	}

	update(_time: number, delta: number): void {
		if (this.store.getState().mode === "file") {
			(this.playerBody.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			return;
		}

		this.handleMovement(delta);
		this.handleChunkLoading();
		this.handlePortalApproach();
		this.handlePortalEnter();
	}

	private handleMovement(delta: number): void {
		const body = this.playerBody.body as Phaser.Physics.Arcade.Body;
		let vx = 0;
		let vy = 0;
		if (this.cursors.left?.isDown || this.keys.a.isDown) vx -= 1;
		if (this.cursors.right?.isDown || this.keys.d.isDown) vx += 1;
		if (this.cursors.up?.isDown || this.keys.w.isDown) vy -= 1;
		if (this.cursors.down?.isDown || this.keys.s.isDown) vy += 1;

		const moving = vx !== 0 || vy !== 0;
		if (moving) {
			const len = Math.hypot(vx, vy);
			body.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);
			this.walkTime += delta;
			this.playerSprite.setFlipX(vx < 0);
		} else {
			body.setVelocity(0, 0);
			this.walkTime = 0;
		}

		this.playerSprite.y = moving ? Math.sin(this.walkTime * 0.012) * 3 : 0;
		this.playerSprite.angle = moving ? Math.sin(this.walkTime * 0.012) * 4 : 0;

		const pos = { x: this.playerBody.x, y: this.playerBody.y };
		this.store.getState().setPlayerPos(pos);
	}

	private nearestClusterInRange(): Cluster | null {
		const pos = { x: this.playerBody.x, y: this.playerBody.y };
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
		const playerPos = { x: this.playerBody.x, y: this.playerBody.y };
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

		// Closest in-range portal wins the panel when more than one is close.
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
		this.previewPanel.setPosition(pos.x, pos.y - 90);
		this.previewPanel.setVisible(true).setAlpha(1);
	}

	private handlePortalEnter(): void {
		const pressed =
			Phaser.Input.Keyboard.JustDown(this.keys.enter) ||
			Phaser.Input.Keyboard.JustDown(this.keys.e);
		if (!pressed) return;

		const playerPos = { x: this.playerBody.x, y: this.playerBody.y };
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
	}
}
