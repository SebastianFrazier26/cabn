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
