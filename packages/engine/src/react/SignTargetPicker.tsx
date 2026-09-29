import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterSignTargets } from "../systems/signs.js";

const MAX_LISTED = 60;

export interface SignTargetPickerProps {
	value: string;
	targets: readonly string[];
	onChange(target: string): void;
}

/**
 * "Stands beside" as a type-to-filter combobox — a <select> of every file
 * was unusable in a world with thousands of them. Only listed targets can
 * be picked; the typed text is a filter, never a value. While the list is
 * open the input carries aria-expanded="true", which SignEditor's Escape
 * handler checks so Escape closes the list rather than the editor.
 */
export function SignTargetPicker({
	value,
	targets,
	onChange,
}: SignTargetPickerProps): React.ReactElement {
	const [query, setQuery] = useState<string | null>(null);
	const [active, setActive] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const open = query !== null;
	const { matches, total } = useMemo(
		() => filterSignTargets(targets, query ?? "", MAX_LISTED),
		[targets, query],
	);
	const clamped = Math.min(active, Math.max(matches.length - 1, 0));

	useEffect(() => {
		if (!open) return;
		listRef.current
			?.querySelector(`[data-index="${clamped}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [open, clamped]);

	const pick = (target: string) => {
		onChange(target);
		setQuery(null);
	};

	return (
		<div className="cabn-sign-combo">
			<input
				role="combobox"
				aria-label="Stands beside"
				aria-expanded={open}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={
					open && matches.length > 0 ? `${listId}-${clamped}` : undefined
				}
				data-testid="sign-editor-near"
				value={query ?? value}
				placeholder={value}
				spellCheck={false}
				autoComplete="off"
				onFocus={() => {
					setQuery("");
					setActive(0);
				}}
				onClick={() => {
					if (!open) setQuery("");
				}}
				onBlur={() => setQuery(null)}
				onChange={(e) => {
					setQuery(e.target.value);
					setActive(0);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						if (!open) {
							setQuery("");
							setActive(0);
							return;
						}
						const step = e.key === "ArrowDown" ? 1 : -1;
						setActive(
							matches.length === 0
								? 0
								: (clamped + step + matches.length) % matches.length,
						);
						return;
					}
					if (e.key === "Enter" && open && !e.nativeEvent.isComposing) {
						e.preventDefault();
						const target = matches[clamped];
						if (target) pick(target);
						return;
					}
					if (e.key === "Escape" && open) {
						e.preventDefault();
						setQuery(null);
					}
				}}
			/>
			{open && (
				<div
					id={listId}
					ref={listRef}
					role="listbox"
					aria-label="Stands beside"
					className="cabn-spellbook-list cabn-sign-combo-list"
					data-testid="sign-editor-near-list"
				>
					{matches.map((target, i) => (
						// biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keys (arrows + Enter); options only take the pointer
						<div
							key={target}
							id={`${listId}-${i}`}
							role="option"
							aria-selected={i === clamped}
							tabIndex={-1}
							data-index={i}
							className={`cabn-spellbook-list-row${i === clamped ? " active" : ""}`}
							onMouseDown={(e) => e.preventDefault()}
							onMouseMove={() => setActive(i)}
							onClick={() => pick(target)}
						>
							<span className="cabn-spellbook-list-name">{target}</span>
						</div>
					))}
					{matches.length === 0 && (
						<div className="cabn-spellbook-dialog-hint cabn-sign-combo-hint">
							No file or folder matches
						</div>
					)}
					{total > matches.length && (
						<div className="cabn-spellbook-dialog-hint cabn-sign-combo-hint">
							{total - matches.length} more, keep typing to narrow
						</div>
					)}
				</div>
			)}
		</div>
	);
}
