/**
 * Bright-pass -> blur -> additive mix -> vignette, all in one fragment
 * shader pass rather than the two-pass ping-pong render-target chain
 * Phaser's own built-in BloomFXPipeline uses (see BloomFXPipeline.js) —
 * a deliberate simplification: a single 4-tap symmetric spread (8 samples
 * total, horizontal + vertical) reads as a soft glow at the restrained
 * intensities GlowParams defaults to, and avoids juggling `fullFrame1`/
 * `fullFrame2` render targets for an effect that's meant to be subtle rather
 * than a showcase bloom. Vignette folded into the same pass rather than a
 * second attached pipeline, for the same "keep it to one draw call" reason.
 */
export const GLOW_FRAG_SHADER = `
#define SHADER_NAME GLOW_FS
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 texel;
uniform float threshold;
uniform float bloomIntensity;
uniform float vignetteStrength;
uniform float vignetteRadius;
// M10b batch 2 day/night color grading — see glowParams.ts's GlowParams.tint
// doc comment. Applied to every texture2D sample (not just the center one)
// so the blurred bright-pass taps are graded consistently with the base color.
uniform vec3 tint;
uniform float brightness;

varying vec2 outTexCoord;

float luma(vec3 color) {
	return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 grade(vec3 color) {
	return color * tint * brightness;
}

vec3 brightPass(vec3 color) {
	float excess = max(luma(color) - threshold, 0.0);
	float range = max(1.0 - threshold, 0.0001);
	return color * (excess / range);
}

void main() {
	vec4 base = texture2D(uMainSampler, outTexCoord);
	vec3 gradedBase = grade(base.rgb);
	vec3 bloom = brightPass(gradedBase) * 0.3846;

	vec2 offsets[4];
	offsets[0] = vec2(texel.x * 1.3846, 0.0);
	offsets[1] = vec2(texel.x * 3.2308, 0.0);
	offsets[2] = vec2(0.0, texel.y * 1.3846);
	offsets[3] = vec2(0.0, texel.y * 3.2308);
	float weights[4];
	weights[0] = 0.3077;
	weights[1] = 0.0769;
	weights[2] = 0.3077;
	weights[3] = 0.0769;

	for (int i = 0; i < 4; i++) {
		vec3 plus = brightPass(grade(texture2D(uMainSampler, outTexCoord + offsets[i]).rgb));
		vec3 minus = brightPass(grade(texture2D(uMainSampler, outTexCoord - offsets[i]).rgb));
		bloom += (plus + minus) * weights[i];
	}

	vec3 color = gradedBase + bloom * bloomIntensity;

	// Soft-clip: subtract any over-1.0 overflow from every channel equally,
	// rather than letting the GPU hard-clip each channel independently. A
	// hard per-channel clip is what turned an already-bright curated tone
	// (e.g. the wizard tower's pale-blue window) into flat white once bloom
	// pushed it over 1.0 — every channel saturates to the same 1.0 ceiling,
	// which is indistinguishable from pure white regardless of the original
	// hue. Subtracting the overflow keeps the channels' relative differences
	// (so the highlight stays tinted) while still bringing the peak back to 1.0.
	float peak = max(max(color.r, color.g), color.b);
	color -= max(peak - 1.0, 0.0);

	float dist = length(outTexCoord - 0.5) * 2.0;
	float vignette = smoothstep(vignetteRadius, 1.0, dist) * vignetteStrength;
	color *= 1.0 - vignette;

	gl_FragColor = vec4(color, base.a);
}
`;
