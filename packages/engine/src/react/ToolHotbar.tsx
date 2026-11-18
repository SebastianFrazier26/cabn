import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import type { OwnerCapability } from "../systems/ownerApi.js";
import {
	createOwnerToolkitTool,
	OWNER_TOOLKIT_HOTKEY,
	ownerToolkitEntries,
} from "../systems/ownerToolkit.js";
import {
	reduceToolCard,
	TOOL_CARD_IDLE,
	TOOL_CARD_LINGER_MS,
	type ToolCardContent,
	toolCardContent,
	visibleToolId,
} from "../systems/toolCard.js";
import {
	createDefaultToolRegistry,
	type Tool,
	type ToolRegistry,
} from "../systems/tools.js";
import { classifyFocus, type FocusCandidate } from "../systems/uiFocus.js";
import { iconFallback, useLayerIcon } from "./layerIcons.js";
import { OwnerToolkit } from "./OwnerToolkit.js";
import { useCabnStore } from "./useCabnStore.js";

export interface ToolHotbarProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	/** Only whether it has `git` is read here: the toolkit's git entries. */
	owner?: OwnerCapability;
}

// Which tool's slot gets the mockup's gold-ring "selected" treatment — most
// tools are momentary actions with no persistent "equipped" state, so this
// only covers spyglass/orb (a real open/closed panel to reflect). quill/wand
// have their own open states too (mode === "editor"/"run"), but the whole
// hotbar is hidden in both of those modes (see the early return below), so
// there's no slot left to ring; opener/bag have no open state at all.
const HOTKEY_TOOL_IDS: Record<string, string> = {
	f: "orb",
	l: "spyglass",
	b: "bag",
	q: "quill",
	r: "wand",
};

function isToolSelected(
	toolId: string,
	state: { spyglassOpen: boolean; searchOpen: boolean },
): boolean {
	if (toolId === "spyglass") return state.spyglassOpen;
	if (toolId === "orb") return state.searchOpen;
	return false;
}

/**
 * Bottom hotbar rendering the tool registry's slots, plus the owner's one
 * toolkit slot on an owner page. Owns the one global keydown listener for
 * the React-side tools (L/F/B/Q/R, O, Cmd/Ctrl+F) — Enter
 * stays Phaser-only (each scene polls it directly for frame-accurate feel;
 * see systems/tools.ts's opener comment) so it isn't bound here.
 */
export function ToolHotbar({
	store,
	bus,
	owner,
}: ToolHotbarProps): React.ReactElement | null {
	const [registry] = useState<ToolRegistry>(() => createDefaultToolRegistry());
	const [ownerTool] = useState(createOwnerToolkitTool);
	const iconFor = useLayerIcon(store);
	const ownerSigns = useCabnStore(store, (s) => s.ownerSigns !== null);
	const hasGitHistory = useCabnStore(store, (s) => s.git !== null);
	const worldLayers = useCabnStore(store, (s) => s.worldLayers);
	const activeLayerId = useCabnStore(store, (s) => s.activeLayerId);
	const signPlacing = useCabnStore(store, (s) => s.signPlacing);
	const toolkitOpen = useCabnStore(store, (s) => s.ownerToolkitOpen);
	const ownerGit = owner?.git !== undefined;
	const toolkitEntries = useMemo(
		() =>
			ownerToolkitEntries({
				signs: ownerSigns,
				git: ownerGit && hasGitHistory,
				layers: worldLayers,
				signPlacing,
				activeLayerId,
			}),
		[
			ownerSigns,
			ownerGit,
			hasGitHistory,
			worldLayers,
			signPlacing,
			activeLayerId,
		],
	);
	const hasToolkit = toolkitEntries.length > 0;
	const bagCount = useCabnStore(store, (s) => s.bagSlots.length);
	const mode = useCabnStore(store, (s) => s.mode);
	const spyglassOpen = useCabnStore(store, (s) => s.spyglassOpen);
	const searchOpen = useCabnStore(store, (s) => s.searchOpen);
	const writing = useCabnStore(
		store,
		(s) => s.mode === "file" && s.activeFileState !== null,
	);

	const [card, dispatchCard] = useReducer(reduceToolCard, TOOL_CARD_IDLE);
	const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(expiry.current), []);
	const onSlotCard = useCallback(
		(event: Parameters<typeof reduceToolCard>[1], lingerMs?: number) => {
			clearTimeout(expiry.current);
			dispatchCard(event);
			if (lingerMs !== undefined)
				expiry.current = setTimeout(
					() => dispatchCard({ type: "expire" }),
					lingerMs,
				);
		},
		[],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// The editor traps its own keys (including single letters that would
			// otherwise dispatch a tool, e.g. typing "b" in code) — the focus
			// check below covers CodeMirror's contenteditable too, but the mode
			// check also covers clicks on the spellbook's own buttons. A run in progress
			// has its own keys (Space/N/1-2-4/Esc, see RunOverlay) that would
			// otherwise collide with nothing here today but are excluded on the
			// same principle — this hotbar's keys are for "not currently inside
			// another modal thing".
			const currentMode = store.getState().mode;
			if (currentMode === "editor" || currentMode === "run") return;

			const key = event.key.toLowerCase();

			// Cmd/Ctrl+F always intercepts, even while the orb's own search input
			// is focused — the whole point is stopping the browser's native find
			// from popping up over the game.
			if (key === "f" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				registry.dispatch("orb", { store, bus });
				return;
			}
			if (classifyFocus(event.target as FocusCandidate | null) === "text")
				return;

			// Cmd/Ctrl/Alt chords belong to the browser/OS (Cmd+R reload, Cmd+Q
			// quit) — they used to fire the wand/quill on their way through.
			if (event.metaKey || event.ctrlKey || event.altKey) return;

			if (key === OWNER_TOOLKIT_HOTKEY.toLowerCase()) {
				// No slot means no owner capability (the hosted demo): O is inert.
				if (!hasToolkit || currentMode !== "world" || event.repeat) return;
				event.preventDefault();
				ownerTool.onUse({ store, bus });
				return;
			}
			const toolId = HOTKEY_TOOL_IDS[key];
			if (!toolId) return;
			// Opening the orb focuses its input during this same keydown, so
			// without this the "f" itself landed in the search box.
			event.preventDefault();
			registry.dispatch(toolId, { store, bus });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [registry, ownerTool, hasToolkit, store, bus]);

	// Hidden rather than just non-interactive while the editor is open — its
	// tools (opener/spyglass/orb/bag-as-selection) all read as "world/file
	// navigation", none of which apply mid-edit, and the space is better left
	// to the editor panel. Same reasoning for a run in progress: RunOverlay
	// owns the screen instead.
	if (mode === "editor" || mode === "run") return null;

	const cardTool = [...registry.list(), ownerTool].find(
		(t) => t.id === visibleToolId(card),
	);
	const slotCount =
		registry.list().length + (hasToolkit && mode === "world" ? 1 : 0);

	return (
		<>
			<div
				className="cabn-hotbar"
				style={{ "--cabn-slots": slotCount } as React.CSSProperties}
			>
				<div className="cabn-hotbar-row">
					{registry.list().map((tool) => (
						<HotbarSlot
							key={tool.id}
							tool={tool}
							badge={tool.id === "bag" && bagCount > 0 ? bagCount : null}
							selected={isToolSelected(tool.id, { spyglassOpen, searchOpen })}
							iconFor={iconFor}
							onUse={() => registry.dispatch(tool.id, { store, bus })}
							onCard={onSlotCard}
						/>
					))}
					{hasToolkit && mode === "world" && (
						<span style={{ position: "relative", display: "flex" }}>
							<HotbarSlot
								tool={ownerTool}
								badge={null}
								selected={toolkitOpen || signPlacing}
								iconFor={iconFor}
								onUse={() => ownerTool.onUse({ store, bus })}
								onCard={onSlotCard}
							/>
							{toolkitOpen && (
								<OwnerToolkit
									store={store}
									bus={bus}
									entries={toolkitEntries}
								/>
							)}
						</span>
					)}
				</div>
				{[...registry.list(), ownerTool].map((tool) => (
					<span
						key={tool.id}
						id={`cabn-tool-desc-${tool.id}`}
						className="cabn-sr-only"
					>
						{tool.description}
					</span>
				))}
			</div>
			{cardTool && !spyglassOpen && (
				<ToolCard content={toolCardContent(cardTool, writing)} />
			)}
		</>
	);
}

