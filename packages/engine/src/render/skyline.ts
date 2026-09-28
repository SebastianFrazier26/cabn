import Phaser from "phaser";
import {
	FX_SPARK_KEY,
	SKY_DAY_KEY,
	SKY_MOON_KEY,
	SKY_NIGHT_KEY,
	SKY_STAR_KEY,
	SKYLINE_PIECES,
	skylineKey,
} from "../assetPaths.js";
import { hashStringSeed, mulberry32 } from "../systems/deterministicRandom.js";
import {
	LAYER_SCROLL_FACTOR,
	parallaxCenter,
	planSkyline,
	type SkylineLayer,
	type SkylinePieceName,
} from "../systems/skylineLayout.js";
import type { AtmosphereHandle } from "./atmosphere.js";

/** How far above the world's top bound the sky band reaches — the camera's bounds grow upward by this much so walking to the north edge reveals it. */
export const SKY_BAND_HEIGHT_PX = 340;
/** How far below the top bound the horizon (treeline base) sits — the band overlaps the top of the ground so the treeline stands on it instead of floating over a seam. */
export const HORIZON_OVERLAP_PX = 44;

/**
 * Above the night grade (5.5) and light pools (5.6): the sky has its own
 * hand-made night variants (a darkened copy with lit windows, a navy
 * gradient, moon and stars) that must not be multiplied down a second time.
 * That's also why it sits above the player — physics bounds keep the player
 * below the horizon (see WorldScene/ShelfScene setupCamera), so nothing
 * walkable is ever hidden by it.
 */
const SKY_DEPTH = 5.8;
const LAYER_DEPTH: Readonly<Record<SkylineLayer, number>> = {
	far: SKY_DEPTH + 0.03,
	mid: SKY_DEPTH + 0.05,
	near: SKY_DEPTH + 0.07,
};
/** Bottom of each layer's pieces relative to the horizon — far pieces sink a little behind the hills, hills sink behind the treeline. */
const LAYER_BASE_OFFSET: Readonly<Record<SkylineLayer, number>> = {
	far: -52,
	mid: -12,
	near: 6,
};
const STAR_COUNT = 46;
const STAR_SCROLL_FACTOR = 0.12;
const MOON_SCROLL_FACTOR = 0.08;
/** A generous stand-in for the viewport width when laying out parallax spans, so a later window resize never exposes a layer's end. */
const MIN_LAYOUT_VIEW_WIDTH = 2200;

export interface SkylineOptions {
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
	seed: string;
	atmosphere: AtmosphereHandle;
	reducedMotion: boolean;
}

export interface SkylineHandle {
	destroy(): void;
}

/**
 * The distant kingdom on the horizon. Placed along the world's *top* edge
 * only: cabn's camera is a 3/4 top-down view (sprites show their south
 * faces, "up" on screen is away from the viewer), so the only direction in
 * which a far-off horizon makes spatial sense is north. A skyline down the
 * left/right edges would have to be drawn sideways, and one along the bottom
 * would sit between the viewer and the world. The other three edges are
 * closed off by the dense border forest instead (systems/edgeScenery.ts).
 *
 * Every day-art piece has a night twin at the same position, drawn on top at
 * alpha = blend; the day piece stays fully opaque underneath so the
 * cross-fade never dips to half-transparent and shows the sky through a
 * building mid-fade.
 */
