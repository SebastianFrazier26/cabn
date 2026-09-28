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
	/** WorldScene -> PortalLivePage, every frame the camera moves the near url arch: its opening in CSS px inside CabnGame's root, and whether the player is standing over it (the page dims so the player isn't hidden behind a DOM layer). */
	"portal:web-rect": {
		portalId: string;
		rect: { x: number; y: number; w: number; h: number };
		occluded: boolean;
	};
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
	/** The hotbar's opener slot -> whichever of World/Shelf/File is active: same as pressing Enter there (each scene's Enter key and click-to-interact arrival call the same interact method directly). Listeners must check they're the active scene — mitt still delivers to a sleeping WorldScene underneath FileScene. */
	"tool:opener-use": Record<string, never>;
	/** Hotbar Q press -> FileScene: open the quill/editor overlay, cursor at the line nearest the player. */
	"tool:quill-use": Record<string, never>;
	/** EditorOverlay (Ctrl/Cmd-S) -> FileScene: the open file's full text changed; FileScene re-splits its lines and reports the edit to WorldScene for persistence + the arch marker. */
	"editor:save": { portalId: string; content: string };
	/** FileStatusLine's unsaved-changes prompt -> FileScene: leave the file, saving first or discarding the buffer. */
	"file:leave": { save: boolean };
	/** BagTray click while the editor is open -> EditorOverlay: paste this slot's text at the caret. */
	"editor:paste-slot": { slotId: string };
	/** SpyglassPanel's per-file "reset" button -> WorldScene: drop that portal's saved override. */
	"tool:reset-file-edits": { portalId: string };
	/** SpyglassPanel's "reset world" button -> WorldScene: drop every saved override/position/visited-cluster/bag-slot for this world. */
	"tool:reset-world": Record<string, never>;
	/** WorldScene -> FileScene, answering tool:reset-file-edits when the reset portal is the one currently open: swap the live view back to pristine content. */
	"file:content-reset": { portalId: string; content: string };
	/** A battle's edit resolved the annotation that spawned this monster (FileScene, after re-running its originating annotator on save) -> WorldScene: persist it in the save and drop the monster from every rendered scene (this file's, and its portal's arch-hover sprite). */
	"monster:defeated": { monsterId: string };
	/** FileScene, after a save during an encounter that didn't fix the encountered monster -> EditorOverlay: a small transient toast (the editor stays open, the shrug animation plays behind it). */
	"battle:hint": { message: string };
	/** Hotbar R press -> FileScene: start a run of the currently-open file with the active ExecutionProvider (TraceProvider by default). */
	"tool:wand-use": Record<string, never>;
	/** RunOverlay's controls (Space/N/1-2-4/Esc, or their on-screen buttons) -> FileScene, which owns the actual runPlayback state machine. */
	"run:play": Record<string, never>;
	"run:pause": Record<string, never>;
	"run:step": Record<string, never>;
	"run:stop": Record<string, never>;
	"run:set-speed": { speed: 1 | 2 | 4 };
	/** The pet chat's "review in spellbook" -> WorldScene: open this file (the chat then opens the spellbook on it). */
	"pet:open-file": { portalId: string };
};

export type CabnBus = Emitter<CabnEvents>;

export function createCabnBus(): CabnBus {
	return mitt<CabnEvents>();
}
