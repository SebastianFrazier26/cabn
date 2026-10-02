import { useEffect, useMemo, useRef, useState } from "react";
import {
	filterSymbols,
	type OutlineSymbol,
	parseGoToLine,
} from "../systems/editorOutline.js";
import {
	isValidIdentifier,
	type RenameOccurrence,
} from "../systems/editorRename.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * Escape/Enter are handled here and stopped before they reach
 * EditorOverlay's window-level listener (where Esc closes the whole book) —
 * the first Esc only dismisses the dialog.
 */
function dialogKeys(
	event: React.KeyboardEvent,
	onClose: () => void,
	onEnter?: () => void,
): void {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		onClose();
	} else if (event.key === "Enter" && onEnter) {
		event.preventDefault();
		event.stopPropagation();
		onEnter();
	}
}

export function GoToLineDialog({
	totalLines,
	currentLine,
	onGo,
	onClose,
}: {
	totalLines: number;
	currentLine: number;
	onGo(line: number, column: number): void;
	onClose(): void;
}): React.ReactElement {
	const [value, setValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => inputRef.current?.focus(), []);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);
	const parsed = parseGoToLine(value, totalLines);
	const submit = () => {
		if (parsed) onGo(parsed.line, parsed.column);
	};
	return (
		<div
			ref={dialogRef}
			className="cabn-spellbook-dialog"
			role="dialog"
			aria-modal="true"
			aria-label="Go to line"
		>
			<div className="cabn-spellbook-dialog-title">Go to line</div>
			<input
				ref={inputRef}
				className="cabn-spellbook-input"
				value={value}
				placeholder={`line[:column] — 1 to ${totalLines}`}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => dialogKeys(e, onClose, submit)}
			/>
			<div className="cabn-spellbook-dialog-hint">
				{value.trim() === ""
					? `Currently on line ${currentLine}`
					: parsed
						? `Enter to jump to line ${parsed.line + 1}${parsed.column ? `, column ${parsed.column + 1}` : ""}`
						: "Type a number, e.g. 42 or 42:7"}
			</div>
		</div>
	);
}

const KIND_GLYPH: Record<OutlineSymbol["kind"], string> = {
	function: "ƒ",
	method: "m",
	class: "C",
	type: "T",
	variable: "v",
	heading: "#",
	selector: "{}",
	key: "k",
};

