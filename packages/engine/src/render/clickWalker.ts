import Phaser from "phaser";
import { PALETTE } from "../palette.js";
import {
	type Bounds,
	type ClickTarget,
	type Interactable,
	type Point,
	type ProgressWatch,
	resolveClickTarget,
	startProgressWatch,
	steerToward,
	trackProgress,
} from "../systems/clickWalk.js";
import {
	applyPlayerMotion,
	DEFAULT_PLAYER_SPEED,
	type MoveIntent,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
	readKeyboardIntent,
} from "./playerController.js";

const SPARKLE_TEXTURE_KEY = "cabn-click-sparkle";
const SPARKLE_SCALE = 4;
// Above the night grade (atmosphere.ts GRADE_DEPTH 5.5) and light pools (5.6)
// so the marker stays readable at night; it's gone by the time the player
// (depth 5) stands on it, so drawing over the player briefly doesn't matter.
const MARKER_DEPTH = 5.65;
const GROUND_ARRIVE_RADIUS = 4;

// A 7x7 four-point star (gold arms, cream core) with a 1px ink outline added
// around it, so it reads on bright day grass as well as at night — drawn once
// into a texture rather than shipped as art, same placeholder-first approach
// as the ✎ marker.
const SPARKLE_ROWS = [
	"...g...",
	"...g...",
	"..gcg..",
	"ggcccgg",
	"..gcg..",
	"...g...",
	"...g...",
];

function ensureSparkleTexture(scene: Phaser.Scene): void {
	if (scene.textures.exists(SPARKLE_TEXTURE_KEY)) return;
	const size = SPARKLE_ROWS.length + 2;
	const filled = (x: number, y: number): boolean => {
		const ch = SPARKLE_ROWS[y - 1]?.[x - 1];
		return ch !== undefined && ch !== ".";
	};
	const g = scene.make.graphics(undefined, false);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (filled(x, y)) {
				const ch = SPARKLE_ROWS[y - 1]?.[x - 1];
				g.fillStyle(ch === "c" ? PALETTE.cream : PALETTE.gold, 1);
			} else if (
				filled(x - 1, y) ||
				filled(x + 1, y) ||
				filled(x, y - 1) ||
				filled(x, y + 1)
			) {
				g.fillStyle(PALETTE.ink, 1);
			} else {
				continue;
			}
			g.fillRect(x, y, 1, 1);
		}
	}
	g.generateTexture(SPARKLE_TEXTURE_KEY, size, size);
	g.destroy();
}

interface WalkGoal {
	point: Point;
	arriveRadius: number;
	speed: number;
	target: Interactable | null;
}

export interface WalkUpdate {
	/** Movement to feed applyPlayerMotion this frame, or null when not walking. */
	intent: MoveIntent | null;
	speed: number;
	/** Set on the frame a walk toward an interactable arrives — the scene interacts with it. */
	arrivedAt: Interactable | null;
}

/**
 * Drives click-to-move for one scene: holds the current goal, steers toward
 * it (systems/clickWalk.ts), shows the sparkle marker, and gives up when the
 * progress watchdog says the body stopped making headway. The scene owns
 * everything else — resolving what was clicked, cancelling on keyboard
 * input, and what "interact" means on arrival.
 */
export class ClickWalker {
	private goal: WalkGoal | null = null;
	private watch: ProgressWatch | null = null;
	private readonly marker: Phaser.GameObjects.Image;
	private markerTween: Phaser.Tweens.Tween | null = null;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly reducedMotion: boolean,
	) {
		ensureSparkleTexture(scene);
		this.marker = scene.add
			.image(0, 0, SPARKLE_TEXTURE_KEY)
			.setScale(SPARKLE_SCALE)
			.setDepth(MARKER_DEPTH)
			.setVisible(false);
	}

	get walking(): boolean {
		return this.goal !== null;
	}

	walkTo(
		point: Point,
		options: {
			from: Point;
			speed: number;
			target?: Interactable;
			showMarker?: boolean;
		},
	): void {
		const target = options.target ?? null;
		this.goal = {
			point: { ...point },
			arriveRadius: target?.arriveRadius ?? GROUND_ARRIVE_RADIUS,
			speed: options.speed,
			target,
		};
		this.watch = startProgressWatch(options.from);
		if (options.showMarker ?? true) this.showMarker(point);
		else this.hideMarker();
	}

	cancel(): void {
		this.goal = null;
		this.watch = null;
		this.hideMarker();
	}

	update(pos: Point, deltaMs: number): WalkUpdate {
		const goal = this.goal;
		if (!goal) return { intent: null, speed: 0, arrivedAt: null };

		const { arrived, velocity } = steerToward(
			pos,
			goal.point,
			goal.arriveRadius,
			goal.speed,
			deltaMs,
		);
		if (arrived) {
			this.cancel();
			return { intent: null, speed: goal.speed, arrivedAt: goal.target };
		}

		if (this.watch) {
			const progress = trackProgress(this.watch, pos, deltaMs);
			this.watch = progress.watch;
			if (progress.stuck) {
				this.cancel();
				return { intent: null, speed: goal.speed, arrivedAt: null };
			}
		}
		return { intent: velocity, speed: goal.speed, arrivedAt: null };
	}

	destroy(): void {
		this.markerTween?.stop();
		this.marker.destroy();
	}

	private showMarker(point: Point): void {
		this.markerTween?.stop();
		this.markerTween = null;
		this.marker
			.setPosition(point.x, point.y)
			.setScale(SPARKLE_SCALE)
			.setAlpha(1)
			.setAngle(0)
			.setVisible(true);
		if (this.reducedMotion) return;
		this.markerTween = this.scene.tweens.add({
			targets: this.marker,
			scale: SPARKLE_SCALE * 0.75,
			alpha: 0.8,
			angle: 45,
			duration: 360,
			yoyo: true,
			repeat: -1,
			ease: "Sine.easeInOut",
		});
	}

	private hideMarker(): void {
		this.markerTween?.stop();
		this.markerTween = null;
		this.marker.setVisible(false);
	}
}

