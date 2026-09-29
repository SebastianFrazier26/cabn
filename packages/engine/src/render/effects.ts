import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";
import type { TimeOfDay } from "../systems/timeOfDay.js";
import type { WorldParticleSkin } from "../systems/worldLayer.js";

export interface EffectBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface WorldEffectsOptions {
	bounds: EffectBounds;
	timeOfDay: TimeOfDay;
	bonfirePos?: { x: number; y: number };
	chimneyPositions?: readonly { x: number; y: number }[];
	/** Skips motion (or substitutes a static equivalent) per effect — see each create* function's own comment for which it does. Injectable so tests don't need a real `window.matchMedia`; scene call sites pass `prefersReducedMotion()` from systems/reducedMotion.ts. */
	reducedMotion: boolean;
	/** A world skin's particle colours; omitted, today's. */
	particles?: WorldParticleSkin | null;
}

export interface WorldEffectsHandle {
	destroy(): void;
}

const AMBIENT_DEPTH = 6; // above the player (5) — fireflies/motes drift in front of everything
const EMBER_DEPTH = 5.7; // above the night grade (render/atmosphere.ts) so embers glow instead of being darkened with the scene
const SMOKE_DEPTH = 4.5;

export const DEFAULT_PARTICLES: WorldParticleSkin = {
	firefly: 0xffe9a8,
	mote: 0xeaf2d0,
	embers: [0xffb04a, 0xff7a3c],
	smoke: 0xcfd0c8,
	dust: 0xc8b89a,
};

function randomInBounds(bounds: EffectBounds) {
	return {
		x: { min: bounds.minX, max: bounds.maxX },
		y: { min: bounds.minY, max: bounds.maxY },
	};
}

/** Warm drifting dots at night — a few static ones (no motion) under reduced-motion rather than cut entirely, since a still firefly is still recognizably "fireflies are around tonight". */
function createFireflies(
	scene: Phaser.Scene,
	bounds: EffectBounds,
	reducedMotion: boolean,
	color: number,
): Phaser.GameObjects.GameObject {
	if (reducedMotion) {
		const container = scene.add.container(0, 0);
		for (let i = 0; i < 6; i++) {
			const x = Phaser.Math.Between(bounds.minX, bounds.maxX);
			const y = Phaser.Math.Between(bounds.minY, bounds.maxY);
			const dot = scene.add.image(x, y, FX_SPARK_KEY);
			dot
				.setTint(color)
				.setBlendMode(Phaser.BlendModes.ADD)
				.setScale(0.6)
				.setAlpha(0.7);
			container.add(dot);
		}
		container.setDepth(AMBIENT_DEPTH);
		return container;
	}

	const pos = randomInBounds(bounds);
	const emitter = scene.add.particles(0, 0, FX_SPARK_KEY, {
		x: pos.x,
		y: pos.y,
		lifespan: { min: 4000, max: 8000 },
		speedX: { min: -10, max: 10 },
		speedY: { min: -10, max: 10 },
		scale: { start: 0.7, end: 0.2 },
		alpha: { start: 0, end: 0.8, ease: "Sine.easeInOut" },
		tint: color,
		blendMode: Phaser.BlendModes.ADD,
		frequency: 450,
		quantity: 1,
	});
	emitter.setDepth(AMBIENT_DEPTH);
	return emitter;
}

/** Pale drifting motes by day — cut entirely under reduced motion (unlike fireflies, a "static mote" doesn't read as anything in particular). */
function createDayMotes(
	scene: Phaser.Scene,
	bounds: EffectBounds,
	color: number,
): Phaser.GameObjects.Particles.ParticleEmitter {
	const pos = randomInBounds(bounds);
	const emitter = scene.add.particles(0, 0, FX_SPARK_KEY, {
		x: pos.x,
		y: pos.y,
		lifespan: { min: 5000, max: 9000 },
		speedX: { min: -6, max: 6 },
		speedY: { min: 4, max: 14 },
		scale: { start: 0.35, end: 0.15 },
		alpha: { start: 0, end: 0.35, ease: "Sine.easeInOut" },
		tint: color,
		frequency: 600,
		quantity: 1,
	});
	emitter.setDepth(AMBIENT_DEPTH);
	return emitter;
}

