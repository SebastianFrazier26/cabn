import Phaser from "phaser";
import { type Facing, facingFromVelocity } from "../systems/facing.js";

/**
 * WorldScene and ShelfScene both drop the player into a physics-backed
 * container with the same walk/bob/facing behavior — factored out here so
 * "reuse the controller" means an actual shared module, not two copies that
 * drift apart the next time movement feel changes.
 */
export interface PlayerTextures {
	front: string;
	/** null when the back-view art hasn't shipped yet — falls back to front. */
	back: string | null;
}

export interface PlayerHandle {
	body: Phaser.GameObjects.Container;
	sprite: Phaser.GameObjects.Sprite;
	walkTime: number;
	facing: Facing;
}

export interface MovementKeys {
	cursors: Phaser.Types.Input.Keyboard.CursorKeys;
	w: Phaser.Input.Keyboard.Key;
	a: Phaser.Input.Keyboard.Key;
	s: Phaser.Input.Keyboard.Key;
	d: Phaser.Input.Keyboard.Key;
}

const CHARACTER_SCALE = 0.125; // asset is @16x a 24x32 logical sprite -> display at 2x logical
const DEFAULT_PLAYER_SPEED = 220;
const PLAYER_DEPTH = 5;

export function createPlayer(
	scene: Phaser.Scene,
	spawn: { x: number; y: number },
	textures: PlayerTextures,
): PlayerHandle {
	const body = scene.add.container(spawn.x, spawn.y).setDepth(PLAYER_DEPTH);
	scene.physics.add.existing(body);
	const physicsBody = body.body as Phaser.Physics.Arcade.Body;
	physicsBody.setSize(24, 16);
	physicsBody.setOffset(-12, 8);
	physicsBody.setCollideWorldBounds(true);

	const sprite = scene.add.sprite(0, 0, textures.front);
	sprite.setScale(CHARACTER_SCALE);
	body.add(sprite);

	return { body, sprite, walkTime: 0, facing: "front" };
}

export function createMovementKeys(scene: Phaser.Scene): MovementKeys {
	const kb = scene.input.keyboard;
	if (!kb) throw new Error("createMovementKeys requires keyboard input");
	return {
		cursors: kb.createCursorKeys(),
		w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
		a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
		s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
		d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
	};
}

export interface MovementResult {
	pos: { x: number; y: number };
	moving: boolean;
}

export function updatePlayerMovement(
	handle: PlayerHandle,
	keys: MovementKeys,
	delta: number,
	textures: PlayerTextures,
	speed = DEFAULT_PLAYER_SPEED,
): MovementResult {
	const body = handle.body.body as Phaser.Physics.Arcade.Body;
	let vx = 0;
	let vy = 0;
	if (keys.cursors.left?.isDown || keys.a.isDown) vx -= 1;
	if (keys.cursors.right?.isDown || keys.d.isDown) vx += 1;
	if (keys.cursors.up?.isDown || keys.w.isDown) vy -= 1;
	if (keys.cursors.down?.isDown || keys.s.isDown) vy += 1;

	const moving = vx !== 0 || vy !== 0;
	if (moving) {
		const len = Math.hypot(vx, vy);
		body.setVelocity((vx / len) * speed, (vy / len) * speed);
		handle.walkTime += delta;

		const facing = facingFromVelocity(vx, vy);
		if (facing !== handle.facing) {
			handle.facing = facing;
			const key =
				facing === "back" && textures.back ? textures.back : textures.front;
			handle.sprite.setTexture(key);
		}
		if (handle.facing === "front") handle.sprite.setFlipX(vx < 0);
	} else {
		body.setVelocity(0, 0);
		handle.walkTime = 0;
	}

	handle.sprite.y = moving ? Math.sin(handle.walkTime * 0.012) * 3 : 0;
	handle.sprite.angle = moving ? Math.sin(handle.walkTime * 0.012) * 4 : 0;

	return { pos: { x: handle.body.x, y: handle.body.y }, moving };
}
