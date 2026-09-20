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
	const sourceRows = sourceIconNames
		.map((name) => {
			const size = recoverConfig[name]?.targetSize ?? 32;
			const base = `${name}_${size}`;
			return `
		<section class="icon-row">
			<h3>${escapeHtml(name)}</h3>
			<div class="stage">
				<figure><img class="soft" src="../source/icons/${name}.png" width="192" height="192" alt="${escapeHtml(name)} source art"><figcaption>source (1024, shown at 192)</figcaption></figure>
				<figure><img class="pixel" src="recovered/${base}_quantized-only@8x.png" alt="${escapeHtml(name)} quantized only, background not removed"><figcaption>quantized only</figcaption></figure>
				<figure><img class="pixel" src="recovered/${base}@8x.png" alt="${escapeHtml(name)} recovered sprite with background removed"><figcaption>recovered (bg removed)</figcaption></figure>
			</div>
		</section>`;
		})
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
	img { background: repeating-conic-gradient(#2a2a2a 0% 25%, #333 0% 50%) 0 0 / 16px 16px; }
	img.pixel { image-rendering: pixelated; }
	.swatch img { width: 100%; }
	.stage { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-end; }
	.stage figure { margin: 0; text-align: center; }
	.stage figcaption { font-size: 0.75rem; color: #aaa; margin-top: 0.25rem; }
	.icon-row { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #333; }
	.placeholders { display: flex; gap: 1.5rem; flex-wrap: wrap; }
	.placeholders figure { margin: 0; text-align: center; }
</style>
</head>
<body>
	<h1>cabn asset pipeline — M2 preview</h1>

	<h2>Palette</h2>
	<div class="swatch"><img src="palette-swatch.png" alt="extracted palette swatch"></div>

	<h2>Recovered sprites</h2>
	${sourceRows}

	<h2>Placeholder sprites</h2>
	<div class="placeholders">
		<figure><img class="pixel" src="placeholders/portal_arch@8x.png" alt="portal_arch placeholder sprite"><figcaption>portal_arch</figcaption></figure>
		<figure><img class="pixel" src="placeholders/ghost@8x.png" alt="ghost placeholder sprite"><figcaption>ghost</figcaption></figure>
		<figure><img class="pixel" src="placeholders/character_idle@8x.png" alt="character_idle placeholder sprite"><figcaption>character_idle</figcaption></figure>
	</div>
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
