import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { firstPipeline } from "./firstPipeline.js";
import {
	clampGlowParams,
	DAY_GLOW_PARAMS,
	DEFAULT_GLOW_PARAMS,
	type GlowParams,
	NIGHT_GLOW_PARAMS,
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

export function removeGlow(camera: Phaser.Cameras.Scene2D.Camera): void {
	camera.removePostPipeline(GLOW_PIPELINE_KEY);
}

/** The one entry point every scene's camera setup + store subscription calls: attach/update or detach the pipeline in one place instead of each scene branching on `enabled` itself. */
export function syncGlow(
	game: Phaser.Game,
	camera: Phaser.Cameras.Scene2D.Camera,
	enabled: boolean,
	params: Partial<GlowParams> = {},
): void {
	if (enabled) applyGlow(game, camera, params);
	else removeGlow(camera);
}

/**
 * Every glow-bearing scene (World/Shelf/File) wants the same three lines —
 * sync once immediately, keep syncing when the store's `glowEnabled` toggle
 * changes, stop on shutdown — so this is the one place that logic lives
 * rather than copy-pasted into three scenes' create()/teardown pairs. Call
 * once from `create()` (after the camera exists) and call the returned
 * cleanup from the scene's own shutdown handler, same shape as every other
 * `store.subscribe` in this codebase.
 */
export function attachGlowLifecycle(
	scene: Phaser.Scene,
	store: StoreApi<CabnStore>,
	params: Partial<GlowParams> = {},
): () => void {
	const camera = scene.cameras.main;
	syncGlow(scene.game, camera, store.getState().glowEnabled, params);
	return store.subscribe((state, prev) => {
		if (state.glowEnabled === prev.glowEnabled) return;
		syncGlow(scene.game, camera, state.glowEnabled, params);
	});
}

/**
 * WorldScene/ShelfScene's call site: attachGlowLifecycle with whichever of
 * DAY_GLOW_PARAMS/NIGHT_GLOW_PARAMS matches store.timeOfDay right now, *and*
 * re-syncs live if timeOfDay changes mid-session (the settings override, or
 * "auto" crossing the clock boundary — see game.ts's periodic
 * refreshTimeOfDay) — attachGlowLifecycle itself only reacts to glowEnabled,
 * so this adds a second small subscription rather than complicating that
 * more general helper's signature for a day/night concern only these two
 * scenes have.
 */
export function attachTimeOfDayGlow(
	scene: Phaser.Scene,
	store: StoreApi<CabnStore>,
): () => void {
	const paramsFor = (timeOfDay: CabnStore["timeOfDay"]): GlowParams =>
		timeOfDay === "night" ? NIGHT_GLOW_PARAMS : DAY_GLOW_PARAMS;

	const unsubscribeLifecycle = attachGlowLifecycle(
		scene,
		store,
		paramsFor(store.getState().timeOfDay),
	);
	const unsubscribeTimeOfDay = store.subscribe((state, prev) => {
		if (state.timeOfDay === prev.timeOfDay) return;
		syncGlow(
			scene.game,
			scene.cameras.main,
			state.glowEnabled,
			paramsFor(state.timeOfDay),
		);
	});

	return () => {
		unsubscribeLifecycle();
		unsubscribeTimeOfDay();
	};
}
