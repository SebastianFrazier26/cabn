import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	FX_SPARK_KEY,
	PET_FRAME_SIZE,
	PET_SCALE,
	petStripPath,
	petTextureKey,
} from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import { PET_PROVIDERS, type PetSpecies } from "../pets/providers.js";
import type { Interactable } from "../systems/clickWalk.js";
import {
	initialPetFollow,
	type PetFollowState,
	stepPetFollow,
} from "../systems/petFollow.js";

const DISPLAY = PET_FRAME_SIZE * PET_SCALE;
/** Enter talks to the pet within this distance — it trails ~30px behind, so it's in reach whenever nothing nearer (a portal, Wren, the bonfire) claims Enter first. */
export const PET_INTERACT_RADIUS = 64;
const PET_ARRIVE_RADIUS = 40;
/** The player container sits at depth 5; the pet sorts just in front of or behind it by y. */
const PLAYER_DEPTH = 5;
const PUBLISH_EPSILON = 2;
const IDLE_FRAMES = [0, 0, 0, 0, 0, 1];
const WALK_FRAMES = [2, 3];

function idleAnimKey(species: PetSpecies): string {
	return `${petTextureKey(species)}-idle`;
}
function walkAnimKey(species: PetSpecies): string {
	return `${petTextureKey(species)}-walk`;
}

export interface PetCompanionOptions {
	store: StoreApi<CabnStore>;
	reducedMotion: boolean;
	playerPos: () => { x: number; y: number };
}

/**
 * The AI pet trailing the player through a world. Follows
 * store.petProvider (swaps species, or disappears when the pet is
 * dismissed), publishes its position for click targeting, and opens the
 * chat (store.petChatOpen — react/PetLayer.tsx renders it). The strip loads
 * on first use rather than in PreloadScene, so worlds without a pet never
 * download pet art. Worlds only: the shelf and file views have no pet (the
 * shelf has no files to ask about; the file view is the player's alone).
 */
