// Root-relative convention, independent of worldUrl: hosting apps copy
// assets/generated/{originals,placeholders} verbatim to <publicRoot>/assets/
// (see apps/demo/scripts/build-world.mjs). Keeping this separate from the
// world bundle means the same sprite set works across many converted worlds
// without duplicating sprites per-world.
const ASSET_BASE = "/assets";

export const ASSET_KEYS = {
	cabin: "cabin",
	cabinet: "cabinet",
	characterIdle: "character-idle",
	portalArchStrip: "portal-arch-strip",
} as const;

export const ASSET_PATHS = {
	[ASSET_KEYS.cabin]: `${ASSET_BASE}/originals/cabin_256.webp`,
	[ASSET_KEYS.cabinet]: `${ASSET_BASE}/originals/cabinet_256.webp`,
	[ASSET_KEYS.characterIdle]: `${ASSET_BASE}/placeholders/character_idle_soft.png`,
	[ASSET_KEYS.portalArchStrip]: `${ASSET_BASE}/placeholders/portal_arch_strip_soft.png`,
} as const;

// portal_arch_strip_soft.png is 6 frames of 256x256 laid out horizontally
// (1536x256 total) — see assets/generated/placeholders.
export const PORTAL_ARCH_FRAME_SIZE = 256;
export const PORTAL_ARCH_FRAME_COUNT = 6;

export const BONFIRE_FRAME_COUNT = 4;

// M6 monster sprites. Ghost (M2) is a single static image — no idle animation
// — so it gets its own key rather than the frame-pair shape the other five
// species use (each rendered as two idle frames by tools/asset-pipeline, see
// its pixelmaps/{rot-sprite,warded-mimic,gremlin,ouroboros,will-o-wisp}.ts).
const MONSTER_FILE_SLUG: Record<string, string> = {
	"rot-sprite": "rot_sprite",
	"warded-mimic": "warded_mimic",
	gremlin: "gremlin",
	ouroboros: "ouroboros",
	"will-o-wisp": "will_o_wisp",
};

export const MONSTER_GHOST_KEY = "monster-ghost";
export const MONSTER_GHOST_PATH = `${ASSET_BASE}/placeholders/ghost_soft.png`;

export function monsterFrameKey(species: string, frame: 0 | 1): string {
	return `monster-${species}-${frame}`;
}

export function monsterFramePath(species: string, frame: 0 | 1): string {
	const slug = MONSTER_FILE_SLUG[species] ?? species;
	return `${ASSET_BASE}/placeholders/${slug}_idle${frame}_soft.png`;
}

/** Species with a real two-frame idle animation — everything except ghost. */
export const ANIMATED_MONSTER_SPECIES = [
	"rot-sprite",
	"warded-mimic",
	"gremlin",
	"ouroboros",
	"will-o-wisp",
] as const;

function bonfireFrameKey(index: number): string {
	return `bonfire-frame-${index}`;
}

// Art for these three keys is being drawn on a parallel branch (feat/art-
// hierarchy-sprites) and may not exist in assets/generated yet. PreloadScene
// tracks per-key load failures and the world/shelf scenes fall back to an
// existing sprite (tinted cabinet for the tower, tinted portal frame0 for
// the bonfire, front sprite for the back view) so this branch runs green
// standalone and picks up the real art once both branches merge.
export const OPTIONAL_ASSET_KEYS = {
	wizardTower: "wizard-tower",
	characterIdleBack: "character-idle-back",
	bonfireFrame: bonfireFrameKey,
} as const;

export const OPTIONAL_ASSET_PATHS = {
	[OPTIONAL_ASSET_KEYS.wizardTower]: `${ASSET_BASE}/placeholders/wizard_tower_soft.png`,
	[OPTIONAL_ASSET_KEYS.characterIdleBack]: `${ASSET_BASE}/placeholders/character_idle_back_soft.png`,
	bonfireFrame: (index: number) =>
		`${ASSET_BASE}/placeholders/bonfire_frame${index}_soft.png`,
} as const;