/**
 * One frame of player movement shared by every walkable scene: keyboard wins
 * and cancels any click-walk in progress (the user decision was "keyboard
 * input cancels click-walking"); otherwise the walker steers. Returns the
 * interactable a click-walk just arrived at, if any, for the scene to act on.
 */
export function drivePlayer(
	handle: PlayerHandle,
	keys: MovementKeys,
	walker: ClickWalker,
	deltaMs: number,
	textures: PlayerTextures,
): { pos: Point; arrivedAt: Interactable | null } {
	const keyIntent = readKeyboardIntent(keys);
	const keyboardActive = keyIntent.x !== 0 || keyIntent.y !== 0;
	if (keyboardActive) walker.cancel();
	const walk = keyboardActive
		? null
		: walker.update({ x: handle.body.x, y: handle.body.y }, deltaMs);
	const { pos } = walk?.intent
		? applyPlayerMotion(handle, walk.intent, deltaMs, textures, walk.speed)
		: applyPlayerMotion(
				handle,
				keyIntent,
				deltaMs,
				textures,
				DEFAULT_PLAYER_SPEED,
			);
	return { pos, arrivedAt: walk?.arrivedAt ?? null };
}

/** The arcade world's bounds, for clampToBounds — a ground click past them would otherwise walk into the edge until the progress watchdog gave up. */
export function physicsBounds(scene: Phaser.Scene): Bounds {
	const b = scene.physics.world.bounds;
	return { minX: b.x, minY: b.y, maxX: b.right, maxY: b.bottom };
}

/** Half the player's physics body width (playerController's setSize(24, 16)) plus a little air — keeps a clamped goal reachable by the body's centre. */
export const BOUNDS_INSET_PX = 16;

export interface PointerInputOptions {
	interactables(): readonly Interactable[];
	/** False while the scene shouldn't take clicks (a file open over the world, an editor, a transition in progress). */
	enabled(): boolean;
	onClick(target: ClickTarget): void;
}

export interface PointerInputHandle {
	/** Re-evaluates the hover cursor against the pointer's current position — call once per frame, since the camera moving under a still pointer changes what's under it without any pointer event. */
	refreshHover(): void;
	destroy(): void;
}

/**
 * Left-click on the canvas -> onClick with whatever's under the pointer, and
 * a pointer cursor while hovering an interactable. Clicks on React panels
 * never get here: Phaser's scene-level pointerdown only fires for events
 * whose target is the game canvas, and every panel sits over the canvas as
 * its own element (the downElement check is belt-and-braces for that).
 * Hit-testing runs against scene-supplied Interactables rather than Phaser's
 * setInteractive on each sprite, so it doesn't care which sprite (or how big
 * an arch) a scene draws for a portal.
 */
export function attachPointerInput(
	scene: Phaser.Scene,
	options: PointerInputOptions,
): PointerInputHandle {
	const canvas = scene.game.canvas;
	let cursor = "";

	const worldPoint = (pointer: Phaser.Input.Pointer): Point => {
		const p = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
		return { x: p.x, y: p.y };
	};

	const setCursor = (next: string): void => {
		if (next === cursor) return;
		cursor = next;
		canvas.style.cursor = next;
	};

	const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
		if (pointer.button !== 0) return;
		if (pointer.downElement && pointer.downElement !== canvas) return;
		if (!options.enabled()) return;
		options.onClick(
			resolveClickTarget(worldPoint(pointer), options.interactables()),
		);
	};

	scene.input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown);

	const refreshHover = (): void => {
		const pointer = scene.input.activePointer;
		if (!options.enabled() || !scene.input.isOver) {
			setCursor("");
			return;
		}
		const target = resolveClickTarget(
			worldPoint(pointer),
			options.interactables(),
		);
		setCursor(target.kind === "interactable" ? "pointer" : "");
	};

	const clearCursor = (): void => setCursor("");
	const destroy = (): void => {
		scene.input.off(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
		scene.events.off(Phaser.Scenes.Events.SLEEP, clearCursor);
		setCursor("");
	};
	scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
	scene.events.on(Phaser.Scenes.Events.SLEEP, clearCursor);

	return { refreshHover, destroy };
}
