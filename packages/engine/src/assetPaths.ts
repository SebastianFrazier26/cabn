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
