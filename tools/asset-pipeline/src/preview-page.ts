import { readFile, writeFile } from "node:fs/promises";
import {
	previewHtmlPath,
	recoverConfigPath,
	sourceIconNames,
} from "./paths.js";

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
	);
}

async function main() {
	const recoverConfig: Record<string, { targetSize: number }> = JSON.parse(
		await readFile(recoverConfigPath, "utf8"),
	);

	// Everything below is a relative path from assets/generated/preview.html so
	// the file works when opened directly from disk, no local server needed.
	const matteRows = sourceIconNames
		.map(
			(name) => `
		<section class="icon-row">
			<h3>${escapeHtml(name)}</h3>
			<div class="stage">
				<figure><img class="soft" src="../source/icons/${name}.png" width="192" height="192" alt="${escapeHtml(name)} source art"><figcaption>source (1024)</figcaption></figure>
				<figure><img class="soft" src="originals/${name}.png" width="192" height="192" alt="${escapeHtml(name)} matte, background removed, full res"><figcaption>matte (1024, bg removed)</figcaption></figure>
				<figure><img class="soft" src="originals/${name}_256.png" width="192" height="192" alt="${escapeHtml(name)} matte at game resolution"><figcaption>matte (256, game res)</figcaption></figure>
			</div>
		</section>`,
		)
		.join("\n");

	const recoveredRows = sourceIconNames
		.map((name) => {
			const size = recoverConfig[name]?.targetSize ?? 32;
			const base = `${name}_${size}`;
			return `
		<section class="icon-row">
			<h3>${escapeHtml(name)}</h3>
			<div class="stage">
				<figure><img class="pixel" src="recovered/${base}_quantized-only@8x.png" alt="${escapeHtml(name)} quantized only, background not removed"><figcaption>quantized only</figcaption></figure>
				<figure><img class="pixel" src="recovered/${base}@8x.png" alt="${escapeHtml(name)} recovered sprite with background removed"><figcaption>recovered (bg removed)</figcaption></figure>
			</div>
		</section>`;
		})
		.join("\n");

	const placeholderRows = ["portal_arch", "ghost", "character_idle"]
		.map(
			(name) => `
		<section class="icon-row">
			<h3>${escapeHtml(name)}</h3>
			<div class="stage">
				<figure><img class="pixel" src="placeholders/${name}@8x.png" alt="${escapeHtml(name)} crisp placeholder"><figcaption>crisp</figcaption></figure>
				<figure><img class="soft" src="placeholders/${name}_soft.png" alt="${escapeHtml(name)} softened placeholder"><figcaption>softened</figcaption></figure>
			</div>
		</section>`,
		)
		.join("\n");

	const bonfireFrameCount = 4;
	const bonfireFrameRows = Array.from(
		{ length: bonfireFrameCount },
		(_, i) => i,
	)
		.map(
			(i) => `
			<figure><img class="pixel" src="placeholders/bonfire_frame${i}@8x.png" alt="bonfire frame ${i}, crisp"><figcaption>frame ${i}</figcaption></figure>`,
		)
		.join("\n");

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>cabn asset pipeline preview</title>
<style>
	:root { color-scheme: dark; }
	body { background: #1b1b1b; color: #eee; font-family: system-ui, sans-serif; padding: 2rem; }
	h1, h2, h3 { font-weight: 600; }
	p.note { color: #aaa; max-width: 60em; }
	img { background: repeating-conic-gradient(#2a2a2a 0% 25%, #333 0% 50%) 0 0 / 16px 16px; }
	img.pixel { image-rendering: pixelated; }
	.swatch img { width: 100%; }
	.stage { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-end; }
	.stage figure { margin: 0; text-align: center; }
	.stage figcaption { font-size: 0.75rem; color: #aaa; margin-top: 0.25rem; }
	.icon-row { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #333; }
	.placeholders { display: flex; gap: 1.5rem; flex-wrap: wrap; }
	.placeholders figure { margin: 0; text-align: center; }
	.calibration { display: flex; gap: 2rem; align-items: flex-end; }
	.calibration figure { margin: 0; text-align: center; }
	.calibration img { width: 320px; }
	details summary { cursor: pointer; color: #aaa; }
</style>
</head>
<body>
	<h1>cabn asset pipeline preview</h1>
	<p class="note">Art direction pivot: the soft-rendered 1024&sup2; originals (background removed via a matte, below) are the in-game art for these five objects. The crisp recovered/quantized sprites further down are kept as a reference for how the recovery step works, not as shipped art.</p>

	<h2>Palette</h2>
	<p class="note">28 colors extracted from the source icons (indices 0-27) plus 6 hand-picked curated colors appended at the end — the extracted set is entirely warm browns/greens/creams and has nothing cool or purple a spectral subject or a magic gem could use. 28-31: steel gray, bone/moonlight white, pale ghost blue, cool shadow blue-gray. 32-33: deep plum, bright amethyst (staff gem).</p>
	<div class="swatch"><img src="palette-swatch.png" alt="extracted and curated palette swatch"></div>

	<h2>Matted originals (in-game art)</h2>
	${matteRows}

	<h2>Soften calibration</h2>
	<p class="note">soften() applied to the recovered cabin_64 sprite, next to the original cabin.png — the target was for these to read as the same soft-chunky style.</p>
	<div class="calibration">
		<figure><img class="soft" src="../source/icons/cabin.png" alt="original cabin art"><figcaption>original cabin.png</figcaption></figure>
		<figure><img class="soft" src="soften-calibration/cabin_soft.png" alt="softened recovered cabin sprite"><figcaption>soften(cabin_64)</figcaption></figure>
	</div>

	<h2>Placeholder sprites</h2>
	${placeholderRows}

	<h2>Portal animation</h2>
	<p class="note">6 frames of pale-ghost-blue motes swirling inside the arch opening, generated by <code>portalArchFrame(frameIndex, totalFrames)</code> — a deterministic function of frame index, not hand-drawn per frame. Encoded to GIF with <a href="https://github.com/mattdesl/gifenc">gifenc</a> (tiny, zero-dep); the strips below show the same frames as static PNGs for frame-by-frame inspection.</p>
	<div class="calibration">
		<figure><img class="pixel" src="placeholders/portal_arch_anim.gif" alt="animated portal arch with swirling motes"><figcaption>animated GIF</figcaption></figure>
	</div>
	<figure style="margin: 1rem 0 0;"><img class="pixel" src="placeholders/portal_arch_strip.png" style="width: 100%;" alt="portal arch animation frames, crisp"><figcaption class="note">crisp strip, frames 0-5 left to right</figcaption></figure>
	<figure style="margin: 1rem 0 0;"><img class="soft" src="placeholders/portal_arch_strip_soft.png" style="width: 100%;" alt="portal arch animation frames, softened"><figcaption class="note">softened strip, frames 0-5 left to right</figcaption></figure>

	<h2>Hierarchy sprites</h2>
	<p class="note">World-anchor and shelf-centerpiece art: the bonfire (world spawn marker), the wizard tower (Shelf centerpiece), and the character's back view next to its front view for comparison.</p>
	<section class="icon-row">
		<h3>bonfire</h3>
		<p class="note">4 frames of flame licking up from the logs, generated by <code>bonfireFrame(frameIndex, totalFrames)</code> — a deterministic function of frame index, same pattern as the portal's motes.</p>
		<div class="stage">
			${bonfireFrameRows}
		</div>
		<figure style="margin: 1rem 0 0;"><img class="pixel" src="placeholders/bonfire_strip.png" style="width: 100%;" alt="bonfire animation frames, crisp"><figcaption class="note">crisp strip, frames 0-3 left to right</figcaption></figure>
		<figure style="margin: 1rem 0 0;"><img class="soft" src="placeholders/bonfire_strip_soft.png" style="width: 100%;" alt="bonfire animation frames, softened"><figcaption class="note">softened strip, frames 0-3 left to right</figcaption></figure>
	</section>
	<section class="icon-row">
		<h3>wizard_tower</h3>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/wizard_tower@8x.png" alt="wizard tower, crisp"><figcaption>crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/wizard_tower_soft.png" alt="wizard tower, softened"><figcaption>softened</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>character_idle_back (next to character_idle)</h3>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/character_idle@8x.png" alt="character idle, front, crisp"><figcaption>front, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/character_idle_soft.png" alt="character idle, front, softened"><figcaption>front, softened</figcaption></figure>
			<figure><img class="pixel" src="placeholders/character_idle_back@8x.png" alt="character idle, back, crisp"><figcaption>back, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/character_idle_back_soft.png" alt="character idle, back, softened"><figcaption>back, softened</figcaption></figure>
		</div>
	</section>

	<h2>Portal with file preview (composite reference)</h2>
	<p class="note">Reference for the engine: a file's contents rendered as a mock code-preview parchment inside the portal opening, with a glowing border where it meets the stone. Not a placeholder sprite itself — informs how the engine might composite file previews into portals later.</p>
	<div class="calibration">
		<figure><img class="pixel" src="portal-preview-composite.png" alt="portal arch with file preview composite, crisp"><figcaption>crisp</figcaption></figure>
		<figure><img class="soft" src="portal-preview-composite_soft.png" alt="portal arch with file preview composite, softened"><figcaption>softened</figcaption></figure>
	</div>

	<details>
		<summary><h2 style="display:inline">Recovered sprites (superseded, kept for reference)</h2></summary>
		${recoveredRows}
	</details>
</body>
</html>
`;

	await writeFile(previewHtmlPath, html);
	console.log(`Wrote ${previewHtmlPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
