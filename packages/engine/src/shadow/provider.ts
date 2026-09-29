import {
	loadWorldSearchIndex,
	type WorldSearchIndex,
} from "../react/useWorldSearchIndex.js";
import type { WorldLayerProvider } from "../systems/worldLayer.js";
import {
	createOwnerShadowClient,
	type OwnerShadowClientOptions,
} from "./client.js";
import { SHADOW_SKIN } from "./skin.js";
import { createSudoTool } from "./sudoTool.js";

export const SHADOW_LAYER_ID = "shadow";

function conflictMessage(path: string): string {
	return `The embers shifted: ${path} changed on disk since you opened it. Reload it from disk to see it as it is now (your unsaved text here would be lost), or copy your edits somewhere first.`;
}

/**
 * The shadow realm as a world layer (systems/worldLayer.ts): hidden files
 * from `cabn serve --owner`, fetched only when the owner toggles it on.
 * Nothing it loads is ever written to the browser's storage.
 */
export function createShadowLayer(
	opts: OwnerShadowClientOptions,
): WorldLayerProvider {
	const client = createOwnerShadowClient(opts);
	let index: Promise<WorldSearchIndex> | null = null;
	return {
		id: SHADOW_LAYER_ID,
		label: "hidden",
		tools: [createSudoTool(SHADOW_LAYER_ID)],
		skin: SHADOW_SKIN,
		async load() {
			index = null;
			return client.manifest();
		},
		fetchChunk: (clusterId) => client.chunk(clusterId),
		searchIndex() {
			index ??= client
				.searchIndex()
				.then(loadWorldSearchIndex)
				.catch((err) => {
					index = null;
					throw err;
				});
			return index;
		},
		async saveFile(path, content, baseSha256) {
			let res: Awaited<ReturnType<typeof client.save>>;
			try {
				res = await client.save({ path, content, baseSha256 });
			} catch (err) {
				return {
					ok: false,
					conflict: false,
					message: `The save never reached the disk: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			if (res.status === 200 && "sha256" in res) {
				// The server rebuilds its layer lazily; the orb's copy is patched
				// here so a search right after the save sees the new text.
				const loaded = index ? await index.catch(() => null) : null;
				const doc = {
					id: path,
					path,
					name: path.slice(path.lastIndexOf("/") + 1),
					content,
				};
				if (loaded) {
					if (loaded.has(path)) loaded.replace(doc);
					else loaded.add(doc);
				}
				return { ok: true, sha256: res.sha256 };
			}
			const error = "error" in res ? res.error : `save failed (${res.status})`;
			return res.status === 409
				? { ok: false, conflict: true, message: conflictMessage(path) }
				: { ok: false, conflict: false, message: error };
		},
		saveSign: (request) => client.saveSign(request),
		removeSign: (path) => client.removeSign(path),
	};
}
