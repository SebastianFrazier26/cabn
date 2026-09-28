/**
 * Tunables for GlowPipeline's bright-pass -> blur -> additive-mix -> vignette
 * chain. Kept as a plain param object (not baked into the shader as
 * constants) so SettingsCorner's on/off toggle — the only knob exposed to
 * players — can flip `bloomIntensity`/`vignetteStrength` to 0 without
 * detaching the pipeline, and so a future settings panel has somewhere to
 * plug in without touching GLSL.
 */
export interface GlowParams {
	/** Luminance above which a pixel contributes to the bloom (0-1) — higher = only the brightest highlights glow. */
	threshold: number;
	/** Blur sample spread in pixels — larger reads as a softer, wider glow. */
	blurRadius: number;
	/** How much of the blurred bright-pass gets added back (0-1-ish; can exceed 1 for a hotter glow, clamped below to keep whites from blowing out). */
	bloomIntensity: number;
	/** Vignette darkening at the screen edge (0 = none, 1 = fully black corners). */
	vignetteStrength: number;
	/** Fraction of the screen radius where the vignette starts fading in (0-1). */
	vignetteRadius: number;
	/** Per-channel multiplier applied to the whole frame before bloom/vignette — {1,1,1} is neutral. M10b batch 2's day/night color grading: a warm (r,g up; b down) tint by day, a cool blue-violet tint by night, applied here rather than re-tinting every sprite. */
	tint: { r: number; g: number; b: number };
	/** Overall brightness multiplier applied alongside tint — <1 darkens (night), 1 is neutral (day). */
	brightness: number;
}

// Deliberately restrained — this is meant to read as "the soft-rendered
// source art's own gentle glow", not an HDR bloom effect. Kept well short of
// each field's clamp ceiling below.
//
// threshold raised (0.75 -> 0.85) and bloomIntensity lowered (0.35 -> 0.22)
// for M10b batch 1: the wizard tower's window (pale ghost blue, already a
// bright curated tone — see palette.ts) sat just above the old threshold, so
// its own bright-pass excess plus the additive bloom on top pushed every
// channel to 1.0 — a hard, desaturating clip to solid white, not a glow. A
// higher threshold means fewer near-bright pixels feed the bloom at all;
// glowShader.ts's brightPass also now soft-clips the *result* channel-wise
// (see that file), which is the actual clip-proofing — these two defaults
// just keep the common case comfortably under where clipping starts.
//
// This is also the neutral fallback (tint {1,1,1}, brightness 1) for any
// scene that doesn't thread a time-of-day preset through — FileScene, or a
// test that constructs GlowParams directly.
export const DEFAULT_GLOW_PARAMS: GlowParams = {
	threshold: 0.85,
	blurRadius: 2.5,
	bloomIntensity: 0.22,
	vignetteStrength: 0.18,
	vignetteRadius: 0.7,
	tint: { r: 1, g: 1, b: 1 },
	brightness: 1,
};

// M10b batch 2: "golden-hour warm by day, cool contrast at night" — see
// WorldScene/ShelfScene's attachGlowLifecycle call sites, which pick one of
// these two based on the resolved store.timeOfDay. DAY is DEFAULT_GLOW_PARAMS
// plus a gentle warm tint; NIGHT lowers the bloom threshold (so lantern/
// window/bonfire highlights — already bright, curated warm tones, see
// props.ts — bloom into a glow that day's higher threshold mostly suppresses),
// raises bloomIntensity/vignette for a cozier dark scene, cools the tint
// toward blue-violet, and darkens the frame overall.
export const DAY_GLOW_PARAMS: GlowParams = {
	...DEFAULT_GLOW_PARAMS,
	tint: { r: 1.05, g: 1.0, b: 0.9 },
};

export const NIGHT_GLOW_PARAMS: GlowParams = {
	threshold: 0.55,
	blurRadius: 3,
	bloomIntensity: 0.5,
	vignetteStrength: 0.32,
	vignetteRadius: 0.6,
	tint: { r: 0.78, g: 0.8, b: 1.05 },
	brightness: 0.62,
};

function clamp(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

function clampTintChannel(value: number): number {
	return clamp(value, 0, 2);
}

/**
 * Clamps every field to a sane range regardless of input — used both to
 * sanitize a partial override merged onto the defaults and to guard against a
 * future settings UI (or a corrupt persisted value) driving the shader with
 * out-of-range numbers that would blow out whites or invert the vignette.
 */
export function clampGlowParams(params: Partial<GlowParams>): GlowParams {
	const merged = { ...DEFAULT_GLOW_PARAMS, ...params };
	return {
		threshold: clamp(merged.threshold, 0, 1),
		blurRadius: clamp(merged.blurRadius, 0, 8),
		bloomIntensity: clamp(merged.bloomIntensity, 0, 1),
		vignetteStrength: clamp(merged.vignetteStrength, 0, 1),
		vignetteRadius: clamp(merged.vignetteRadius, 0.1, 1),
		tint: {
			r: clampTintChannel(merged.tint.r),
			g: clampTintChannel(merged.tint.g),
			b: clampTintChannel(merged.tint.b),
		},
		brightness: clamp(merged.brightness, 0.2, 1.5),
	};
}
