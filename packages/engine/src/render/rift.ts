import type { Position, WorldManifest } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { FX_SPARK_KEY, PORTAL_ARCH_FRAME_SIZE } from "../assetPaths.js";
import type { CabnBus, CabnEvents } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import type { Interactable } from "../systems/clickWalk.js";
import { stepBlend, targetBlend } from "../systems/dayNight.js";
import type { CircleKeepout, SegmentKeepout } from "../systems/edgeScenery.js";
import { universeTint } from "../systems/gitHistory.js";
import { placeGuideNpc } from "../systems/guideNpc.js";
import { cabinTransitionDelayMs } from "../systems/sceneTransition.js";
import {
	createLightPool,
	type LightPool,
	poolFlicker,
	updateLightPool,
} from "./lightPools.js";
import { WORLD_PORTAL_SCALE } from "./scale.js";

export const RIFT_TEXTURE_KEY = "cabn-rift";
const FRAME_W = 36;
const FRAME_H = 52;
const FRAMES = 4;
const SCALE = 2;
const DISPLAY_W = FRAME_W * SCALE;
const DISPLAY_H = FRAME_H * SCALE;
/** Enter opens the picker within this distance — clear of the bonfire's own radius and Wren's, so each keeps its meaning. */
export const RIFT_INTERACT_RADIUS = 60;
const RIFT_ARRIVE_RADIUS = 48;
const ARCH_KEEPOUT = ((PORTAL_ARCH_FRAME_SIZE * WORLD_PORTAL_SCALE) / 2) * 0.8;
const PATH_HALF_WIDTH = 28;
const RIFT_DEPTH = 2.5;
/** Between the night grade (5.5) and the light pools (5.6): the whole view takes the universe's colour, lights still glow through. */
const TINT_DEPTH = 5.55;
const TINT_ALPHA = 0.13;
const BAND_COLORS = ["#8a6fd6", "#4fd0d8", "#ef5fa0"];

/**
 * Four frames of a swirling oval, drawn per pixel into a canvas texture —
 * there is no rift art in assets/, and a procedural swirl stays crisp at
 * the pixel scale everything else uses.
 */
function ensureRiftTexture(scene: Phaser.Scene): void {
	if (scene.textures.exists(RIFT_TEXTURE_KEY)) return;
	const canvas = scene.textures.createCanvas(
		RIFT_TEXTURE_KEY,
		FRAME_W * FRAMES,
		FRAME_H,
	);
	if (!canvas) return;
	const ctx = canvas.getContext();
	const cx = FRAME_W / 2 - 0.5;
	const cy = FRAME_H / 2 - 0.5;
	const rx = FRAME_W / 2 - 1;
	const ry = FRAME_H / 2 - 1;
	for (let f = 0; f < FRAMES; f++) {
		const phase = (f / FRAMES) * Math.PI * 2;
		for (let y = 0; y < FRAME_H; y++) {
			for (let x = 0; x < FRAME_W; x++) {
				const dx = (x - cx) / rx;
				const dy = (y - cy) / ry;
				const r = Math.hypot(dx, dy);
				if (r > 1) continue;
				let color: string;
				if (r > 0.88) color = "#2a1d52";
				else if (r < 0.18) color = "#f1ecff";
				else {
					const angle = Math.atan2(dy, dx) + r * 5 - phase;
					const band = ((Math.floor((angle / Math.PI) * 3) % 3) + 3) % 3;
					color = BAND_COLORS[band] as string;
					// Sparse fixed "stars" that shift with the frame, so the swirl twinkles.
					if ((x * 7 + y * 13 + f * 5) % 37 === 0) color = "#ffffff";
				}
				ctx.fillStyle = color;
				ctx.fillRect(f * FRAME_W + x, y, 1, 1);
			}
		}
		canvas.add(f, 0, f * FRAME_W, 0, FRAME_W, FRAME_H);
	}
	canvas.refresh();
}

