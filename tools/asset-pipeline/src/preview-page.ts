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

	const monsterSpecies: { slug: string; species: string }[] = [
		{ slug: "ghost", species: "ghost (NullTypeError) — existing, unchanged" },
		{ slug: "rot_sprite", species: "rot-sprite (Corrupted)" },
		{ slug: "warded_mimic", species: "warded-mimic (InvalidMode)" },
		{ slug: "gremlin", species: "gremlin (IoError)" },
		{ slug: "ouroboros", species: "ouroboros (OuroborosError)" },
		{ slug: "will_o_wisp", species: "will-o-wisp (WispNote)" },
	];
	const monsterRows = monsterSpecies
		.map(({ slug, species }) => {
			if (slug === "ghost") {
				return `
			<section class="icon-row">
				<h3>${escapeHtml(species)}</h3>
				<div class="stage">
					<figure><img class="pixel" src="placeholders/ghost@8x.png" alt="ghost, crisp"><figcaption>crisp</figcaption></figure>
					<figure><img class="soft" src="placeholders/ghost_soft.png" alt="ghost, softened"><figcaption>softened</figcaption></figure>
				</div>
			</section>`;
			}
			return `
		<section class="icon-row">
			<h3>${escapeHtml(species)}</h3>
			<div class="stage">
				<figure><img class="pixel" src="placeholders/${slug}_idle0@8x.png" alt="${escapeHtml(slug)} idle frame 0, crisp"><figcaption>idle0, crisp</figcaption></figure>
				<figure><img class="soft" src="placeholders/${slug}_idle0_soft.png" alt="${escapeHtml(slug)} idle frame 0, softened"><figcaption>idle0, softened</figcaption></figure>
				<figure><img class="pixel" src="placeholders/${slug}_idle1@8x.png" alt="${escapeHtml(slug)} idle frame 1, crisp"><figcaption>idle1, crisp</figcaption></figure>
				<figure><img class="soft" src="placeholders/${slug}_idle1_soft.png" alt="${escapeHtml(slug)} idle frame 1, softened"><figcaption>idle1, softened</figcaption></figure>
			</div>
		</section>`;
		})
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

	const worldArtProps = [
		"fence",
		"hedge",
		"lamp_post",
		"tree_small",
		"tree_large",
		"bush",
		"well",
		"signpost",
		"flower_pot",
		"stone_wall",
		"cottage",
		"flower_bed",
		"bench",
		"castle_keep",
	];
	const worldArtPropRows = worldArtProps
		.map(
			(slug) => `
			<figure><img class="soft" src="placeholders/prop_${slug}_soft.png" alt="${escapeHtml(slug)} prop"><figcaption>${escapeHtml(slug.replace(/_/g, "-"))}</figcaption></figure>`,
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

	<h2>Monsters</h2>
	<p class="note">M6: one species per error-code taxonomy entry (packages/converter/src/annotate/taxonomy.ts). Ghost already existed (M2); the other five are new here, each two idle frames (a small "breathe"/twitch bob, not a walk cycle) — see the M6 CHANGELOG entry for how each was generated.</p>
	${monsterRows}

	<h2>Portal with file preview (composite reference)</h2>
	<p class="note">Reference for the engine: a file's contents rendered as a mock code-preview parchment inside the portal opening, with a glowing border where it meets the stone. Not a placeholder sprite itself — informs how the engine might composite file previews into portals later.</p>
	<div class="calibration">
		<figure><img class="pixel" src="portal-preview-composite.png" alt="portal arch with file preview composite, crisp"><figcaption>crisp</figcaption></figure>
		<figure><img class="soft" src="portal-preview-composite_soft.png" alt="portal arch with file preview composite, softened"><figcaption>softened</figcaption></figure>
	</div>

	<h2>World art — batch 1 (M10b)</h2>
	<p class="note">Biome ground tilesets, path stamps, decals, and props for the walkable world — replacing WorldScene/ShelfScene's tinted-ellipse ground and dashed-line paths. Saturated Stardew Valley / Pokémon-style palette (a second pass — the first attempt used the muted cottagecore tones above and read as bland; see the CHANGELOG for that revision). Scheme: 16-tile blob-lite autotiling (4-directional N/E/S/W neighbor mask, not the 8-directional 47-tile set — see packages/engine/src/render/groundTiles.ts). Full frame index in assets/generated/world-art/tile-index.json.</p>
	<section class="icon-row">
		<h3>Biome tilesets (32px tiles: 4 base grass variants + 16 blob-edge frames)</h3>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/meadow_tiles.png" alt="meadow tileset, crisp"><figcaption>meadow, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/meadow_tiles_soft.png" alt="meadow tileset, softened"><figcaption>meadow, softened</figcaption></figure>
			<figure><img class="pixel" src="placeholders/grove_tiles.png" alt="grove tileset, crisp"><figcaption>grove, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/grove_tiles_soft.png" alt="grove tileset, softened"><figcaption>grove, softened</figcaption></figure>
			<figure><img class="pixel" src="placeholders/glade_tiles.png" alt="glade tileset, crisp"><figcaption>glade, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/glade_tiles_soft.png" alt="glade tileset, softened"><figcaption>glade, softened</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Decals (flowers, clover, pebbles, mushrooms, fallen leaves — shared across biomes, selected per-biome by the scatter logic)</h3>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/decals.png" alt="decal sheet, crisp"><figcaption>crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/decals_soft.png" alt="decal sheet, softened"><figcaption>softened</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Path stamps — cobblestone (batch 2 replaced batch 1's round dirt-brush blobs, which review called "blob stacks that look like pancakes")</h3>
		<p class="note">Rectangular stone-block strips with a warm sand edge-stone border, rotated at runtime to match the path's own direction (render/pathBaker.ts) rather than laid flat like batch 1's stamps.</p>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/path_stamp_0.png" alt="cobblestone segment a, crisp"><figcaption>cobble-a, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/path_stamp_0_soft.png" alt="cobblestone segment a, softened"><figcaption>cobble-a, softened</figcaption></figure>
			<figure><img class="pixel" src="placeholders/path_stamp_1.png" alt="cobblestone segment b, crisp"><figcaption>cobble-b, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/path_stamp_1_soft.png" alt="cobblestone segment b, softened"><figcaption>cobble-b, softened</figcaption></figure>
			<figure><img class="pixel" src="placeholders/path_stamp_2.png" alt="cobblestone segment c, crisp"><figcaption>cobble-c, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/path_stamp_2_soft.png" alt="cobblestone segment c, softened"><figcaption>cobble-c, softened</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Props (13, plus the shelf's one-off castle keep and the in-world fountain marker)</h3>
		<p class="note">Batch 2 cottagecore set — "stone-lantern" upgraded to "lamp-post" and "log-pile" replaced with "stone-wall" (both flagged weak in batch-1 review); cottage, flower-bed, bench, and the castle keep are new. Trees gained a third, higher canopy tier for a taller/more layered silhouette. Batch 3: the castle keep is redrawn (real coursed-masonry shading, a recessed crenellated parapet, a proper pennant, lit windows, ivy) and — having shipped unscaled in batch 2 — is now deliberately scaled to read *smaller* than the wizard tower next to it, not bigger. <code>world-fountain</code> (last figure below, 6-frame strip + tinted gem overlay) is the in-world directory marker since the 2026-09-28 round-2 playtest, replacing the curio cabinet that read as out of place beside the stone portal arches. Before/after screenshots: review/layout-fountain/.</p>
		<div class="stage">
			${worldArtPropRows}
			<figure><img class="soft" src="placeholders/prop_world_fountain_strip_soft.png" alt="world-fountain animation strip" style="width: 672px;"><figcaption>world-fountain (6 frames)</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Art-consistency pass (M10) — legacy photographic art redrawn procedurally</h3>
		<p class="note">The matted originals above (cabin, cabinet, key) no longer ship in normal play. The shelf cabin is drawn on the wizard tower's grid density (cellSize 16, displayed at the tower's scale) with its 1-cell ink outline and up-left light; the opener key is a sixth v3 item icon. Before/after in-engine screenshots: review/consistency/.</p>
		<div class="stage">
			<figure><img class="pixel" src="placeholders/prop_shelf_cabin.png" alt="shelf cabin, crisp" style="width: 208px;"><figcaption>shelf-cabin, crisp</figcaption></figure>
			<figure><img class="soft" src="placeholders/prop_shelf_cabin_soft.png" alt="shelf cabin, softened" style="width: 208px;"><figcaption>shelf-cabin, softened</figcaption></figure>
			<figure><img class="pixel" src="ui/ui_icon_key@8x.png" alt="opener key icon, crisp" style="width: 96px;"><figcaption>ui_icon_key, crisp</figcaption></figure>
			<figure><img class="soft" src="ui/ui_icon_key_soft.png" alt="opener key icon, softened" style="width: 96px;"><figcaption>ui_icon_key, softened</figcaption></figure>
			<figure><img class="soft" src="review/consistency/before-day-shelf-cabin-tower.png" alt="shelf before: photographic cabin" style="width: 420px;"><figcaption>shelf — before</figcaption></figure>
			<figure><img class="soft" src="review/consistency/after-day-shelf-cabin-tower.png" alt="shelf after: procedural cabin" style="width: 420px;"><figcaption>shelf — after</figcaption></figure>
			<figure><img class="soft" src="review/consistency/before-day-world-spawn.png" alt="world before: oversized cabinets, many wells" style="width: 420px;"><figcaption>world — before</figcaption></figure>
			<figure><img class="soft" src="review/consistency/after-day-world-spawn.png" alt="world after: cabinets scaled, wells capped" style="width: 420px;"><figcaption>world — after</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Composed mock scene</h3>
		<p class="note">Assembled directly from the frames above (same blob-mask math as the engine's tileFrameFor, minus the hashed variant pick) — a tiled clearing, scattered decals, a path trailing off one edge, and a tree/fence/well, with no browser involved.</p>
		<div class="calibration">
			<figure><img class="soft" src="world-art/mock-scene.png" alt="composed mock scene: tiled clearing with decals, path, and props" style="width: 320px; image-rendering: pixelated;"><figcaption>mock-scene.png</figcaption></figure>
		</div>
	</section>

	<h2>Continuous ground field, layout, day/night, and effects — batch 2+3 (M10b)</h2>
	<p class="note">Batch 1's per-cluster ellipses left everything else as an empty background — review: "the shelf is an empty dark void", "cluster ground is blocky squares... floating in the void". <code>render/groundField.ts</code> bakes one uninterrupted grass field across the whole camera bounds (chunked into fixed-size RenderTextures), with clusters/the shelf tower marked as clearings on top of it. Batch 3: those clearing edges were still a hard, sand-colored square outline (batch 1's opaque dirt fill, now sitting on top of a field that's grass everywhere) — <code>world-art/biome-tiles.ts</code>'s edge tiles are transparent outside the grass silhouette instead, with a few fixed "tuft" pixels breaking up the curve, so the field just shows through. Layout: portal-arch spacing (<code>WorldScene#portalRingRadius</code>) now derives the ring radius from the arches' own display size instead of a flat per-count increment that put a busy cluster's arches on top of each other; clearings size themselves to actually contain that ring; props are confined to a clearing's outer annulus (<code>systems/scatter.ts</code>'s <code>minRadiusFrac</code>) so they frame the edge instead of scattering anywhere non-excluded; and <code>packages/converter/src/layout.ts</code> gained a post-placement relaxation pass so whole *clusters* (not just props within one) keep a minimum gap scaled to how many files each one has. Day/night (<code>systems/timeOfDay.ts</code>) drives a warm-by-day/cool-blue-violet-by-night color grading in the glow post-fx pipeline (<code>fx/glowShader.ts</code>'s tint/brightness uniforms). Batch 3 added real local light: <code>render/lightPools.ts</code> draws an additive warm glow at every lamp post, cottage window, the wizard tower's window, and a bigger flickering one at the bonfire, night-only — batch 2 had relied on the post-fx bloom alone, which review found "barely glowing". Ambient particles (<code>render/effects.ts</code>, one shared soft-dot sprite tinted/scaled per effect): fireflies at night, drifting motes by day, bonfire embers, chimney smoke from cottages, and a lantern/cottage-window alpha flicker — all skipped or made static under <code>prefers-reduced-motion</code>.</p>
	<section class="icon-row">
		<h3>In-engine (headless Playwright screenshots)</h3>
		<p class="note">The actual demo, not a mockup — captured via <code>apps/demo/e2e</code>'s Playwright setup against a production build, with <code>store.setTimeOfDayOverride()</code> forcing day/night deterministically. See the CHANGELOG for how these were captured.</p>
		<div class="stage">
			<figure><img class="soft" src="review/shelf-day.png" alt="shelf scene by day: continuous grass field, tower, castle keep, cottage, cobblestone paths" style="width: 420px;"><figcaption>shelf — day</figcaption></figure>
			<figure><img class="soft" src="review/shelf-night.png" alt="shelf scene by night: cool blue-violet color grading, warm light pools at the tower window and lamp posts" style="width: 420px;"><figcaption>shelf — night</figcaption></figure>
			<figure><img class="soft" src="review/world-day.png" alt="inside a world by day: continuous field, cottagecore props framing clearing edges, cobblestone paths" style="width: 420px;"><figcaption>inside a world — day</figcaption></figure>
			<figure><img class="soft" src="review/world-night.png" alt="inside a world by night: cool color grading, warm light pools at the bonfire and lamp posts" style="width: 420px;"><figcaption>inside a world — night</figcaption></figure>
		</div>
	</section>
	<section class="icon-row">
		<h3>Motion check — 6-frame night sequence</h3>
		<p class="note">Captured 250ms apart via repeated screenshots of the same running page (not a GIF — see assets/generated/review/sequences/). Fireflies drift a few pixels frame to frame; a pixel-diff between frame 0 and frame 5 (checked directly, not just eyeballed) shows movement concentrated around each portal arch and the bonfire, not a false-static render.</p>
		<div class="stage">
			<figure><img class="soft" src="review/sequences/night-0.png" alt="night motion sequence frame 0" style="width: 200px;"><figcaption>frame 0</figcaption></figure>
			<figure><img class="soft" src="review/sequences/night-1.png" alt="night motion sequence frame 1" style="width: 200px;"><figcaption>frame 1</figcaption></figure>
			<figure><img class="soft" src="review/sequences/night-2.png" alt="night motion sequence frame 2" style="width: 200px;"><figcaption>frame 2</figcaption></figure>
			<figure><img class="soft" src="review/sequences/night-3.png" alt="night motion sequence frame 3" style="width: 200px;"><figcaption>frame 3</figcaption></figure>
			<figure><img class="soft" src="review/sequences/night-4.png" alt="night motion sequence frame 4" style="width: 200px;"><figcaption>frame 4</figcaption></figure>
			<figure><img class="soft" src="review/sequences/night-5.png" alt="night motion sequence frame 5" style="width: 200px;"><figcaption>frame 5</figcaption></figure>
		</div>
	</section>

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
