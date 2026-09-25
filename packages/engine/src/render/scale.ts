// Shared display scales for WorldScene and ShelfScene — kept in one place so
// a cabin (or portal arch) reads at the same size on the shelf as it will
// once you're standing next to the equivalent sprite inside a world.
export const CABIN_SCALE = 0.5;
export const CABINET_SCALE = 0.375;
export const PORTAL_SCALE = 0.375;
export const BONFIRE_SCALE = 0.375;
export const WIZARD_TOWER_SCALE = 0.75;

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