export interface RiftOptions {
	manifest: WorldManifest;
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	spawn: Position;
	portalPositions: Iterable<Position>;
	bonfireWidth: number;
	/** Wren's spot, if she's in this world — the rift keeps its reach clear of hers. */
	guidePos: Position | null;
	reducedMotion: boolean;
	returnTo: { shelfUrl: string } | undefined;
	shelfIndex: number | undefined;
	/** Writes restored stash edits into this world's save before it reloads. */
	applyOverrides(files: Record<string, string>): void;
	/** Called right before the scene restarts into another universe (persist the player's spot). */
	beforeTravel(): void;
}

/**
 * The multiverse rift beside the bonfire: branches are alternate universes,
 * and this is the way between them. It exists only when the world has git
 * history; Enter/click opens the picker (react/UniversePicker.tsx) and a
 * "universe:travel" from there restarts the scene into the chosen world.
 * While visiting a universe the whole view takes that universe's tint.
 */
export class Rift {
	private readonly sprite: Phaser.GameObjects.Sprite;
	private readonly glow: LightPool | null;
	private blend: number;

	static spawn(scene: Phaser.Scene, opts: RiftOptions): Rift | null {
		const git = opts.store.getState().git;
		if (!git) return null;
		attachUniverseTint(scene, git.universe?.slug ?? null);
		const root =
			opts.manifest.clusters.find((c) => c.path === ".") ??
			opts.manifest.clusters[0];
		if (!root) return null;
		const pos = placeGuideNpc({
			hub: root.pos,
			...riftKeepouts(root.pos, opts),
			footprint: { w: DISPLAY_W, h: DISPLAY_H },
			minRadius: opts.bonfireWidth / 2 + 60,
			maxRadius: opts.bonfireWidth / 2 + 200,
			preferredRadius: opts.bonfireWidth / 2 + 80,
			// North of the fire: the fresh spawn is east and Wren prefers west.
			preferredAngle: -Math.PI / 2,
		});
		if (!pos) return null;
		return new Rift(scene, pos, opts);
	}

	private constructor(
		private readonly scene: Phaser.Scene,
		readonly pos: Position,
		private readonly opts: RiftOptions,
	) {
		ensureRiftTexture(scene);
		this.sprite = scene.add
			.sprite(pos.x, pos.y, RIFT_TEXTURE_KEY, 0)
			.setScale(SCALE)
			.setDepth(RIFT_DEPTH);
		if (!opts.reducedMotion) {
			if (!scene.anims.exists("cabn-rift-swirl")) {
				scene.anims.create({
					key: "cabn-rift-swirl",
					frames: [0, 1, 2, 3].map((frame) => ({
						key: RIFT_TEXTURE_KEY,
						frame,
					})),
					frameRate: 6,
					repeat: -1,
				});
			}
			this.sprite.play("cabn-rift-swirl");
			scene.tweens.add({
				targets: this.sprite,
				scaleX: SCALE * 1.04,
				scaleY: SCALE * 0.97,
				duration: 1100,
				yoyo: true,
				repeat: -1,
				ease: "Sine.easeInOut",
			});
		}
		this.glow = scene.textures.exists(FX_SPARK_KEY)
			? createLightPool(
					scene,
					{
						x: pos.x,
						y: pos.y,
						radiusPx: 56,
						color: 0x8a6fd6,
						alpha: 0.7,
						flicker: true,
					},
					11,
				)
			: null;
		this.blend = targetBlend(opts.store.getState().timeOfDay);
		opts.store.getState().setRiftPos({ ...pos });
		scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		opts.bus.on("universe:travel", this.onTravel);
	}

	interactable(): Interactable {
		return {
			id: "rift",
			kind: "rift",
			pos: this.pos,
			hitRadius: DISPLAY_W / 2 + 6,
			arriveRadius: RIFT_ARRIVE_RADIUS,
			priority: 1,
		};
	}

