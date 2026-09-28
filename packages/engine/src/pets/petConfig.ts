import { z } from "zod";
import { hasKey } from "./keyStore.js";
import {
	defaultEndpoint,
	defaultModel,
	isPetProviderId,
	PET_PROVIDERS,
	type PetProviderId,
} from "./providers.js";

/**
 * The pet's non-secret settings (which provider, model and endpoint), kept
 * in localStorage so the pet is still there next visit. Keys are not here
 * — see keyStore.ts.
 */
export interface PetSettings {
	provider: PetProviderId | null;
	models: Partial<Record<PetProviderId, string>>;
	endpoints: Partial<Record<PetProviderId, string>>;
}

const SETTINGS_KEY = "cabn:pet-settings";

const SettingsSchema = z.object({
	provider: z.string().nullable(),
	models: z.record(z.string(), z.string().max(200)),
	endpoints: z.record(z.string(), z.string().max(500)),
});

export function emptyPetSettings(): PetSettings {
	return { provider: null, models: {}, endpoints: {} };
}

export function parsePetSettings(json: unknown): PetSettings {
	const parsed = SettingsSchema.safeParse(json);
	if (!parsed.success) return emptyPetSettings();
	const out = emptyPetSettings();
	out.provider = isPetProviderId(parsed.data.provider)
		? parsed.data.provider
		: null;
	for (const [id, model] of Object.entries(parsed.data.models)) {
		if (isPetProviderId(id)) out.models[id] = model;
	}
	for (const [id, url] of Object.entries(parsed.data.endpoints)) {
		if (isPetProviderId(id) && endpointAllowed(id, url))
			out.endpoints[id] = url;
	}
	return out;
}

export function loadPetSettings(): PetSettings {
	try {
		const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
		return raw ? parsePetSettings(JSON.parse(raw)) : emptyPetSettings();
	} catch {
		return emptyPetSettings();
	}
}

export function persistPetSettings(settings: PetSettings): void {
	try {
		globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// Settings are a convenience; the pet still works for this visit.
	}
}

export function modelFor(
	settings: PetSettings,
	provider: PetProviderId,
): string {
	return settings.models[provider] ?? defaultModel(provider);
}

export function endpointFor(
	settings: PetSettings,
	provider: PetProviderId,
): string {
	return settings.endpoints[provider] ?? defaultEndpoint(provider);
}

/**
 * Fixed-endpoint providers only accept their own listed URLs, so a tampered
 * settings entry can't redirect a key to another host. Ollama's endpoint is
 * the player's to choose, but it never carries a key, and must still be
 * plain http(s).
 */
export function endpointAllowed(provider: PetProviderId, url: string): boolean {
	const config = PET_PROVIDERS[provider];
	if (!config.endpointEditable)
		return config.endpoints.some((e) => e.url === url);
	try {
		const parsed = new URL(url);
		return (
			(parsed.protocol === "http:" || parsed.protocol === "https:") &&
			parsed.username === "" &&
			parsed.password === ""
		);
	} catch {
		return false;
	}
}

/** A key-needing provider without a key has no pet (it could only say "add a key"). */
export function activePetFor(
	provider: PetProviderId | null,
): PetProviderId | null {
	if (!provider) return null;
	return !PET_PROVIDERS[provider].needsKey || hasKey(provider)
		? provider
		: null;
}
