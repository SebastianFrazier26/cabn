import type { GitMeta } from "@cabn/world-schema";
import type { BrowserRepo } from "./types.js";

const repos = new Map<string, Promise<BrowserRepo>>();
const loaded = new Set<string>();

/** Whether the reader for this world already loaded — the map timeline then shows at once instead of offering to load. */
export function isRepoLoaded(historyBase: string): boolean {
	return loaded.has(historyBase);
}

/**
 * The only door to the git reader: a dynamic import, so isomorphic-git, the
 * Buffer polyfill and the on-demand converter land in their own chunk and a
 * plain page load never fetches them (or the pack). One repository per
 * main-world bundle for the page's lifetime.
 */
export function loadBrowserRepo(
	historyBase: string,
	meta: GitMeta,
): Promise<BrowserRepo> {
	let pending = repos.get(historyBase);
	if (!pending) {
		pending = import("./browserRepo.js")
			.then((m) => m.openBrowserRepo(historyBase, meta))
			.then((repo) => {
				loaded.add(historyBase);
				return repo;
			});
		pending.catch(() => repos.delete(historyBase));
		repos.set(historyBase, pending);
	}
	return pending;
}
