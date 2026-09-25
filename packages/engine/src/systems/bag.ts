/**
 * The bag tool's slot storage — grabbed text ranges from FileScene. Paste is
 * deferred to M5 (needs the editor), so for M4 this is purely a capped,
 * append-and-evict collection shown in the HUD.
 */
export const MAX_BAG_SLOTS = 5;

export interface BagSlot {
	id: string;
	text: string;
	sourcePortalId: string;
	startLine: number;
	endLine: number;
}

/** FIFO: adding past capacity evicts the oldest slot, not the newest. */
export function addBagSlot(
	slots: readonly BagSlot[],
	slot: BagSlot,
	max = MAX_BAG_SLOTS,
): BagSlot[] {
	const next = [...slots, slot];
	return next.length > max ? next.slice(next.length - max) : next;
}

export function removeBagSlot(
	slots: readonly BagSlot[],
	id: string,
): BagSlot[] {
	return slots.filter((s) => s.id !== id);
}
