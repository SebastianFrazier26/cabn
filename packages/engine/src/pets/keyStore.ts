import type { PetProviderId } from "./providers.js";

/**
 * The player's own provider keys, and the only place they live. Security
 * rules (user decision, 2026-09-28): keys stay in this browser — module
 * memory plus sessionStorage by default, localStorage only when the player
 * ticks "remember on this device". Never in the zustand store (the demo's
 * ?e2e=1 hook exposes it on window, and saves/exports serialise game
 * state), never in world saves, URLs, logs or error text. Provider calls
 * read the key from here at request time.
 */

export type KeyPersistence = "session" | "device";

const STORAGE_PREFIX = "cabn:pet-key:";
const memory = new Map<PetProviderId, string>();

function storageKey(provider: PetProviderId): string {
	return `${STORAGE_PREFIX}${provider}`;
}

type StorageName = "sessionStorage" | "localStorage";

function storage(name: StorageName): Storage | null {
	try {
		const s = globalThis[name];
		return s ?? null;
	} catch {
		// Access itself throws with site data blocked.
		return null;
	}
}

function read(name: StorageName, provider: PetProviderId): string | null {
	try {
		return storage(name)?.getItem(storageKey(provider)) ?? null;
	} catch {
		return null;
	}
}

function remove(name: StorageName, provider: PetProviderId): void {
	try {
		storage(name)?.removeItem(storageKey(provider));
	} catch {
		// Nothing stored if storage is unavailable.
	}
}

function write(
	name: StorageName,
	provider: PetProviderId,
	key: string,
): boolean {
	try {
		const s = storage(name);
		if (!s) return false;
		s.setItem(storageKey(provider), key);
		return true;
	} catch {
		return false;
	}
}

/** Keys are pasted, so stray whitespace/newlines are the common mistake; anything else is the provider's to judge. */
export function normalizeKey(raw: string): string {
	return raw.replace(/\s+/g, "");
}

export function saveKey(
	provider: PetProviderId,
	rawKey: string,
	persistence: KeyPersistence,
): void {
	const key = normalizeKey(rawKey);
	if (!key) {
		forgetKey(provider);
		return;
	}
	memory.set(provider, key);
	if (persistence === "device") {
		remove("sessionStorage", provider);
		write("localStorage", provider, key);
	} else {
		remove("localStorage", provider);
		write("sessionStorage", provider, key);
	}
}

export function loadKey(provider: PetProviderId): string | null {
	const inMemory = memory.get(provider);
	if (inMemory) return inMemory;
	const stored =
		read("sessionStorage", provider) ?? read("localStorage", provider);
	if (stored) memory.set(provider, stored);
	return stored;
}

export function hasKey(provider: PetProviderId): boolean {
	return loadKey(provider) !== null;
}

export function keyPersistence(provider: PetProviderId): KeyPersistence | null {
	if (read("localStorage", provider)) return "device";
	if (read("sessionStorage", provider) || memory.has(provider))
		return "session";
	return null;
}

export function forgetKey(provider: PetProviderId): void {
	memory.delete(provider);
	remove("sessionStorage", provider);
	remove("localStorage", provider);
}

/** Replaces any occurrence of a live key (or a 12+ char slice of it) in text bound for the screen or a log — defence in depth behind never echoing provider error bodies at all. */
export function redactKey(text: string, key: string | null): string {
	if (!key || key.length < 8) return text;
	let out = text.split(key).join("[key hidden]");
	for (let i = 0; i + 12 <= key.length; i += 6) {
		out = out.split(key.slice(i, i + 12)).join("[key hidden]");
	}
	return out;
}