export function SymbolPicker({
	symbols,
	onPick,
	onClose,
}: {
	symbols: readonly OutlineSymbol[];
	onPick(symbol: OutlineSymbol): void;
	onClose(): void;
}): React.ReactElement {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	useEffect(() => inputRef.current?.focus(), []);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);
	const results = useMemo(
		() => filterSymbols(symbols, query),
		[symbols, query],
	);
	const clamped = Math.min(active, Math.max(results.length - 1, 0));
	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${clamped}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [clamped]);
	const minDepth = symbols.reduce(
		(m, s) => Math.min(m, s.depth),
		Number.POSITIVE_INFINITY,
	);

	return (
		<div
			ref={dialogRef}
			className="cabn-spellbook-dialog"
			role="dialog"
			aria-modal="true"
			aria-label="Go to symbol"
		>
			<div className="cabn-spellbook-dialog-title">Go to symbol</div>
			<input
				ref={inputRef}
				className="cabn-spellbook-input"
				value={query}
				placeholder="filter names…"
				onChange={(e) => {
					setQuery(e.target.value);
					setActive(0);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						const step = e.key === "ArrowDown" ? 1 : -1;
						setActive((i) =>
							results.length === 0
								? 0
								: (Math.min(i, results.length - 1) + step + results.length) %
									results.length,
						);
						return;
					}
					dialogKeys(e, onClose, () => {
						const pick = results[clamped];
						if (pick) onPick(pick);
					});
				}}
			/>
			{results.length === 0 ? (
				<div className="cabn-spellbook-dialog-hint">
					{symbols.length === 0
						? "No functions, classes or headings found in this file"
						: "No symbol matches"}
				</div>
			) : (
				<ul id="cabn-symbol-list" ref={listRef} className="cabn-spellbook-list">
					{results.map((symbol, i) => (
						<li key={`${symbol.line}:${symbol.name}`}>
							<button
								type="button"
								data-index={i}
								aria-current={i === clamped}
								className={`cabn-spellbook-list-row${i === clamped ? " active" : ""}`}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => onPick(symbol)}
								style={{
									paddingLeft:
										8 +
										Math.min(
											query
												? 0
												: symbol.depth -
														(Number.isFinite(minDepth) ? minDepth : 0),
											16,
										) *
											(symbol.kind === "heading" ? 10 : 2),
								}}
							>
								<span className="cabn-spellbook-kind">
									{KIND_GLYPH[symbol.kind]}
								</span>
								<span className="cabn-spellbook-list-name">{symbol.name}</span>
								<span className="cabn-spellbook-list-line">
									{symbol.line + 1}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function RenameDialog({
	oldName,
	language,
	occurrences,
	caretFrom,
	onApply,
	onClose,
}: {
	oldName: string;
	language: string | undefined;
	occurrences: readonly RenameOccurrence[];
	/** The occurrence the caret sat on — marked in the preview. */
	caretFrom: number;
	onApply(selected: RenameOccurrence[], newName: string): void;
	onClose(): void;
}): React.ReactElement {
	const [newName, setNewName] = useState(oldName);
	const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	const trimmed = newName.trim();
	const selected = occurrences.filter((o) => !skipped.has(o.from));
	const problem =
		trimmed === oldName
			? "Type a new name"
			: !isValidIdentifier(trimmed, language)
				? `"${trimmed}" isn't a valid name`
				: selected.length === 0
					? "Nothing selected to rename"
					: null;
	const apply = () => {
		if (!problem) onApply(selected, trimmed);
	};
	const toggle = (from: number) =>
		setSkipped((prev) => {
			const next = new Set(prev);
			if (next.has(from)) next.delete(from);
			else next.add(from);
			return next;
		});

	return (
		<div
			ref={dialogRef}
			className="cabn-spellbook-dialog wide"
			role="dialog"
			aria-modal="true"
			aria-label="Rename symbol"
		>
			<div className="cabn-spellbook-dialog-title">
				Rename <code>{oldName}</code> — this file only
			</div>
			<input
				ref={inputRef}
				className="cabn-spellbook-input"
				value={newName}
				onChange={(e) => setNewName(e.target.value)}
				onKeyDown={(e) => dialogKeys(e, onClose, apply)}
				aria-label="New name"
			/>
			<div className="cabn-spellbook-dialog-hint">
				{selected.length} of {occurrences.length} occurrence
				{occurrences.length === 1 ? "" : "s"} · strings and comments skipped ·
				untick any that aren't the same symbol
			</div>
			<ul className="cabn-spellbook-list preview">
				{occurrences.map((o) => {
					const checked = !skipped.has(o.from);
					const before = o.lineText.slice(0, o.column);
					const after = o.lineText.slice(o.column + oldName.length);
					return (
						<li key={o.from}>
							<label
								className={`cabn-spellbook-list-row${o.from === caretFrom ? " active" : ""}`}
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={() => toggle(o.from)}
								/>
								<span className="cabn-spellbook-list-line">{o.line}</span>
								<code className="cabn-rename-preview">
									{before.trimStart().slice(-40)}
									{checked && trimmed !== oldName ? (
										<>
											<del>{oldName}</del>
											<ins>{trimmed}</ins>
										</>
									) : (
										<mark>{oldName}</mark>
									)}
									{after.slice(0, 40)}
								</code>
							</label>
						</li>
					);
				})}
			</ul>
			<div className="cabn-spellbook-dialog-actions">
				<span className="cabn-spellbook-dialog-hint">
					{problem ?? "Enter to apply · undo with Ctrl/Cmd+Z"}
				</span>
				<button
					type="button"
					className="cabn-btn cancel"
					onClick={onClose}
					style={{ padding: "5px 12px" }}
				>
					Cancel
				</button>
				<button
					type="button"
					className="cabn-btn confirm"
					disabled={problem !== null}
					onClick={apply}
					style={{ padding: "5px 12px" }}
				>
					Rename {selected.length}
				</button>
			</div>
		</div>
	);
}
