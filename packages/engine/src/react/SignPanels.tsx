import {
	parseSeyn,
	type SeynLinkTarget,
	type SignEntry,
} from "@cabn/world-schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore, SignDraft } from "../bridge/store.js";
import type { SignLinkWorld } from "../systems/signs.js";
import { signWriterFor } from "../systems/worldLayer.js";
import { SignEditor } from "./SignEditor.js";
import { SignView, useSignStyles } from "./SignView.js";
import { useCabnStore } from "./useCabnStore.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface SignsProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/** Everything sign-related on the React side: the approach popup, the reader, and (owner only) the placement banner and the editor. */
export function Signs({ store, bus }: SignsProps): React.ReactElement {
	useSignStyles();
	const world = useSignLinkWorld(store);
	return (
		<>
			<SignPopup store={store} world={world} />
			<SignReader store={store} bus={bus} world={world} />
			<SignPlacingBanner store={store} bus={bus} />
			<SignEditor store={store} bus={bus} world={world} />
		</>
	);
}

export function useSignLinkWorld(store: StoreApi<CabnStore>): SignLinkWorld {
	const portals = useCabnStore(store, (s) => s.portals);
	const signs = useCabnStore(store, (s) => s.signs);
	const folders = useCabnStore(store, (s) => s.folderClusters);
	return useMemo(
		() => ({
			portalIds: new Set(portals.map((p) => p.id)),
			clusterByPath: new Map(Object.entries(folders)),
			signPaths: new Set(signs.map((s) => s.path)),
		}),
		[portals, signs, folders],
	);
}

export function signFileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function useSign(
	store: StoreApi<CabnStore>,
	path: string | null,
): SignEntry | undefined {
	const signs = useCabnStore(store, (s) => s.signs);
	return useMemo(
		() => (path ? signs.find((s) => s.path === path) : undefined),
		[signs, path],
	);
}

function SignPopup({
	store,
	world,
}: {
	store: StoreApi<CabnStore>;
	world: SignLinkWorld;
}): React.ReactElement | null {
	const path = useCabnStore(store, (s) => s.focusedSignPath);
	const hidden = useCabnStore(
		store,
		(s) =>
			s.mode !== "world" ||
			s.openSignPath !== null ||
			s.signDraft !== null ||
			s.signPlacing ||
			s.mapOpen ||
			s.guideOpen,
	);
	const sign = useSign(store, path);
	const doc = useMemo(
		() => (sign ? parseSeyn(sign.source, { path: sign.path }) : null),
		[sign],
	);
	if (!sign || !doc || hidden) return null;
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the world opens the same reader (WorldScene.interact), so the keyboard path exists without this panel taking focus
		// biome-ignore lint/a11y/noStaticElementInteractions: as above
		<div
			className="cabn-panel cabn-sign-popup"
			data-testid="sign-popup"
			data-sign-path={sign.path}
			onClick={() => store.getState().setOpenSign(sign.path)}
		>
			<div className="cabn-sign-body">
				<SignView
					doc={doc}
					fallbackTitle={signFileName(sign.path)}
					world={world}
				/>
			</div>
			<div className="cabn-sign-hint">Enter or click to read</div>
		</div>
	);
}

/** Capture-phase so Phaser's window listener and the hotbar never see keys meant for this panel; only Escape is consumed outright, so Tab and Enter on a focused button or link still work natively. */
function useModalKeys(active: boolean, onEscape: () => void): void {
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onEscape();
				return;
			}
			event.stopPropagation();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [active, onEscape]);
}

