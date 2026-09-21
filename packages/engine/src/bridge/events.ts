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
};

export type CabnBus = Emitter<CabnEvents>;

export function createCabnBus(): CabnBus {
	return mitt<CabnEvents>();
}