function createEmbers(
	scene: Phaser.Scene,
	pos: { x: number; y: number },
	colors: readonly number[],
): Phaser.GameObjects.Particles.ParticleEmitter {
	const emitter = scene.add.particles(pos.x, pos.y, FX_SPARK_KEY, {
		lifespan: { min: 900, max: 1600 },
		speedY: { min: -40, max: -18 },
		speedX: { min: -8, max: 8 },
		scale: { start: 0.5, end: 0 },
		alpha: { start: 0.9, end: 0 },
		tint: [...colors],
		blendMode: Phaser.BlendModes.ADD,
		frequency: 220,
		quantity: 1,
	});
	emitter.setDepth(EMBER_DEPTH);
	return emitter;
}

function createChimneySmoke(
	scene: Phaser.Scene,
	pos: { x: number; y: number },
	color: number,
): Phaser.GameObjects.Particles.ParticleEmitter {
	const emitter = scene.add.particles(pos.x, pos.y, FX_SPARK_KEY, {
		lifespan: { min: 2200, max: 3400 },
		speedY: { min: -14, max: -6 },
		speedX: { min: -4, max: 4 },
		scale: { start: 0.5, end: 1.4 },
		alpha: { start: 0.35, end: 0 },
		tint: color,
		frequency: 900,
		quantity: 1,
	});
	emitter.setDepth(SMOKE_DEPTH);
	return emitter;
}

/**
 * Cheap ambient particle layer: fireflies at night or drifting motes by day
 * across the whole scene (one emitter, capped by lifespan/frequency rather
 * than an unbounded quantity), plus bonfire embers and one chimney-smoke
 * emitter per cottage, if positions are given. Every emitter shares
 * FX_SPARK_KEY (see assetPaths.ts) — see that file's doc comment for why one
 * texture, tinted/scaled differently, rather than one per effect.
 */
export function attachWorldEffects(
	scene: Phaser.Scene,
	options: WorldEffectsOptions,
): WorldEffectsHandle {
	const objects: Phaser.GameObjects.GameObject[] = [];
	const colors = options.particles ?? DEFAULT_PARTICLES;

	if (options.timeOfDay === "night") {
		objects.push(
			createFireflies(
				scene,
				options.bounds,
				options.reducedMotion,
				colors.firefly,
			),
		);
	} else if (!options.reducedMotion) {
		objects.push(createDayMotes(scene, options.bounds, colors.mote));
	}

	if (options.bonfirePos && !options.reducedMotion) {
		objects.push(createEmbers(scene, options.bonfirePos, colors.embers));
	}
	if (!options.reducedMotion) {
		for (const pos of options.chimneyPositions ?? []) {
			objects.push(createChimneySmoke(scene, pos, colors.smoke));
		}
	}

	return {
		destroy: () => {
			for (const object of objects) object.destroy();
		},
	};
}

/** A slow alpha pulse on a lit prop (lamp post, cottage window) — skipped entirely under reduced motion rather than a static/reduced variant, same as day motes: a flicker *is* the motion, there's no meaningful still version of it. */
export function attachLanternFlicker(
	scene: Phaser.Scene,
	sprite: Phaser.GameObjects.Image,
	reducedMotion: boolean,
): void {
	if (reducedMotion) return;
	scene.tweens.add({
		targets: sprite,
		alpha: { from: 1, to: 0.86 },
		duration: Phaser.Math.Between(900, 1600),
		yoyo: true,
		repeat: -1,
		ease: "Sine.easeInOut",
	});
}
