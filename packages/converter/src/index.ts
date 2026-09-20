import { CABN_VERSION, type World } from "@cabn/world-schema";

export function emptyWorld(name: string): World {
	return {
		version: CABN_VERSION,
		root: { kind: "cluster", name },
	};
}
