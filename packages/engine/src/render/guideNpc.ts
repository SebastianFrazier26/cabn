import type { Position, WorldManifest } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	ASSET_KEYS,
	FX_SPARK_KEY,
	GUIDE_NPC_BUBBLE_KEY,
	GUIDE_NPC_BUBBLE_PATH,
	GUIDE_NPC_FRAME_HEIGHT,
	GUIDE_NPC_FRAME_WIDTH,
	GUIDE_NPC_IDLE_ANIM,
	GUIDE_NPC_KEY,
	GUIDE_NPC_PATH,
	GUIDE_NPC_SCALE,
	PORTAL_ARCH_FRAME_SIZE,
} from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE } from "../palette.js";
import type { Interactable } from "../systems/clickWalk.js";
import { stepBlend, targetBlend } from "../systems/dayNight.js";
import type { CircleKeepout, SegmentKeepout } from "../systems/edgeScenery.js";
import { placeGuideNpc, shouldShowGuide } from "../systems/guideNpc.js";
import {
	createLightPool,
	type LightPool,
	poolFlicker,
	updateLightPool,
} from "./lightPools.js";
import { WORLD_PORTAL_SCALE } from "./scale.js";

const DISPLAY_W = (GUIDE_NPC_FRAME_WIDTH * GUIDE_NPC_SCALE) as number;
const DISPLAY_H = (GUIDE_NPC_FRAME_HEIGHT * GUIDE_NPC_SCALE) as number;
/** Enter talks within this distance of her centre — well short of the ~96px+ she stands from the fire, so standing at the fire (or the fresh spawn, kept further off by SPAWN_KEEPOUT) still means the fire. */
export const GUIDE_INTERACT_RADIUS = 56;
/** Where a click-walk stops: inside the Enter radius, but far enough out that the player stands beside her rather than in her. */
const GUIDE_ARRIVE_RADIUS = 46;
const SPAWN_KEEPOUT = GUIDE_INTERACT_RADIUS + 12;
/** The arch's visible stone is ~200 of its 256px frame; half of that at world scale, plus air. */
const ARCH_KEEPOUT = ((PORTAL_ARCH_FRAME_SIZE * WORLD_PORTAL_SCALE) / 2) * 0.8;
/** Path ribbon half-width (~17px, see WorldScene's EDGE_SCENERY_PATH_HALF_WIDTH) plus air. */
const PATH_HALF_WIDTH = 28;
/** Props and the fountain sit at depth 2; above them, below monsters (4) and the player (5). */
const NPC_DEPTH = 2.5;
/** Above the night grade (5.5) and light pools (5.6) so the "!" stays readable at night, like the click marker. */
const BUBBLE_DEPTH = 5.62;
/** The lantern glass's centre in grid cells (pixelmaps/guide-npc.ts: x 20-21, y 19-21), relative to the 24x32 grid's centre. */
const LANTERN_CELL_OFFSET = { x: 20.5 - 12, y: 20.5 - 16 };
const CELL_PX = 2;
const IDLE_FRAMES = [0, 1, 0, 1, 0, 2];
/** 3 screen px per bubble cell (her own are 2) — at her density the "!" read as a speck. */
const BUBBLE_SCALE = GUIDE_NPC_SCALE * 1.5;

export function preloadGuideNpcAssets(load: Phaser.Loader.LoaderPlugin): void {
	load.spritesheet(GUIDE_NPC_KEY, GUIDE_NPC_PATH, {
		frameWidth: GUIDE_NPC_FRAME_WIDTH,
		frameHeight: GUIDE_NPC_FRAME_HEIGHT,
	});
	load.image(GUIDE_NPC_BUBBLE_KEY, GUIDE_NPC_BUBBLE_PATH);
}

export interface GuideNpcOptions {
	manifest: WorldManifest;
	shelfIndex: number | undefined;
	store: StoreApi<CabnStore>;
	/** Where a fresh save spawns the player — kept clear, so Enter there still means the bonfire. */
	spawn: Position;
	portalPositions: Iterable<Position>;
	bonfireWidth: number;
	reducedMotion: boolean;
	/** Reads the world's save (WorldScene owns it), so a "reset world" brings the bubble back. */
	talked: () => boolean;
	markTalked: () => void;
}

/**
 * Wren, the guide standing by the first world's bonfire. Owns her sprite,
 * "!" bubble and lantern glow, publishes her position to the store, and
 * opens the dialogue (store.guideOpen — react/GuideDialog.tsx renders it).
 * WorldScene only spawns her and routes its existing Enter/click
 * interaction here; she tears herself down with the scene.
 */
export class GuideNpc {
	private readonly sprite: Phaser.GameObjects.Sprite;
	private readonly bubble: Phaser.GameObjects.Image | null;
	private readonly lantern: LightPool | null;
	private blend: number;
	private talkedShown: boolean;
	private unsubscribe: (() => void) | null = null;

	static spawn(scene: Phaser.Scene, opts: GuideNpcOptions): GuideNpc | null {
		if (!shouldShowGuide(opts.shelfIndex, opts.manifest.guide)) return null;
		const root =
			opts.manifest.clusters.find((c) => c.path === ".") ??
			opts.manifest.clusters[0];
		if (!root) return null;
		const pos = placeGuideNpc({
			hub: root.pos,
			...keepouts(root.id, opts),
			footprint: { w: DISPLAY_W, h: DISPLAY_H },
			minRadius: opts.bonfireWidth / 2 + 36,
			maxRadius: opts.bonfireWidth / 2 + 150,
			preferredRadius: opts.bonfireWidth / 2 + 56,
		});
		if (!pos) return null;
		return new GuideNpc(scene, pos, opts);
	}

