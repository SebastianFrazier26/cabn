import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { GUIDE_NPC_PORTRAIT_PATH } from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import {
	GUIDE_GREETING,
	GUIDE_NPC_NAME,
	type GuideTopicId,
	guideTopics,
} from "../systems/guideContent.js";
import {
	GUIDE_MENU,
	type GuideDialogView,
	nextPage,
	openTopic,
	prevPage,
	typedLength,
} from "../systems/guideDialog.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import { detectMac } from "../systems/spellbookTools.js";
import { useGuideDialogStyles } from "./guideDialogStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface GuideDialogProps {
	store: StoreApi<CabnStore>;
}

/** The guide NPC's dialogue box — mounted fresh on every open (store.guideOpen), so each talk starts at the greeting. */
export function GuideDialog({
	store,
}: GuideDialogProps): React.ReactElement | null {
	const open = useCabnStore(store, (s) => s.guideOpen);
	useGuideDialogStyles();
	if (!open) return null;
	return <GuideDialogBox store={store} />;
}

// Buttons keep focus off themselves: the box owns Enter itself, and a
// focused button would otherwise also activate natively on the same key.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

function GuideDialogBox({ store }: GuideDialogProps): React.ReactElement {
	const topics = useMemo(
		() =>
			guideTopics(
				detectMac(typeof navigator === "undefined" ? "" : navigator.platform)
					? "mac"
					: "other",
			),
		[],
	);
	const [reducedMotion] = useState(prefersReducedMotion);
	const [view, setView] = useState<GuideDialogView>(GUIDE_MENU);
	const [menuIndex, setMenuIndex] = useState(0);
	const topic =
		view.kind === "topic" ? topics.find((t) => t.id === view.topicId) : null;
	const text =
		view.kind === "topic" ? (topic?.pages[view.page] ?? "") : GUIDE_GREETING;

	// Tagged with the text it belongs to, so a new page starts from zero on
	// its very first render instead of flashing in full for one frame before
	// a reset effect runs.
	const [typing, setTyping] = useState({
		forText: text,
		elapsed: 0,
		skipped: false,
	});
	const current =
		typing.forText === text
			? typing
			: { forText: text, elapsed: 0, skipped: false };
	const shown = current.skipped
		? text.length
		: typedLength(text, current.elapsed, reducedMotion);
	const complete = shown >= text.length;

	useEffect(() => {
		if (complete) return;
		const started = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			setTyping((t) => ({
				forText: text,
				elapsed: now - started,
				skipped: t.forText === text && t.skipped,
			}));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [complete, text]);
	const skip = useCallback(
		() => setTyping({ forText: text, elapsed: 0, skipped: true }),
		[text],
	);

	const close = useCallback(
		() => store.getState().setGuideOpen(false),
		[store],
	);
	const choose = useCallback(
		(id: GuideTopicId) => setView(openTopic(topics, id)),
		[topics],
	);
	const advance = useCallback(() => {
		if (!complete) {
			skip();
			return;
		}
		if (view.kind === "menu") {
			const pick = topics[menuIndex];
			if (pick) choose(pick.id);
			return;
		}
		setView(nextPage(topics, view));
	}, [complete, skip, view, topics, menuIndex, choose]);
	const back = useCallback(() => setView(prevPage(view)), [view]);

	const handlers = useRef({ advance, back, close, choose });
	handlers.current = { advance, back, close, choose };
	const viewRef = useRef(view);
	viewRef.current = view;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "Tab") return;
			// Capture phase + preventDefault/stopPropagation: Phaser's window
			// listener skips handled events (so Enter/Esc/arrows never reach the
			// world underneath) and the hotbar's bubble-phase listener never runs.
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			const h = handlers.current;
			const inMenu = viewRef.current.kind === "menu";
			switch (event.key) {
				case "Escape":
					h.close();
					return;
				case "Enter":
				case " ":
				case "ArrowRight":
					h.advance();
					return;
				case "ArrowLeft":
				case "Backspace":
					h.back();
					return;
				case "ArrowDown":
					if (inMenu) setMenuIndex((i) => (i + 1) % topics.length);
					return;
				case "ArrowUp":
					if (inMenu)
						setMenuIndex((i) => (i - 1 + topics.length) % topics.length);
					return;
			}
			const n = Number.parseInt(event.key, 10);
			const pick = topics[n - 1];
			if (inMenu && pick) h.choose(pick.id);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [topics]);

	const pageLabel =
		view.kind === "topic" && topic
			? `${topic.title} · ${view.page + 1} / ${topic.pages.length}`
			: "Pick a topic (1-5)";

	return (
		<div className="cabn-guide-backdrop">
			<div
				className="cabn-panel cabn-guide-box"
				role="dialog"
				aria-modal="true"
				aria-label={`${GUIDE_NPC_NAME} the guide`}
				data-testid="guide-dialog"
			>
				<div className="cabn-guide-name">{GUIDE_NPC_NAME}</div>
				<div className="cabn-guide-portrait">
					<img
						src={GUIDE_NPC_PORTRAIT_PATH}
						alt=""
						onError={(e) => {
							e.currentTarget.style.visibility = "hidden";
						}}
					/>
				</div>
				<div className="cabn-guide-body">
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: the box's window-level key handler already covers Enter/Space. */}
					<p
						className="cabn-guide-text"
						data-testid="guide-text"
						onClick={advance}
					>
						<span aria-hidden="true">{text.slice(0, shown)}</span>
						<span className="cabn-guide-sr">{text}</span>
						{complete && view.kind === "topic" && (
							<span className="cabn-guide-more" aria-hidden="true">
								▼
							</span>
						)}
					</p>
					{view.kind === "menu" && (
						<ol className="cabn-guide-topics">
							{topics.map((t, i) => (
								<li key={t.id}>
									<button
										type="button"
										className={`cabn-guide-topic${i === menuIndex ? " selected" : ""}`}
										onMouseDown={keepFocus}
										onMouseEnter={() => setMenuIndex(i)}
										onClick={() => choose(t.id)}
									>
										<kbd>{i + 1}</kbd>
										<span>
											{t.title}
											<small>{t.blurb}</small>
										</span>
									</button>
								</li>
							))}
						</ol>
					)}
					<div className="cabn-guide-footer">
						<span data-testid="guide-page">{pageLabel}</span>
						<span className="cabn-guide-actions">
							{view.kind === "topic" && (
								<>
									<button
										type="button"
										className="cabn-btn neutral"
										onMouseDown={keepFocus}
										onClick={back}
									>
										◀ Back
									</button>
									<button
										type="button"
										className="cabn-btn confirm"
										onMouseDown={keepFocus}
										onClick={advance}
									>
										{complete ? "Next ▶" : "Skip ▶"}
									</button>
								</>
							)}
							<button
								type="button"
								className="cabn-btn cancel"
								onMouseDown={keepFocus}
								onClick={close}
								title="Esc"
							>
								Bye (Esc)
							</button>
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
