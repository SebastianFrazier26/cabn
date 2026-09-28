// Shared display scales for WorldScene and ShelfScene — kept in one place so
// a cabin (or portal arch) reads at the same size on the shelf as it will
// once you're standing next to the equivalent sprite inside a world.
export const CABIN_SCALE = 0.5;
export const CABINET_SCALE = 0.375;
export const PORTAL_SCALE = 0.375;
/**
 * World file portals only (FileScene's exit arch keeps PORTAL_SCALE): 2x the
 * old 96px arch, so its opening (~93x127px) is big enough to hold a readable
 * literal preview of the file — M10 playtest: "portals should be larger and
 * show a literal preview of the document" (2026-09-28).
 */
export const WORLD_PORTAL_SCALE = PORTAL_SCALE * 2;

// bonfire's pixel map is 32x32 (tools/asset-pipeline/src/pixelmaps/bonfire.ts),
// rendered at soften()'s default cellSize (16) into a 512x512 raw sprite —
// the same "pixelmap asset sharing a flat-photo scale constant" bug as the
// wizard tower's (see WIZARD_TOWER_SCALE below): the old 0.375 displayed it
// at 192x192, nearly 3x the player's own height, with the player then
// spawning at its exact center (M10b batch-2 review: "the bonfire is huge
// and the player stands in it"). Targets 80px tall — a modest campfire
// slightly smaller than a cabinet (96px), not a landmark.
export const BONFIRE_RAW_SIZE_PX = 512;
export const BONFIRE_SCALE = 0.156;

// wizard_tower's pixel map is 48x80 (tools/asset-pipeline/src/pixelmaps/
// wizard-tower.ts), rendered through soften()'s default cellSize (16) into a
// 768x1280 raw sprite — a *much* denser source grid than cabin_256.webp's
// flat 256x256, so the old WIZARD_TOWER_SCALE (0.75, picked as if it were
// another cabin-scale asset) displayed the tower at 576x960: nearly the
// whole screen, the M10b batch-1 bug report ("far too large... not half the
// screen"). The player's own on-screen height is 64px (character-idle's
// 24x32 pixel map * cellSize 16 * CHARACTER_SCALE 0.125, see
// playerController.ts) — a landmark reads as a landmark at roughly 2.5-3x
// that, so this targets a 179px-tall tower (2.8x) instead of deriving from
// an unrelated asset's scale constant.
export const WIZARD_TOWER_RAW_WIDTH_PX = 768;
export const WIZARD_TOWER_RAW_HEIGHT_PX = 1280;
export const WIZARD_TOWER_SCALE = 0.14;

// The procedural shelf cabin (52x48 grid) is rendered at the tower's
// cellSize 16 (tools/asset-pipeline's gen-world-art.ts LANDMARK_CELL_SIZE),
// so sharing the tower's scale is what gives both the same on-screen pixel
// size (~2.2px per grid cell, close to the player's 2px) — the M10
// playtest's "cabins are a lot more detailed than the tower" complaint was
// exactly a density mismatch. Cabin ~108px tall (~1.7x the 64px player). The
// world fountain (WorldScene's directory marker) is a props-density asset
// instead, drawn unscaled — see assetPaths.ts's WORLD_FOUNTAIN_KEY.
export const SHELF_CABIN_SCALE = WIZARD_TOWER_SCALE;

// Scatter props (tools/asset-pipeline/src/world-art/props.ts) are drawn
// unscaled: since the 2026-09-28 art-density pass they're authored at the
// same 2 screen px per fine cell as scenery, so their grid size *is* their
// on-screen size (propPlacement.ts never calls setScale). The castle keep is
// the one exception — a one-off landmark accent beside the wizard tower,
// fitted to a target height via fitSpriteToSize() so it reads as a
// secondary structure, a bit under the tower's own 179px. Its fine grid
// (50x68, cellSize 2 -> 100x136 raw) is sized so that fit lands its cells
// at ~2.2 screen px, the tower's own density.
export const CASTLE_KEEP_TARGET_HEIGHT_PX = 150;

// Each monster species' pixel map is a different native size (ouroboros is
// deliberately 48x48 vs. everything else's ~18-32px, see tools/asset-pipeline's
// pixelmaps/), so a single shared scale constant would make species that
// happen to have a bigger source grid read as bigger monsters for no in-game
// reason. Sizes here are a *target on-screen size in px*, applied via
// fitSpriteToSize() below (scale = target / sprite's larger source
// dimension), so every species reads at the size the game actually wants
// regardless of its native pixel-map resolution.
export const MONSTER_HOVER_SIZE: Readonly<Record<string, number>> = {
	ghost: 40,
	"rot-sprite": 36,
	"warded-mimic": 36,
	gremlin: 32,
	ouroboros: 64,
	"will-o-wisp": 20,
};

/** Smaller than MONSTER_HOVER_SIZE — FileScene's line height is 20px, so a monster standing beside the text has less room than one hovering near a world portal arch. */
export const MONSTER_FILE_SIZE: Readonly<Record<string, number>> = {
	ghost: 26,
	"rot-sprite": 24,
	"warded-mimic": 24,
	gremlin: 22,
	ouroboros: 36,
	"will-o-wisp": 14,
};

export function fitSpriteToSize(
	sprite: {
		width: number;
		height: number;
		setScale: (scale: number) => unknown;
	},
	targetPx: number,
): void {
	const base = Math.max(sprite.width, sprite.height, 1);
	sprite.setScale(targetPx / base);
}