export function attachSkyline(
	scene: Phaser.Scene,
	opts: SkylineOptions,
): SkylineHandle {
	const { bounds } = opts;
	const horizonY = bounds.minY + HORIZON_OVERLAP_PX;
	const skyTop = bounds.minY - SKY_BAND_HEIGHT_PX;
	const viewWidth = Math.max(scene.scale.width, MIN_LAYOUT_VIEW_WIDTH);
	const scrollMin = bounds.minX;
	const scrollMax = Math.max(bounds.minX, bounds.maxX - scene.scale.width);
	const objects: Phaser.GameObjects.GameObject[] = [];
	const nightTwins: Phaser.GameObjects.Image[] = [];
	const dayOnly: { image: Phaser.GameObjects.Image; alpha: number }[] = [];

	for (const key of [SKY_DAY_KEY, SKY_NIGHT_KEY]) {
		scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
	}
	// Screen-locked horizontally (the gradient is uniform across x), world-
	// locked vertically so it stays pinned above the top bound.
	const skyWidth = viewWidth * 2;
	const skyHeight = horizonY - skyTop + 4;
	const skyDay = scene.add
		.image(-viewWidth / 2, skyTop, SKY_DAY_KEY)
		.setOrigin(0, 0)
		.setDisplaySize(skyWidth, skyHeight)
		.setScrollFactor(0, 1)
		.setDepth(SKY_DEPTH);
	const skyNight = scene.add
		.image(-viewWidth / 2, skyTop, SKY_NIGHT_KEY)
		.setOrigin(0, 0)
		.setDisplaySize(skyWidth, skyHeight)
		.setScrollFactor(0, 1)
		.setDepth(SKY_DEPTH + 0.001);
	objects.push(skyDay, skyNight);
	nightTwins.push(skyNight);

	const rand = mulberry32(hashStringSeed(`sky:${opts.seed}`));
	const screenCenter = (sf: number) =>
		parallaxCenter(scrollMin, scrollMax, scene.scale.width, sf);

	const sun = scene.add
		.image(
			screenCenter(MOON_SCROLL_FACTOR) - scene.scale.width * 0.28,
			skyTop + 90,
			FX_SPARK_KEY,
		)
		.setScrollFactor(MOON_SCROLL_FACTOR, 1)
		.setDepth(SKY_DEPTH + 0.01)
		.setBlendMode(Phaser.BlendModes.ADD)
		.setTint(0xfff0b8)
		.setScale(16);
	objects.push(sun);
	dayOnly.push({ image: sun, alpha: 0.55 });

	const moon = scene.add
		.image(
			screenCenter(MOON_SCROLL_FACTOR) + scene.scale.width * 0.26,
			skyTop + 84,
			SKY_MOON_KEY,
		)
		.setScrollFactor(MOON_SCROLL_FACTOR, 1)
		.setDepth(SKY_DEPTH + 0.02);
	const moonHalo = scene.add
		.image(moon.x, moon.y, FX_SPARK_KEY)
		.setScrollFactor(MOON_SCROLL_FACTOR, 1)
		.setDepth(SKY_DEPTH + 0.015)
		.setBlendMode(Phaser.BlendModes.ADD)
		.setTint(0xb8c8ff)
		.setScale(11);
	objects.push(moon, moonHalo);
	nightTwins.push(moon);

	const stars: {
		image: Phaser.GameObjects.Image;
		phase: number;
		speed: number;
	}[] = [];
	const starSpanLo = screenCenter(STAR_SCROLL_FACTOR) - viewWidth;
	for (let i = 0; i < STAR_COUNT; i++) {
		const image = scene.add
			.image(
				starSpanLo + rand() * viewWidth * 2,
				skyTop + 12 + rand() * (SKY_BAND_HEIGHT_PX - 150),
				SKY_STAR_KEY,
			)
			.setScrollFactor(STAR_SCROLL_FACTOR, 1)
			.setDepth(SKY_DEPTH + 0.012)
			.setScale(0.5 + rand() * 0.6);
		stars.push({
			image,
			phase: rand() * Math.PI * 2,
			speed: 0.0015 + rand() * 0.003,
		});
		objects.push(image);
	}

	const widths = {} as Record<SkylinePieceName, number>;
	for (const piece of SKYLINE_PIECES) {
		widths[piece] = (
			scene.textures.get(skylineKey(piece, "day")).getSourceImage() as {
				width: number;
			}
		).width;
	}
	const elements = planSkyline({
		seed: opts.seed,
		scrollMin,
		scrollMax,
		viewWidth,
		widths,
	});
	for (const el of elements) {
		const sf = LAYER_SCROLL_FACTOR[el.layer];
		const y = horizonY + LAYER_BASE_OFFSET[el.layer];
		for (const variant of ["day", "night"] as const) {
			const image = scene.add
				.image(el.u, y, skylineKey(el.piece, variant))
				.setOrigin(0.5, 1)
				.setScale(el.scale)
				.setFlipX(el.flipX)
				.setScrollFactor(sf, 1)
				.setDepth(LAYER_DEPTH[el.layer] + (variant === "night" ? 0.001 : 0));
			objects.push(image);
			if (variant === "night") nightTwins.push(image);
		}
	}

	let blend = 0;
	const applyStars = (timeMs: number): void => {
		for (const star of stars) {
			const twinkle = opts.reducedMotion
				? 0.85
				: 0.55 + 0.45 * Math.sin(timeMs * star.speed + star.phase);
			star.image.setVisible(blend > 0.001).setAlpha(blend * twinkle);
		}
	};
	opts.atmosphere.onBlend((b) => {
		blend = b;
		for (const twin of nightTwins) twin.setVisible(b > 0.001).setAlpha(b);
		moonHalo.setVisible(b > 0.001).setAlpha(b * 0.35);
		for (const { image, alpha } of dayOnly) {
			image.setVisible(b < 0.999).setAlpha((1 - b) * alpha);
		}
		applyStars(scene.time.now);
	});
	const onUpdate = (time: number): void => {
		if (blend > 0.001 && !opts.reducedMotion) applyStars(time);
	};
	scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

	return {
		destroy: () => {
			scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
			for (const object of objects) object.destroy();
		},
	};
}
