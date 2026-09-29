import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import {
	newConversation,
	type PetConversation,
	type PetProgress,
	runPetTurn,
} from "./agentLoop.js";
import { petErrorMessage } from "./errors.js";
import { loadKey, redactKey } from "./keyStore.js";
import { endpointFor, loadPetSettings, modelFor } from "./petConfig.js";
import { PET_PROVIDERS } from "./providers.js";

/**
 * One pet conversation per game: runs a question through the agent loop
 * with the key read fresh from keyStore, and turns the outcome into chat
 * messages and spellbook proposals on the store. The key is only ever a
 * local in ask(); it's never kept on this object.
 */
export class PetSession {
	private conversation: PetConversation | null = null;
	private controller: AbortController | null = null;
	private seq = 0;

	constructor(
		private readonly store: StoreApi<CabnStore>,
		private readonly doFetch: typeof fetch = (input, init) =>
			globalThis.fetch(input, init),
	) {}

	get running(): boolean {
		return this.controller !== null;
	}

	private id(prefix: string): string {
		this.seq += 1;
		return `${prefix}${this.seq}`;
	}

	reset(): void {
		this.stop();
		this.conversation = null;
	}

	stop(): void {
		this.controller?.abort();
		this.controller = null;
	}

	async ask(
		question: string,
		onProgress?: (event: PetProgress | null) => void,
	): Promise<void> {
		const trimmed = question.trim();
		const state = this.store.getState();
		const providerId = state.petProvider;
		if (!trimmed || !providerId || this.controller) return;
		const provider = PET_PROVIDERS[providerId];
		state.addPetMessage({ id: this.id("m"), role: "player", text: trimmed });

		const world = state.petWorld;
		if (!world) {
			state.addPetMessage({
				id: this.id("m"),
				role: "pet",
				text: `${provider.sound}? Walk into a world with me first, then ask me about its files.`,
			});
			return;
		}
		const apiKey = provider.needsKey ? loadKey(providerId) : null;
		if (provider.needsKey && !apiKey) {
			state.addPetMessage({
				id: this.id("m"),
				role: "pet",
				text: `${provider.sound}… I need your ${provider.label} key before I can answer. Add it in my panel (Pet, top left).`,
				error: true,
			});
			return;
		}
		if (this.conversation?.providerId !== providerId)
			this.conversation = newConversation(providerId);

		const settings = loadPetSettings();
		const model = modelFor(settings, providerId);
		const endpoint = endpointFor(settings, providerId);
		const controller = new AbortController();
		this.controller = controller;
		try {
			const outcome = await runPetTurn(this.conversation, trimmed, {
				fetch: this.doFetch,
				provider,
				model,
				endpoint,
				apiKey,
				world,
				signal: controller.signal,
				newProposalId: () => this.id("p"),
				onProgress: (event) => onProgress?.(event),
			});
			const s = this.store.getState();
			if (outcome.proposals.length > 0) s.addPetProposals(outcome.proposals);
			if (outcome.ok) {
				const text =
					redactKey(outcome.text, apiKey).trim() ||
					(outcome.proposals.length > 0
						? `${provider.sound}! I've written a proposal for you to review.`
						: `${provider.sound}…`);
				s.addPetMessage({
					id: this.id("m"),
					role: "pet",
					text:
						outcome.stoppedEarly === "rounds"
							? `${text}\n\n(I ran out of steps for this question; ask me to keep going if you'd like.)`
							: text,
					cited: outcome.cited,
					proposalIds: outcome.proposals.map((p) => p.id),
				});
			} else {
				const pageOrigin =
					typeof location === "undefined" ? undefined : location.origin;
				const message = petErrorMessage(providerId, outcome.failure, {
					model,
					endpoint,
					pageOrigin,
				});
				s.addPetMessage({
					id: this.id("m"),
					role: "pet",
					text: message.text,
					link: message.link,
					error: outcome.failure.kind !== "aborted",
				});
			}
		} finally {
			if (this.controller === controller) this.controller = null;
			onProgress?.(null);
		}
	}
}