export class PetCompanion {
	private sprite: Phaser.GameObjects.Sprite | null = null;
	private species: PetSpecies | null = null;
	private follow: PetFollowState;
	private bob: Phaser.Tweens.Tween | null = null;
	private bobOffset = { y: 0 };
	private published = { x: Number.NaN, y: Number.NaN };
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly opts: PetCompanionOptions,
	) {
		this.follow = initialPetFollow(opts.playerPos());
		this.syncProvider();
		this.unsubscribe = opts.store.subscribe((state, prev) => {
			if (state.petProvider !== prev.petProvider) this.syncProvider();
			// A file opening over the sleeping world closes the chat, same as the guide's dialogue.
			if (state.mode !== "world" && prev.mode === "world" && state.petChatOpen)
				state.setPetChatOpen(false);
		});
		scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
	}

	get active(): boolean {
		return this.sprite !== null;
	}

	interactable(): Interactable | null {
		if (!this.sprite) return null;
		return {
			id: "pet",
			kind: "npc",
			pos: { x: this.follow.pos.x, y: this.follow.pos.y },
			hitRadius: DISPLAY / 2 + 4,
			arriveRadius: PET_ARRIVE_RADIUS,
			priority: 2,
		};
	}

	inReach(player: { x: number; y: number }): boolean {
		if (!this.sprite) return false;
		return (
			Phaser.Math.Distance.Between(
				player.x,
				player.y,
				this.follow.pos.x,
				this.follow.pos.y,
			) <= PET_INTERACT_RADIUS
		);
	}

	isTalking(): boolean {
		const s = this.opts.store.getState();
		return s.petChatOpen || s.petPanelOpen;
	}

	talk(): void {
		const state = this.opts.store.getState();
		if (!this.sprite || state.petChatOpen) return;
		state.setPetChatOpen(true);
	}

	private syncProvider(): void {
		const provider = this.opts.store.getState().petProvider;
		const species = provider ? PET_PROVIDERS[provider].species : null;
		if (species === this.species) return;
		this.removeSprite();
		this.species = species;
		if (!species) return;
		const key = petTextureKey(species);
		if (this.scene.textures.exists(key)) {
			this.createSprite(species);
			return;
		}
		this.scene.load.spritesheet(key, petStripPath(species), {
			frameWidth: PET_FRAME_SIZE,
			frameHeight: PET_FRAME_SIZE,
		});
		const done = (): void => {
			this.scene.load.off(Phaser.Loader.Events.COMPLETE, done);
			if (this.species === species && !this.sprite) this.createSprite(species);
		};
		this.scene.load.on(Phaser.Loader.Events.COMPLETE, done);
		this.scene.load.start();
	}

	private createSprite(species: PetSpecies): void {
		const key = petTextureKey(species);
		const hasArt = this.scene.textures.exists(key);
		this.follow = initialPetFollow(this.opts.playerPos());
		const { x, y } = this.follow.pos;
		this.sprite = hasArt
			? this.scene.add.sprite(x, y, key, 0).setScale(PET_SCALE)
			: this.scene.add.sprite(x, y, FX_SPARK_KEY).setScale(0.6);
		if (!hasArt) return;
		if (!this.scene.anims.exists(idleAnimKey(species))) {
			this.scene.anims.create({
				key: idleAnimKey(species),
				frames: this.scene.anims.generateFrameNumbers(key, {
					frames: IDLE_FRAMES,
				}),
				frameRate: 3,
				repeat: -1,
			});
			this.scene.anims.create({
				key: walkAnimKey(species),
				frames: this.scene.anims.generateFrameNumbers(key, {
					frames: WALK_FRAMES,
				}),
				frameRate: 8,
				repeat: -1,
			});
		}
		if (!this.opts.reducedMotion) {
			this.sprite.play(idleAnimKey(species));
			// The whale floats, so it bobs in place instead of walking on the ground.
			if (species === "whale") {
				this.bobOffset.y = 0;
				this.bob = this.scene.tweens.add({
					targets: this.bobOffset,
					y: -5,
					duration: 900,
					yoyo: true,
					repeat: -1,
					ease: "Sine.easeInOut",
				});
			}
		}
	}

	private removeSprite(): void {
		this.bob?.remove();
		this.bob = null;
		this.sprite?.destroy();
		this.sprite = null;
		this.published = { x: Number.NaN, y: Number.NaN };
		this.opts.store.getState().setPetNpc(null);
	}

	private onUpdate = (_time: number, delta: number): void => {
		const sprite = this.sprite;
		if (!sprite || !this.species) return;
		const player = this.opts.playerPos();
		const wasMoving = this.follow.moving;
		this.follow = stepPetFollow(this.follow, player, delta);
		const floatY = this.species === "whale" ? -10 + this.bobOffset.y : 0;
		sprite.setPosition(this.follow.pos.x, this.follow.pos.y + floatY);
		sprite.setFlipX(this.follow.facingLeft);
		sprite.setDepth(
			PLAYER_DEPTH + (this.follow.pos.y - 16 > player.y ? 0.01 : -0.01),
		);
		if (!this.opts.reducedMotion && wasMoving !== this.follow.moving) {
			sprite.play(
				this.follow.moving
					? walkAnimKey(this.species)
					: idleAnimKey(this.species),
				true,
			);
		}
		if (
			Math.abs(this.follow.pos.x - this.published.x) > PUBLISH_EPSILON ||
			Math.abs(this.follow.pos.y - this.published.y) > PUBLISH_EPSILON ||
			Number.isNaN(this.published.x)
		) {
			this.published = { ...this.follow.pos };
			this.opts.store.getState().setPetNpc({
				pos: {
					x: Math.round(this.follow.pos.x),
					y: Math.round(this.follow.pos.y),
				},
			});
		}
	};

	destroy = (): void => {
		this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.removeSprite();
		this.opts.store.getState().setPetChatOpen(false);
	};
}
