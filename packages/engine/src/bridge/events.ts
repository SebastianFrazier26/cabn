import mitt, { type Emitter } from "mitt";

// Bridge rule: state that must survive a re-render or be queried later lives
// in the store (./store.ts); a fact that only matters at the instant it
// happens (a step trigger for sound/analytics/scene wiring) goes on this bus.
// Never both — if you're tempted to also stash a bus payload in the store,
// that's a sign it belongs in the store alone and the event should carry no
// persisted meaning beyond "this just happened".
// A plain type literal, not `interface X extends Record<string, unknown>` —
// extending Record explicitly pins the index signature to `string` only,
// which then fails mitt's `Record<EventType, unknown>` constraint (EventType
// = string | symbol). A bare literal gets TS's implicit index-signature
// inference instead, which satisfies the constraint without redeclaring it.
export type CabnEvents = {
	"portal:enter": { portalId: string };
	"portal:approach": { portalId: string };
	"cluster:enter": { clusterId: string };
	"chunk:loaded": { clusterId: string };
	"shelf:enter-world": { worldId: string };
	"world:return-to-shelf": { shelfUrl: string };
	/** React (spyglass/orb result click) -> WorldScene: auto-walk the player to this portal. */
	"tool:walk-to-portal": { portalId: string };
	/** React (orb result click, file-search mode) -> FileScene: scroll to and briefly highlight this line. */
	"tool:jump-to-line": { line: number };
	/** Hotbar B press -> FileScene: start a selection at the nearest line, or confirm one already in progress. */
	"tool:bag-use": Record<string, never>;
	/** Registry-mediated opener activation (e.g. a hotbar click) -> WorldScene: same effect as pressing E. */
	"tool:opener-use": Record<string, never>;
	/** Hotbar Q press -> FileScene: open the quill/editor overlay, cursor at the line nearest the player. */
	"tool:quill-use": Record<string, never>;
	/** EditorOverlay (Ctrl/Cmd-S) -> FileScene: the open file's full text changed; FileScene re-splits its lines and reports the edit to WorldScene for persistence + the arch marker. */
	"editor:save": { portalId: string; content: string };
	/** BagTray click while the editor is open -> EditorOverlay: paste this slot's text at the caret. */
	"editor:paste-slot": { slotId: string };
	/** SpyglassPanel's per-file "reset" button -> WorldScene: drop that portal's saved override. */
	"tool:reset-file-edits": { portalId: string };
	/** SettingsCorner's "reset world" button -> WorldScene: drop every saved override/position/visited-cluster/bag-slot for this world. */
	"tool:reset-world": Record<string, never>;
	/** WorldScene -> FileScene, answering tool:reset-file-edits when the reset portal is the one currently open: swap the live view back to pristine content. */
	"file:content-reset": { portalId: string; content: string };
};

export type CabnBus = Emitter<CabnEvents>;

export function createCabnBus(): CabnBus {
	return mitt<CabnEvents>();
}
