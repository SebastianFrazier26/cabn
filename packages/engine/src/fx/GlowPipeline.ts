import Phaser from "phaser";
import { firstPipeline } from "./firstPipeline.js";
import {
	clampGlowParams,
	DEFAULT_GLOW_PARAMS,
	type GlowParams,
} from "./glowParams.js";
import { GLOW_FRAG_SHADER } from "./glowShader.js";

/**
 * Soft bloom + gentle vignette, attached to a scene's main camera. A single
 * `PostFXPipeline` (see glowShader.ts for why one pass, not two) rather than
 * a Game Object effect — the milestone wants the whole rendered scene to
 * glow, not one sprite.
 */
export class GlowPipeline extends Phaser.Renderer.WebGL.Pipelines
	.PostFXPipeline {
	params: GlowParams = DEFAULT_GLOW_PARAMS;

	constructor(game: Phaser.Game) {
		super({ game, fragShader: GLOW_FRAG_SHADER, name: "GlowPipeline" });
	}

	configure(params: Partial<GlowParams>): void {
		this.params = clampGlowParams(params);
	}

	override onPreRender(): void {
		const width = this.renderer.width || 1;
		const height = this.renderer.height || 1;
		this.set2f(
			"texel",
			this.params.blurRadius / width,
			this.params.blurRadius / height,
		);
		this.set1f("threshold", this.params.threshold);
		this.set1f("bloomIntensity", this.params.bloomIntensity);
		this.set1f("vignetteStrength", this.params.vignetteStrength);
		this.set1f("vignetteRadius", this.params.vignetteRadius);
		this.set3f(
			"tint",
			this.params.tint.r,
			this.params.tint.g,
			this.params.tint.b,
		);
		this.set1f("brightness", this.params.brightness);
	}
}

const GLOW_PIPELINE_KEY = "GlowPipeline";

/**
 * True if `game` can attach a WebGL post-processing pipeline at all — a
 * Canvas-renderer fallback (no WebGL available) skips glow silently rather
 * than throwing, per the milestone's "auto-off ... when WebGL is unavailable"
 * requirement.
 */
export function isGlowSupported(game: Phaser.Game): boolean {
	return game.renderer.type === Phaser.WEBGL;
}

/** Registers the pipeline once per game instance — `addPipeline` throws if called twice with the same key. */
function ensurePipelineRegistered(game: Phaser.Game): void {
	const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
	// `pipelines.has` only checks regular pipelines; post-pipeline classes live in their own map.
	if (!renderer.pipelines.postPipelineClasses.has(GLOW_PIPELINE_KEY)) {
		renderer.pipelines.addPostPipeline(GLOW_PIPELINE_KEY, GlowPipeline);
	}
}

/**
 * Attaches (or updates) the glow pipeline on `camera`. Safe to call every
 * time a scene sets up its camera — a no-op beyond re-configuring params if
 * the pipeline is already attached, and a silent no-op entirely if WebGL
 * isn't available.
 */
export function applyGlow(
	game: Phaser.Game,
	camera: Phaser.Cameras.Scene2D.Camera,
	params: Partial<GlowParams> = {},
): void {
	if (!isGlowSupported(game)) return;
	ensurePipelineRegistered(game);
	let pipeline = firstPipeline(
		camera.getPostPipeline(GLOW_PIPELINE_KEY) as GlowPipeline | GlowPipeline[],
	);
	if (!pipeline) {
		camera.setPostPipeline(GLOW_PIPELINE_KEY);
		pipeline = firstPipeline(
			camera.getPostPipeline(GLOW_PIPELINE_KEY) as
				| GlowPipeline
				| GlowPipeline[],
		);
	}
	pipeline?.configure(params);
}

/**
 * Glow is always on (2026-09-28: the user settings are down to day/night
 * only) — every glow-bearing scene (World/Shelf/File) attaches it once at
 * camera setup, and it silently degrades to nothing wherever WebGL
 * post-pipelines aren't available (isGlowSupported). `params` may be a
 * getter so WorldScene/ShelfScene attach with the live day/night blend
 * rather than whatever preset was current at create().
 */
export function attachGlow(
	scene: Phaser.Scene,
	params: Partial<GlowParams> | (() => Partial<GlowParams>) = {},
): void {
	applyGlow(
		scene.game,
		scene.cameras.main,
		typeof params === "function" ? params() : params,
	);
}

/** Re-pushes params to an already-attached pipeline without attaching one — the per-frame path during a day/night cross-fade; a no-op where glow isn't supported. */
export function updateGlowParams(
	camera: Phaser.Cameras.Scene2D.Camera,
	params: Partial<GlowParams>,
): void {
	const pipeline = firstPipeline(
		camera.getPostPipeline(GLOW_PIPELINE_KEY) as GlowPipeline | GlowPipeline[],
	);
	pipeline?.configure(params);
}