	private constructor(
		private readonly scene: Phaser.Scene,
		readonly pos: Position,
		private readonly opts: GuideNpcOptions,
	) {
		const hasArt = scene.textures.exists(GUIDE_NPC_KEY);
		this.sprite = hasArt
			? scene.add.sprite(pos.x, pos.y, GUIDE_NPC_KEY, 0)
			: scene.add
					.sprite(pos.x, pos.y, ASSET_KEYS.characterIdle)
					.setTint(PALETTE.biome.meadow);
		this.sprite.setScale(GUIDE_NPC_SCALE).setDepth(NPC_DEPTH);
		if (hasArt && !opts.reducedMotion) {
			if (!scene.anims.exists(GUIDE_NPC_IDLE_ANIM)) {
				scene.anims.create({
					key: GUIDE_NPC_IDLE_ANIM,
					frames: scene.anims.generateFrameNumbers(GUIDE_NPC_KEY, {
						frames: IDLE_FRAMES,
					}),
					frameRate: 4,
					repeat: -1,
				});
			}
			this.sprite.play(GUIDE_NPC_IDLE_ANIM);
		}

		this.bubble = scene.textures.exists(GUIDE_NPC_BUBBLE_KEY)
			? scene.add
					.image(pos.x, pos.y - DISPLAY_H / 2 - 18, GUIDE_NPC_BUBBLE_KEY)
					.setScale(BUBBLE_SCALE)
					.setDepth(BUBBLE_DEPTH)
			: null;
		if (this.bubble && !opts.reducedMotion) {
			scene.tweens.add({
				targets: this.bubble,
				y: this.bubble.y - 3,
				duration: 700,
				yoyo: true,
				repeat: -1,
				ease: "Sine.easeInOut",
			});
		}

		this.lantern = scene.textures.exists(FX_SPARK_KEY)
			? createLightPool(
					scene,
					{
						x: pos.x + LANTERN_CELL_OFFSET.x * CELL_PX,
						y: pos.y + LANTERN_CELL_OFFSET.y * CELL_PX,
						radiusPx: 30,
						color: PALETTE.gold,
						alpha: 0.75,
						flicker: true,
					},
					7,
				)
			: null;
		this.blend = targetBlend(opts.store.getState().timeOfDay);

		this.talkedShown = opts.talked();
		this.bubble?.setVisible(!this.talkedShown);
		opts.store
			.getState()
			.setGuideNpc({ pos: { ...pos }, talked: this.talkedShown });

		scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		// A sleeping WorldScene (a file open over it) keeps its objects, so the
		// dialogue can't be left open underneath the file view.
		this.unsubscribe = opts.store.subscribe((state, prev) => {
			if (state.mode !== "world" && prev.mode === "world" && state.guideOpen)
				state.setGuideOpen(false);
		});
	}

	interactable(): Interactable {
		return {
			id: "guide",
			kind: "npc",
			pos: this.pos,
			hitRadius: DISPLAY_W / 2 + 6,
			arriveRadius: GUIDE_ARRIVE_RADIUS,
			// Wins over the bonfire's hit area where the two could touch.
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
			) <= GUIDE_INTERACT_RADIUS
		);
	}

	isTalking(): boolean {
		return this.opts.store.getState().guideOpen;
	}

	talk(): void {
		const state = this.opts.store.getState();
		if (state.guideOpen) return;
		if (!this.opts.talked()) this.opts.markTalked();
		state.setGuideOpen(true);
	}

	private onUpdate = (time: number, delta: number): void => {
		const talked = this.opts.talked();
		if (talked !== this.talkedShown) {
			this.talkedShown = talked;
			this.bubble?.setVisible(!talked);
			this.opts.store.getState().setGuideNpc({ pos: { ...this.pos }, talked });
		}
		if (this.lantern) {
			this.blend = stepBlend(
				this.blend,
				targetBlend(this.opts.store.getState().timeOfDay),
				delta,
				600,
				this.opts.reducedMotion,
			);
			updateLightPool(
				this.lantern,
				this.blend,
				poolFlicker(this.lantern, time, this.opts.reducedMotion),
			);
		}
	};

	destroy = (): void => {
		this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.sprite.destroy();
		this.bubble?.destroy();
		this.lantern?.sprite.destroy();
		const state = this.opts.store.getState();
		state.setGuideOpen(false);
		state.setGuideNpc(null);
	};
}

function keepouts(
	rootId: string,
	opts: GuideNpcOptions,
): { circles: CircleKeepout[]; segments: SegmentKeepout[] } {
	const root = opts.manifest.clusters.find((c) => c.id === rootId);
	if (!root) return { circles: [], segments: [] };
	const circles: CircleKeepout[] = [
		{ x: root.pos.x, y: root.pos.y, radius: opts.bonfireWidth / 2 + 8 },
		// The cluster label under the fire (WorldScene.drawClusters).
		{
			x: root.pos.x,
			y: root.pos.y + opts.bonfireWidth / 2 + 16,
			radius: 44,
		},
		{ x: opts.spawn.x, y: opts.spawn.y, radius: SPAWN_KEEPOUT },
	];
	for (const p of opts.portalPositions) {
		circles.push({ x: p.x, y: p.y, radius: ARCH_KEEPOUT });
	}
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
