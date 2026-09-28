// Shared display scales for WorldScene and ShelfScene — kept in one place so
// a cabin (or portal arch) reads at the same size on the shelf as it will
// once you're standing next to the equivalent sprite inside a world.
export const CABIN_SCALE = 0.5;
export const CABINET_SCALE = 0.375;
export const PORTAL_SCALE = 0.375;

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

// The procedural shelf cabin (52x48 grid) and world cabinet (30x40) are both
// rendered at the tower's cellSize 16 (tools/asset-pipeline's
// gen-world-art.ts LANDMARK_CELL_SIZE), so sharing the tower's scale is what
// gives all three the same on-screen pixel size (~2.2px per grid cell, close
// to the player's 2px) — the M10 playtest's "cabins are a lot more detailed
// than the tower" complaint was exactly a density mismatch. Resulting
// heights: cabin ~108px (~1.7x the 64px player), cabinet ~90px (~1.4x —
// the playtest asked for 1.3-1.6x; batch 3's unscaled 132px cabinet read as
// "oversized brown blocks").
export const SHELF_CABIN_SCALE = WIZARD_TOWER_SCALE;
export const WORLD_CABINET_SCALE = WIZARD_TOWER_SCALE;

// castle-keep's pixel map is 32x44 (tools/asset-pipeline/src/world-art/
// props.ts), cellSize 6 like every other prop -> raw 192x264. Every other
// prop in this batch is deliberately unscaled (propPlacement.ts never calls
// setScale — a scattered prop's apparent size comes entirely from its grid
// dimensions), but the castle keep is a one-off landmark accent sitting
// right next to the wizard tower, not a scattered prop, and batch 2 shipped
// it unscaled anyway — bigger than the (correctly scaled) tower beside it,
// the exact "centerpiece" the tower is supposed to be (M10b batch-3 review).
// Targets 150px tall via fitSpriteToSize() below — a bit under the tower's
// own 179px so it reads as a secondary structure.
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
