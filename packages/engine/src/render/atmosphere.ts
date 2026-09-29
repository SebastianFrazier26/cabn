import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { FX_SPARK_KEY } from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import { attachGlow, updateGlowParams } from "../fx/GlowPipeline.js";
import {
	DAY_GLOW_PARAMS,
	lerpGlowParams,
	NIGHT_GLOW_PARAMS,
} from "../fx/glowParams.js";
import {
	DAY_NIGHT_CROSSFADE_MS,
	easeBlend,
	gradeColorAt,
	stepBlend,
	targetBlend,
} from "../systems/dayNight.js";
import {
	createLightPool,
	type LightPool,
	type LightPoolOptions,
	poolFlicker,
	updateLightPool,
} from "./lightPools.js";

/** Above everything that should be darkened at night (ground 0 .. player 5), below the additive light pools (5.6) and the sky/stars (see skyline.ts). */
export const GRADE_DEPTH = 5.5;

/** How much wider than its warm glow a light's "revealed" (un-darkened) area is — the hole is what makes a lamp read as lighting the ground around it, the additive pool only warms the middle. */
const HOLE_RADIUS_RATIO = 1.8;
const HOLE_STRENGTH = 0.9;
/**
 * Multiply alone can only scale channels, and this world's grass is so
 * saturated green that any multiply dark enough to read as night still leaves
 * it green. A second, normal-blend layer of deep indigo at partial alpha
 * pulls every hue toward blue-violet (a desaturate-and-tint the multiply
 * can't do). Same holes as the grade, so lit areas keep their true color.
 */
const WASH_COLOR = 0x151a45;
const WASH_ALPHA = 0.42;
/** Screen-space layers overhang the viewport by this much so a sub-pixel camera position never exposes an ungraded row at an edge. */
const OVERHANG_PX = 2;

export interface AtmosphereOptions {
	lights: readonly LightPoolOptions[];
	reducedMotion: boolean;
}

export type BlendListener = (blend: number) => void;

export interface AtmosphereHandle {
	/** Eased 0 (day) .. 1 (night) — what every day/night-aware layer should read. */
	blend(): number;
	/** Called immediately with the current blend, then on every change (every frame during a cross-fade, never otherwise). */
	onBlend(listener: BlendListener): void;
	destroy(): void;
}

/**
 * The scene's day/night owner. Before 2026-09-28 night was a tint +
 * brightness uniform inside the glow post-fx shader only, so switching glow
 * off (a settings toggle, the reduced-motion default, or any Canvas-renderer
 * fallback) removed night entirely, and even with glow on it only dimmed the
 * frame to a darker green. Night is now a screen-space RenderTexture drawn
 * over the world with MULTIPLY blend — renderer-agnostic and independent of
 * the post-fx — refilled every frame with the grade color, with soft holes
 * erased at every light so lamps, windows and the bonfire reveal the scene
 * around them instead of just adding a glow sprite on top of darkness.
 *
 * Redrawn from the camera's FOLLOW_UPDATE event (emitted inside preRender,
 * after the follow lerp has moved the camera) rather than the scene's
 * update(): update() runs before the camera moves, so holes computed there
 * lag the world by one lerp step and visibly swim while walking.
 */
export function attachAtmosphere(
	scene: Phaser.Scene,
	store: StoreApi<CabnStore>,
	options: AtmosphereOptions,
): AtmosphereHandle {
	const camera = scene.cameras.main;
	let rawBlend = targetBlend(store.getState().timeOfDay);
	let eased = easeBlend(rawBlend);
	const listeners: BlendListener[] = [];

	const pools: LightPool[] = options.lights.map((light, i) =>
		createLightPool(scene, light, i),
	);

	const makeLayer = (depth: number, blendMode: Phaser.BlendModes) =>
		scene.add
			.renderTexture(
				-OVERHANG_PX,
				-OVERHANG_PX,
				Math.max(1, scene.scale.width + OVERHANG_PX * 2),
				Math.max(1, scene.scale.height + OVERHANG_PX * 2),
			)
			.setOrigin(0, 0)
			.setScrollFactor(0)
			.setDepth(depth)
			.setBlendMode(blendMode);
	const grade = makeLayer(GRADE_DEPTH, Phaser.BlendModes.MULTIPLY);
	const wash = makeLayer(GRADE_DEPTH + 0.01, Phaser.BlendModes.NORMAL);
	// pixelArt mode makes every texture nearest-filtered; a 16px soft dot
	// scaled up 15x for a bonfire's light then renders as a grid of hard
	// squares. The spark is the one deliberately smooth texture (see
	// assetPaths.ts's FX_SPARK_KEY comment), so it opts back into linear.
	scene.textures.get(FX_SPARK_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
	const eraser = scene.make.image({ key: FX_SPARK_KEY }, false);

	const glowParams = () =>
		lerpGlowParams(DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS, eased);
	attachGlow(scene, glowParams);

	const redraw = (): void => {
		const now = scene.time.now;
		const view = camera.worldView;
		const zoom = camera.zoom || 1;
		grade.clear();
		grade.fill(gradeColorAt(rawBlend), 1);
		wash.clear();
		wash.setVisible(eased > 0.001);
		if (eased > 0.001) wash.fill(WASH_COLOR, WASH_ALPHA * eased);
		for (const pool of pools) {
			const flicker = poolFlicker(pool, now, options.reducedMotion);
			updateLightPool(pool, eased, flicker);
			if (eased <= 0.001) continue;
			const radius = pool.opts.radiusPx * HOLE_RADIUS_RATIO * zoom;
			const sx = (pool.opts.x - view.x) * zoom + OVERHANG_PX;
			const sy = (pool.opts.y - view.y) * zoom + OVERHANG_PX;
			if (
				sx < -radius ||
				sy < -radius ||
				sx > grade.width + radius ||
				sy > grade.height + radius
			) {
				continue;
			}
			eraser
				.setScale(pool.baseScale * HOLE_RADIUS_RATIO * zoom * flicker)
				.setAlpha(
					HOLE_STRENGTH * (pool.opts.holeStrength ?? 1) * eased * flicker,
				);
			grade.erase(eraser, sx, sy);
			wash.erase(eraser, sx, sy);
		}
	};

	const notify = (): void => {
		for (const listener of listeners) listener(eased);
		updateGlowParams(camera, glowParams());
	};

	const onUpdate = (_time: number, delta: number): void => {
		const target = targetBlend(store.getState().timeOfDay);
		if (rawBlend === target) return;
		rawBlend = stepBlend(
			rawBlend,
			target,
			delta,
			DAY_NIGHT_CROSSFADE_MS,
			options.reducedMotion,
		);
		eased = easeBlend(rawBlend);
		notify();
	};

	const onResize = (size: Phaser.Structs.Size): void => {
		for (const layer of [grade, wash]) {
			layer.resize(
				Math.max(1, size.width + OVERHANG_PX * 2),
				Math.max(1, size.height + OVERHANG_PX * 2),
			);
		}
		redraw();
	};

	scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
	camera.on(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, redraw);
	scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
	redraw();

	return {
		blend: () => eased,
		onBlend: (listener) => {
			listeners.push(listener);
			listener(eased);
		},
		destroy: () => {
			scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
			camera.off(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, redraw);
			scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
			for (const pool of pools) pool.sprite.destroy();
			eraser.destroy();
			grade.destroy();
			wash.destroy();
			listeners.length = 0;
		},
	};
}