function SignReader({
	store,
	bus,
	world,
}: SignsProps & { world: SignLinkWorld }): React.ReactElement | null {
	const path = useCabnStore(store, (s) => s.openSignPath);
	const owner = useCabnStore(store, (s) => s.ownerSigns);
	const folders = useCabnStore(store, (s) => s.folderClusters);
	const sign = useSign(store, path);
	const doc = useMemo(
		() => (sign ? parseSeyn(sign.source, { path: sign.path }) : null),
		[sign],
	);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// A different sign opening resets the delete confirmation and any error.
	// biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger, not a value read inside
	useEffect(() => {
		setConfirmDelete(false);
		setError(null);
	}, [path]);
	const close = useCallback(() => store.getState().setOpenSign(null), [store]);
	useModalKeys(Boolean(sign), close);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef, Boolean(sign && doc));

	if (!sign || !doc) return null;

	const follow = (target: SeynLinkTarget) =>
		bus.emit("sign:follow-link", { target });
	const edit = () => {
		const draft: SignDraft = {
			path: sign.path,
			near: nearForEdit(sign, doc.near, folders),
			offset: doc.offset,
			body: doc.body,
			suggestedPath: sign.path,
		};
		store.getState().setOpenSign(null);
		store.getState().setSignDraft(draft);
	};
	const remove = async () => {
		const writer = signWriterFor(store.getState(), sign.path);
		if (!writer) return;
		setBusy(true);
		setError(null);
		try {
			await writer.remove(sign.path);
			store.getState().removeSign(sign.path);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes (useModalKeys); the backdrop click is the pointer equivalent
		// biome-ignore lint/a11y/noStaticElementInteractions: as above
		<div
			className="cabn-sign-backdrop"
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
		>
			<div
				ref={dialogRef}
				className="cabn-panel cabn-sign-reader"
				role="dialog"
				aria-modal="true"
				aria-label={doc.title ?? signFileName(sign.path)}
				data-testid="sign-reader"
				data-sign-path={sign.path}
			>
				<div className="cabn-sign-path">{sign.path}</div>
				<div className="cabn-sign-body">
					<SignView
						doc={doc}
						fallbackTitle={signFileName(sign.path)}
						world={world}
						onFollow={follow}
					/>
				</div>
				<div className="cabn-sign-actions">
					{error && <span className="cabn-sign-error">{error}</span>}
					{owner && !confirmDelete && (
						<>
							<button
								type="button"
								className="cabn-btn neutral"
								data-testid="sign-edit"
								onClick={edit}
							>
								Edit
							</button>
							<button
								type="button"
								className="cabn-btn cancel"
								data-testid="sign-delete"
								onClick={() => setConfirmDelete(true)}
							>
								Delete
							</button>
						</>
					)}
					{owner && confirmDelete && (
						<>
							<span className="cabn-sign-confirm">
								Delete {signFileName(sign.path)} from disk?
							</span>
							<button
								type="button"
								className="cabn-btn cancel"
								data-testid="sign-delete-confirm"
								disabled={busy}
								onClick={remove}
							>
								Delete
							</button>
							<button
								type="button"
								className="cabn-btn neutral"
								onClick={() => setConfirmDelete(false)}
							>
								Keep
							</button>
						</>
					)}
					<button
						type="button"
						className="cabn-btn confirm"
						data-testid="sign-close"
						onClick={close}
					>
						Close (Esc)
					</button>
				</div>
			</div>
		</div>
	);
}

/** The editor's "stands beside" choice for an existing sign: its @near when that's still in the world, else whatever the converter anchored it to. */
function nearForEdit(
	sign: SignEntry,
	near: ReturnType<typeof parseSeyn>["near"],
	folders: Record<string, string>,
): SignDraft["near"] {
	if (near?.kind === "file" || near?.kind === "folder")
		return { kind: near.kind, path: near.path };
	if (sign.anchor.kind === "portal")
		return { kind: "file", path: sign.anchor.id };
	const folder = Object.entries(folders).find(
		([, id]) => id === sign.anchor.id,
	);
	return { kind: "folder", path: folder?.[0] ?? "." };
}

function SignPlacingBanner({
	store,
	bus,
}: SignsProps): React.ReactElement | null {
	const placing = useCabnStore(store, (s) => s.signPlacing);
	useEffect(() => {
		if (!placing) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" && event.key !== "Enter") return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") store.getState().setSignPlacing(false);
			else bus.emit("sign:place-here", {});
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [placing, store, bus]);
	if (!placing) return null;
	return (
		<div className="cabn-panel cabn-sign-banner" data-testid="sign-placing">
			Click where the new sign should stand · Enter: beside you · Esc: cancel
		</div>
	);
}
