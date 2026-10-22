/** The shelf's classic ring: every shelf up to SHELF_RING_MAX_STANDARD cabins keeps exactly this radius. */
export const CABIN_RING_RADIUS = 480;

/**
 * Space one cabin needs along the ring between neighbours: its sprite (~116px)
 * plus a caption wrapped at CABIN_LABEL_WRAP_PX, with air either side.
 */
export const CABIN_SLOT_PX = 300;

/** Captions wrap here so a long showcase title can't reach a neighbouring cabin. */
export const CABIN_LABEL_WRAP_PX = 180;

/**
 * The ring radius for `count` cabins: the classic 480px, grown only when
 * adjacent cabins would sit closer than CABIN_SLOT_PX apart (chord length).
 * That never happens up to 8 cabins (8 on 480px are 367px apart), so a
 * portfolio-sized shelf looks exactly like before.
 */
export function cabinRingRadius(count: number): number {
	if (count <= 1) return CABIN_RING_RADIUS;
	const needed = CABIN_SLOT_PX / (2 * Math.sin(Math.PI / count));
	return Math.max(CABIN_RING_RADIUS, Math.ceil(needed));
}

/** Cabin i of `count`, clockwise from due north. */
export function cabinPosition(
	index: number,
	count: number,
): { x: number; y: number } {
	const radius = cabinRingRadius(count);
	const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** How near the player has to be for a cabin's showcase card to show — wider than its enter radius, so the card is read while walking up. */
export const CABIN_CARD_RADIUS = 170;
