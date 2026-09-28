import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { petPortraitPath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import type { PetProgress } from "../pets/agentLoop.js";
import { activePetFor, loadPetSettings } from "../pets/petConfig.js";
import { PetSession } from "../pets/petSession.js";
import { PET_PROVIDERS } from "../pets/providers.js";
import { PetChat } from "./PetChat.js";
import { PetSetupPanel } from "./PetSetupPanel.js";
import { usePetStyles } from "./petStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PetLayerProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * Everything pet-side in React: the "Pet" corner button, the setup panel,
 * the chat, and the one PetSession that owns the conversation. Also opens
 * the spellbook once a "review in spellbook" request has opened its file.
 */
export function PetLayer({
	store,
	bus,
}: PetLayerProps): React.ReactElement | null {
	usePetStyles();
	const mode = useCabnStore(store, (s) => s.mode);
	const worldLoaded = useCabnStore(store, (s) => s.petWorld !== null);
	const provider = useCabnStore(store, (s) => s.petProvider);
	const panelOpen = useCabnStore(store, (s) => s.petPanelOpen);
	const chatOpen = useCabnStore(store, (s) => s.petChatOpen);
	const sessionRef = useRef<PetSession | null>(null);
	sessionRef.current ??= new PetSession(store);
	const session = sessionRef.current;
	const [progress, setProgress] = useState<PetProgress | null>(null);
	const [running, setRunning] = useState(false);
	const reviewTarget = useRef<string | null>(null);

	useEffect(() => {
		store.getState().setPetProvider(activePetFor(loadPetSettings().provider));
		return () => sessionRef.current?.reset();
	}, [store]);

	useEffect(
		() =>
			store.subscribe((state, prev) => {
				if (state.petProvider !== prev.petProvider) {
					session.reset();
					state.clearPetConversation();
				}
				// New world: its files, its conversation.
				if (state.petWorld !== prev.petWorld && prev.petWorld !== null)
					session.reset();
			}),
		[store, session],
	);

	// "Review in spellbook" from the world: WorldScene opens the file, then the
	// quill needs FileScene to be up, which takes a frame or two after mode
	// flips to "file" — retried until the spellbook is open.
	useEffect(() => {
		let frame = 0;
		const unsubscribe = store.subscribe((state) => {
			const target = reviewTarget.current;
			if (!target || state.mode !== "file" || state.activePortalId !== target)
				return;
			reviewTarget.current = null;
			let tries = 0;
			const tick = () => {
				const s = store.getState();
				if (s.mode === "editor" || s.activePortalId !== target || tries++ > 60)
					return;
				bus.emit("tool:quill-use", {});
				frame = requestAnimationFrame(tick);
			};
			frame = requestAnimationFrame(tick);
		});
		return () => {
			unsubscribe();
			cancelAnimationFrame(frame);
		};
	}, [store, bus]);

	const ask = useCallback(
		async (question: string) => {
			setRunning(true);
			try {
				await session.ask(question, setProgress);
			} finally {
				setRunning(false);
			}
		},
		[session],
	);

	const review = useCallback(
		(path: string) => {
			const s = store.getState();
			s.setPetChatOpen(false);
			if (s.mode === "world") {
				reviewTarget.current = path;
				bus.emit("pet:open-file", { portalId: path });
			} else if (s.mode === "file" && s.activePortalId === path) {
				bus.emit("tool:quill-use", {});
			}
		},
		[store, bus],
	);

	const showCorner = mode === "world" && worldLoaded && !chatOpen && !panelOpen;
	const species = provider ? PET_PROVIDERS[provider].species : null;

	return (
		<>
			{showCorner && (
				<button
					type="button"
					className="cabn-pill-button cabn-pet-corner"
					data-testid="cabn-pet-corner"
					title={
						provider ? "Pet settings" : "Bring an AI pet (your own API key)"
					}
					onClick={(event) => {
						event.currentTarget.blur();
						store.getState().setPetPanelOpen(true);
					}}
				>
					{species && <img src={petPortraitPath(species)} alt="" />}
					<span>{provider ? "Pet" : "Pet ✦"}</span>
				</button>
			)}
			{panelOpen && <PetSetupPanel store={store} />}
			{chatOpen && provider && (
				<PetChat
					store={store}
					bus={bus}
					provider={provider}
					running={running}
					progress={progress}
					onAsk={ask}
					onStop={() => session.stop()}
					onReview={review}
				/>
			)}
		</>
	);
}