function ToolCard({
	content,
}: {
	content: ToolCardContent;
}): React.ReactElement {
	return (
		<div
			className="cabn-panel cabn-tool-card"
			data-testid="cabn-tool-card"
			aria-hidden="true"
		>
			<div className="cabn-tool-card-head">
				<span>{content.name}</span>
				<span className="cabn-tool-card-key">{content.key}</span>
			</div>
			<div className="cabn-tool-card-text">{content.description}</div>
		</div>
	);
}

function HotbarSlot({
	tool,
	badge,
	selected,
	iconFor,
	onUse,
	onCard,
}: {
	tool: Tool;
	badge: number | null;
	selected: boolean;
	iconFor: (src: string) => string;
	onUse: () => void;
	onCard: (
		event: Parameters<typeof reduceToolCard>[1],
		lingerMs?: number,
	) => void;
}): React.ReactElement {
	const label = tool.label;
	return (
		<button
			type="button"
			onClick={(event) => {
				onUse();
				// A mouse click would otherwise leave focus on this slot, and the
				// next Enter meant for the world would re-click it as well.
				event.currentTarget.blur();
			}}
			aria-describedby={`cabn-tool-desc-${tool.id}`}
			onPointerEnter={() => onCard({ type: "hover", id: tool.id })}
			onPointerLeave={(event) =>
				onCard(
					{ type: "unhover", id: tool.id },
					event.pointerType === "mouse"
						? TOOL_CARD_LINGER_MS.mouse
						: TOOL_CARD_LINGER_MS.touch,
				)
			}
			onFocus={(event) => {
				// A mouse press focuses the slot too, but hover already shows the card
				// and the click handler blurs it straight away.
				if (event.currentTarget.matches(":focus-visible"))
					onCard({ type: "focus", id: tool.id });
			}}
			onBlur={() =>
				onCard({ type: "blur", id: tool.id }, TOOL_CARD_LINGER_MS.mouse)
			}
			data-tool={tool.id}
			className={`cabn-hotbar-slot${selected ? " selected" : ""}${label ? " labeled" : ""}`}
			style={{ pointerEvents: "auto" }}
		>
			<img
				src={iconFor(tool.icon)}
				alt={tool.name}
				onError={iconFallback(tool.icon)}
			/>
			<span className="cabn-key">
				{/* The labeled slot's corner only fits one glyph beside the icon. */}
				{label && tool.hotkey === "Enter" ? "↵" : tool.hotkey}
			</span>
			{label && <span className="cabn-slot-label">{label}</span>}
			{badge !== null && <span className="cabn-badge">{badge}</span>}
		</button>
	);
}
