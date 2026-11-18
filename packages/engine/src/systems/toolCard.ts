import type { Tool } from "./tools.js";

/**
 * Which hotbar slot the description card is about. Hover and keyboard focus
 * are tracked separately so leaving a slot with the mouse doesn't hide the
 * card of a slot that still has focus; `linger` keeps the last card up for a
 * moment after the pointer leaves (and after a touch tap, whose pointerleave
 * fires immediately).
 */
export interface ToolCardState {
	hover: string | null;
	focus: string | null;
	linger: string | null;
}

export type ToolCardEvent =
	| { type: "hover"; id: string }
	| { type: "unhover"; id: string }
	| { type: "focus"; id: string }
	| { type: "blur"; id: string }
	| { type: "expire" };

export const TOOL_CARD_IDLE: ToolCardState = {
	hover: null,
	focus: null,
	linger: null,
};

/** Mouse leave hides quickly; a touch tap has no hover, so its card needs time to be read. */
export const TOOL_CARD_LINGER_MS = { mouse: 250, touch: 2500 } as const;

export function reduceToolCard(
	state: ToolCardState,
	event: ToolCardEvent,
): ToolCardState {
	switch (event.type) {
		case "hover":
			return { ...state, hover: event.id, linger: null };
		case "focus":
			return { ...state, focus: event.id, linger: null };
		case "unhover":
			return state.hover === event.id
				? { ...state, hover: null, linger: event.id }
				: state;
		case "blur":
			return state.focus === event.id
				? { ...state, focus: null, linger: event.id }
				: state;
		case "expire":
			return state.linger === null ? state : { ...state, linger: null };
	}
}

export function visibleToolId(state: ToolCardState): string | null {
	return state.hover ?? state.focus ?? state.linger;
}

export interface ToolCardContent {
	name: string;
	/** What the player presses; inside a text file the letters become Alt chords. */
	key: string;
	description: string;
}

export function toolCardContent(tool: Tool, writing: boolean): ToolCardContent {
	return {
		name: tool.name,
		key: writing ? `Alt+${tool.hotkey}` : tool.hotkey,
		description: tool.description,
	};
}
