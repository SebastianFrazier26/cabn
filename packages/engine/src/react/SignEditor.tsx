import {
	parseSeyn,
	SEYN_MAX_BYTES,
	SEYN_MAX_OFFSET,
	serializeSeyn,
	seynNearValue,
} from "@cabn/world-schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore, SignDraft } from "../bridge/store.js";
import { isValidSignFileName, type SignLinkWorld } from "../systems/signs.js";
import { SignTargetPicker } from "./SignTargetPicker.js";
import { SignView } from "./SignView.js";
import { useCabnStore } from "./useCabnStore.js";

export interface SignEditorProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	world: SignLinkWorld;
}

/** The owner's sign editor — mounted only while store.signDraft is set, which the store refuses without the owner capability. */
export function SignEditor(props: SignEditorProps): React.ReactElement | null {
	const draft = useCabnStore(props.store, (s) => s.signDraft);
	const owner = useCabnStore(props.store, (s) => s.ownerSigns);
	if (!draft || !owner) return null;
	return <SignEditorPanel key={draft.path ?? "new"} {...props} draft={draft} />;
}

const CHEAT =
	"# title · - bullet · *emphasis* · [[path/file.ts|label]] · [[folder/]] · [[https://…]]";

function SignEditorPanel({
	store,
	bus,
	world,
	draft,
}: SignEditorProps & { draft: SignDraft }): React.ReactElement {
	const portals = useCabnStore(store, (s) => s.portals);
	const folders = useCabnStore(store, (s) => s.folderClusters);
	const signs = useCabnStore(store, (s) => s.signs);
	const isNew = draft.path === null;
	const [near, setNear] = useState(seynNearValue(draft.near));
	const [autoSpot, setAutoSpot] = useState(draft.offset === null);
	const [offsetX, setOffsetX] = useState(String(draft.offset?.x ?? 0));
	const [offsetY, setOffsetY] = useState(String(draft.offset?.y ?? 0));
	const [fileName, setFileName] = useState(draft.path ?? draft.suggestedPath);
	const [body, setBody] = useState(draft.body);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const textRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const el = textRef.current;
		if (!el) return;
		el.focus();
		// New signs start as "# " — put the caret where the title goes.
		const end = isNew ? Math.min(2, el.value.length) : el.value.length;
		el.setSelectionRange(end, end);
	}, [isNew]);

	const targets = useMemo(() => {
		const list = [
			...Object.keys(folders)
				.sort()
				.map((path) => seynNearValue({ kind: "folder", path })),
			...portals.map((p) => seynNearValue({ kind: "file", path: p.id })).sort(),
		];
		return list.includes(near) ? list : [near, ...list];
	}, [folders, portals, near]);

	const offset = useMemo(() => {
		if (autoSpot) return undefined;
		const x = Number.parseInt(offsetX, 10);
		const y = Number.parseInt(offsetY, 10);
		return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
	}, [autoSpot, offsetX, offsetY]);

	const content = useMemo(
		() => serializeSeyn({ near, offset }, body),
		[near, offset, body],
	);
	const doc = useMemo(
		() => parseSeyn(content, { path: fileName }),
		[content, fileName],
	);
	const bytes = useMemo(
		() => new TextEncoder().encode(content).length,
		[content],
	);

	const problem = (() => {
		if (!isValidSignFileName(fileName))
			return "File name: letters, digits, . _ - and spaces, ending in .seyn, inside the world";
		if (isNew && signs.some((s) => s.path === fileName))
			return "A sign with that file name already exists";
		if (bytes > SEYN_MAX_BYTES)
			return `Too long: ${bytes} of ${SEYN_MAX_BYTES} bytes`;
		return null;
	})();

	const cancel = useCallback(
		() => store.getState().setSignDraft(null),
		[store],
	);

	const save = useCallback(async () => {
		const api = store.getState().ownerSigns;
		if (!api || problem || saving) return;
		setSaving(true);
		setError(null);
		try {
			const entry = await api.save({ path: fileName, content, create: isNew });
			store.getState().upsertSign(entry);
			store.getState().setSignDraft(null);
			// Walks over and highlights it — the same path an orb result for a sign takes.
			bus.emit("tool:walk-to-portal", { portalId: entry.path });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}, [store, bus, problem, saving, fileName, content, isNew]);

	// Capture phase so Escape and Ctrl/Cmd+S win over everything else. Other
	// keys pass through untouched: stopping them here also kept them from
	// React's own handlers (the target picker's arrows and Enter), and the
	// panel's keyboard-owner marker already keeps them from Phaser and the
	// hotbar.
	const handlers = useRef({ save, cancel });
	handlers.current = { save, cancel };
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const picking =
				(event.target as Element | null)?.getAttribute?.("aria-expanded") ===
				"true";
			if (event.key === "Escape" && !picking) {
				event.preventDefault();
				event.stopPropagation();
				handlers.current.cancel();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				event.stopPropagation();
				void handlers.current.save();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);

	return (
		<div className="cabn-sign-backdrop">
			<div
				className="cabn-panel cabn-sign-editor"
				role="dialog"
				tabIndex={-1}
				data-cabn-keyboard-owner=""
				aria-label={isNew ? "New sign" : `Edit ${draft.path}`}
				data-testid="sign-editor"
			>
				<div className="cabn-panel-title">
					{isNew ? "New sign" : "Edit sign"}
				</div>
				<div className="cabn-sign-editor-cols">
					<div>
						<label className="cabn-sign-field">
							File
							<input
								data-testid="sign-editor-file"
								value={fileName}
								readOnly={!isNew}
								onChange={(e) => setFileName(e.target.value.trim())}
								spellCheck={false}
							/>
						</label>
						{/* Not a <label>: it would forward clicks on the picker's
						    options to the input and reopen the list. */}
						<div className="cabn-sign-field">
							Stands beside
							<SignTargetPicker
								value={near}
								targets={targets}
								onChange={setNear}
							/>
						</div>
						<div className="cabn-sign-field-row">
							<label className="cabn-sign-field">
								<span>
									<input
										type="checkbox"
										checked={autoSpot}
										onChange={(e) => setAutoSpot(e.target.checked)}
									/>{" "}
									world picks the spot
								</span>
							</label>
							{!autoSpot && (
								<>
									<label className="cabn-sign-field">
										offset x
										<input
											type="number"
											min={-SEYN_MAX_OFFSET}
											max={SEYN_MAX_OFFSET}
											value={offsetX}
											onChange={(e) => setOffsetX(e.target.value)}
										/>
									</label>
									<label className="cabn-sign-field">
										offset y
										<input
											type="number"
											min={-SEYN_MAX_OFFSET}
											max={SEYN_MAX_OFFSET}
											value={offsetY}
											onChange={(e) => setOffsetY(e.target.value)}
										/>
									</label>
								</>
							)}
						</div>
						<label className="cabn-sign-field" style={{ flex: 1 }}>
							Text
							<textarea
								ref={textRef}
								data-testid="sign-editor-text"
								value={body}
								onChange={(e) => setBody(e.target.value)}
								spellCheck
							/>
						</label>
						<div className="cabn-sign-cheat">{CHEAT}</div>
					</div>
					<div>
						<div className="cabn-sign-field">Preview</div>
						<div
							className="cabn-sign-preview"
							data-testid="sign-editor-preview"
						>
							<SignView
								doc={doc}
								fallbackTitle={fileName.slice(fileName.lastIndexOf("/") + 1)}
								world={world}
							/>
						</div>
						{doc.warnings.length > 0 && (
							<ul className="cabn-sign-warnings">
								{doc.warnings.map((w) => (
									<li key={w}>{w}</li>
								))}
							</ul>
						)}
					</div>
				</div>
				<div className="cabn-sign-actions">
					{(error ?? problem) && (
						<span className="cabn-sign-error">{error ?? problem}</span>
					)}
					<button type="button" className="cabn-btn cancel" onClick={cancel}>
						Cancel (Esc)
					</button>
					<button
						type="button"
						className="cabn-btn confirm"
						data-testid="sign-editor-save"
						disabled={Boolean(problem) || saving}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save (Ctrl/Cmd+S)"}
					</button>
				</div>
			</div>
		</div>
	);
}
