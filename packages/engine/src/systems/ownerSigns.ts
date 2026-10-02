import type { SignEntry } from "@cabn/world-schema";

export interface OwnerSignSaveRequest {
	/** World-relative .seyn path. */
	path: string;
	/** Full file text (header + body), as serializeSeyn writes it. */
	content: string;
	/** True for a new sign: the save fails rather than overwrite a file already at `path`. False: the file must already exist. */
	create: boolean;
}

/**
 * The owner capability a host page hands CabnGame (`ownerSigns` prop). Only
 * `cabn serve`'s local host page ever passes one (see @cabn/engine/owner);
 * hosted builds and the demo don't, and without it the engine shows no sign
 * item and no edit/delete controls. The engine never learns how saves are
 * authenticated — that lives entirely in the implementation.
 */
export interface OwnerSignsApi {
	/** Resolves to the sign as the world now has it (anchor resolved by the server's converter). Rejects with a message fit to show the owner. */
	save(request: OwnerSignSaveRequest): Promise<SignEntry>;
	remove(path: string): Promise<void>;
}
