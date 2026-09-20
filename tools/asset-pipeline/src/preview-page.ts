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
	<p class="note">28 colors extracted from the source icons (indices 0-27) plus 4 hand-picked cool curated colors appended at the end (28-31: steel gray, bone/moonlight white, pale ghost blue, cool shadow blue-gray) — the extracted set is entirely warm browns/greens/creams and has nothing a moonlit or spectral subject could use.</p>
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
