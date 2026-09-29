import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { petPortraitPath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore, PetChatMessage } from "../bridge/store.js";
import type { PetProgress } from "../pets/agentLoop.js";
import { PET_PROVIDERS, type PetProviderId } from "../pets/providers.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PetChatProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	provider: PetProviderId;
	running: boolean;
	progress: PetProgress | null;
	onAsk(question: string): void;
	onStop(): void;
	onReview(path: string): void;
}

const TOOL_VERBS: Record<string, string> = {
	list_files: "Looking around the clearings",
	read_file: "Reading",
	search: "Gazing into the orb",
	propose_edit: "Scribbling a proposal for",
};

/** Dark ink on the light pet colours (cat, llama, bird, owl), white on the dark ones (ferret, whale). */
function inkFor(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16);
	const luminance =
		0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
	return luminance > 140 ? "#201a3d" : "#ffffff";
}

function progressLine(progress: PetProgress | null): string {
	if (!progress) return "";
	if (progress.type === "thinking")
		return progress.round === 0 ? "Thinking…" : "Mulling it over…";
	const verb = TOOL_VERBS[progress.name] ?? "Working";
	return progress.path ? `${verb} ${progress.path}…` : `${verb}…`;
}

/**
 * The pet's chat box: pixel-RPG panel, plain-text answers (never rendered
 * as HTML or markdown, so a file can't smuggle a link or image into the
 * page), clickable citations that walk the player to a file's arch, and
 * proposal cards that open the spellbook's review page.
 */
export function PetChat({
	store,
	bus,
	provider,
	running,
	progress,
	onAsk,
	onStop,
	onReview,
}: PetChatProps): React.ReactElement {
	const config = PET_PROVIDERS[provider];
	const messages = useCabnStore(store, (s) => s.petMessages);
	const proposals = useCabnStore(store, (s) => s.petProposals);
	const [draft, setDraft] = useState("");
	const logRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on purpose whenever a message or progress line lands, to keep the log scrolled to the bottom.
	useEffect(() => {
		const log = logRef.current;
		if (log) log.scrollTop = log.scrollHeight;
	}, [messages, progress]);

	useEffect(() => {
		// Capture phase: Esc must close the chat, never reach the world (Esc by
		// the bonfire leaves the world).
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			if (running) onStop();
			else store.getState().setPetChatOpen(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store, running, onStop]);

	const send = () => {
		if (running || !draft.trim()) return;
		onAsk(draft);
		setDraft("");
	};

	const walkTo = (path: string) => {
		store.getState().setPetChatOpen(false);
		bus.emit("tool:walk-to-portal", { portalId: path });
	};

	const greeting: PetChatMessage = {
		id: "greeting",
		role: "pet",
		text: `${config.sound}! Ask me anything about this world's files. I can read them, search them, and suggest edits for you to review in your spellbook.`,
	};

	return (
		<div
			className="cabn-panel cabn-pet-chat"
			role="dialog"
			tabIndex={-1}
			data-cabn-keyboard-owner=""
			aria-label={`${config.petName} chat`}
			data-testid="cabn-pet-chat"
		>
			<div
				className="cabn-pet-name"
				style={{ background: config.accent, color: inkFor(config.accent) }}
			>
				{config.petName}
			</div>
			<div className="cabn-pet-log" ref={logRef} aria-live="polite">
				{[greeting, ...messages].map((m) => (
					<div
						key={m.id}
						className={`cabn-pet-msg ${m.role}${m.error ? " error" : ""}`}
						data-testid="cabn-pet-message"
						data-role={m.role}
					>
						{m.role === "pet" && (
							<img src={petPortraitPath(config.species)} alt="" />
						)}
						<div className="cabn-pet-bubble">
							{m.text}
							{m.link && (
								<>
									{" "}
									<a
										href={m.link.href}
										target="_blank"
										rel="noreferrer noopener"
										data-testid="cabn-pet-link"
									>
										{m.link.label}
									</a>
									.
								</>
							)}
							{m.cited && m.cited.length > 0 && (
								<div className="cabn-pet-cites">
									{m.cited.map((path) => (
										<button
											key={path}
											type="button"
											className="cabn-pet-cite"
											data-testid="cabn-pet-cite"
											title="Walk to this file's arch"
											onClick={() => walkTo(path)}
										>
											{path}
										</button>
									))}
								</div>
							)}
							{m.proposalIds?.map((pid) => {
								const proposal = proposals.find((p) => p.id === pid);
								if (!proposal) return null;
								return (
									<div
										key={pid}
										className="cabn-pet-proposal-card"
										data-testid="cabn-pet-proposal-card"
									>
										<span>
											✎ <strong>{proposal.path}</strong>: {proposal.summary}{" "}
											<em>({proposal.status})</em>
										</span>
										{proposal.status === "pending" && (
											<button
												type="button"
												className="cabn-btn confirm"
												data-testid="cabn-pet-review"
												onClick={() => onReview(proposal.path)}
											>
												Review in spellbook
											</button>
										)}
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>
			<div className="cabn-pet-progress" data-testid="cabn-pet-progress">
				{running ? progressLine(progress) : ""}
			</div>
			<div className="cabn-pet-compose">
				<textarea
					ref={inputRef}
					className="cabn-pet-input"
					data-testid="cabn-pet-input"
					rows={2}
					placeholder={`Ask ${config.petName.split(" ")[0]} about this world…`}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							send();
						}
					}}
				/>
				{running ? (
					<button
						type="button"
						className="cabn-btn cancel"
						data-testid="cabn-pet-stop"
						onClick={onStop}
					>
						Stop
					</button>
				) : (
					<button
						type="button"
						className="cabn-btn confirm"
						data-testid="cabn-pet-send"
						onClick={send}
					>
						Ask
					</button>
				)}
			</div>
			<div
				className="cabn-pet-row"
				style={{ justifyContent: "space-between", fontSize: 11 }}
			>
				<span className="cabn-pet-note">
					Asks go straight from this browser to {config.label}, billed to your
					key.
				</span>
				<span className="cabn-pet-row">
					<button
						type="button"
						className="cabn-btn neutral"
						onClick={() => {
							store.getState().setPetChatOpen(false);
							store.getState().setPetPanelOpen(true);
						}}
					>
						Settings
					</button>
					<button
						type="button"
						className="cabn-btn cancel"
						data-testid="cabn-pet-chat-close"
						onClick={() => store.getState().setPetChatOpen(false)}
					>
						Bye (Esc)
					</button>
				</span>
			</div>
		</div>
	);
}