	inReach(player: Position): boolean {
		return (
			Phaser.Math.Distance.Between(
				player.x,
				player.y,
				this.pos.x,
				this.pos.y,
			) <= RIFT_INTERACT_RADIUS
		);
	}

	isOpen(): boolean {
		return this.opts.store.getState().universeOpen;
	}

	open(): void {
		this.opts.store.getState().setUniverseOpen(true);
	}

	private onTravel = (event: CabnEvents["universe:travel"]): void => {
		if (!this.scene.scene.isActive()) return;
		const git = this.opts.store.getState().git;
		if (!git) return;
		if (event.restoreOverrides)
			this.opts.applyOverrides(event.restoreOverrides);
		this.opts.beforeTravel();
		this.opts.store.getState().setUniverseOpen(false);
		const target = {
			worldUrl: event.worldUrl,
			returnTo: this.opts.returnTo,
			...(this.opts.shelfIndex !== undefined
				? { shelfIndex: this.opts.shelfIndex }
				: {}),
			...(event.universe
				? { universe: { ...event.universe, historyBase: git.historyBase } }
				: {}),
		};
		this.scene.time.delayedCall(
			cabinTransitionDelayMs(this.opts.reducedMotion),
			() => this.scene.scene.start("boot", target),
		);
	};

	private onUpdate = (time: number, delta: number): void => {
		if (!this.glow) return;
		this.blend = stepBlend(
			this.blend,
			targetBlend(this.opts.store.getState().timeOfDay),
			delta,
			600,
			this.opts.reducedMotion,
		);
		updateLightPool(
			this.glow,
			this.blend,
			poolFlicker(this.glow, time, this.opts.reducedMotion),
		);
	};

	destroy = (): void => {
		this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		this.opts.bus.off("universe:travel", this.onTravel);
		this.sprite.destroy();
		this.glow?.sprite.destroy();
		this.opts.store.getState().setUniverseOpen(false);
		this.opts.store.getState().setRiftPos(null);
	};
}

/** A screen-fixed wash in the universe's colour; the main world (null) gets none. */
export function attachUniverseTint(
	scene: Phaser.Scene,
	slug: string | null,
): void {
	const color = universeTint(slug);
	if (color === null) return;
	const cam = scene.cameras.main;
	const rect = scene.add
		.rectangle(0, 0, cam.width, cam.height, color, TINT_ALPHA)
		.setOrigin(0, 0)
		.setScrollFactor(0)
		.setDepth(TINT_DEPTH);
	const onResize = (size: Phaser.Structs.Size) =>
		rect.setSize(size.width, size.height);
	scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
	scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
		scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
		rect.destroy();
	});
}

function riftKeepouts(
	fire: Position,
	opts: RiftOptions,
): { circles: CircleKeepout[]; segments: SegmentKeepout[] } {
	const circles: CircleKeepout[] = [
		{ x: fire.x, y: fire.y, radius: opts.bonfireWidth / 2 + 8 },
		{ x: fire.x, y: fire.y + opts.bonfireWidth / 2 + 16, radius: 44 },
		// Enter at the fresh spawn must still mean the bonfire.
		{ x: opts.spawn.x, y: opts.spawn.y, radius: RIFT_INTERACT_RADIUS + 16 },
	];
	if (opts.guidePos)
		circles.push({
			x: opts.guidePos.x,
			y: opts.guidePos.y,
			radius: RIFT_INTERACT_RADIUS + 60,
		});
	for (const p of opts.portalPositions)
		circles.push({ x: p.x, y: p.y, radius: ARCH_KEEPOUT });
	const byId = new Map(opts.manifest.clusters.map((c) => [c.id, c.pos]));
	const segments: SegmentKeepout[] = [];
	for (const path of opts.manifest.paths) {
		const a = byId.get(path.from);
		const b = byId.get(path.to);
		if (!a || !b) continue;
		segments.push({
			ax: a.x,
			ay: a.y,
			bx: b.x,
			by: b.y,
			halfWidth: PATH_HALF_WIDTH,
		});
	}
	return { circles, segments };
}
