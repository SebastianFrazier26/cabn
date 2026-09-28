/**
 * The guide dialogue box's navigation and typewriter, as pure functions —
 * react/GuideDialog.tsx is the render/keyboard glue around them.
 */
import type { GuideTopic, GuideTopicId } from "./guideContent.js";

export type GuideDialogView =
	| { kind: "menu" }
	| { kind: "topic"; topicId: GuideTopicId; page: number };

export const GUIDE_MENU: GuideDialogView = { kind: "menu" };

function pageCount(topics: readonly GuideTopic[], id: GuideTopicId): number {
	return topics.find((t) => t.id === id)?.pages.length ?? 0;
}

export function openTopic(
	topics: readonly GuideTopic[],
	id: GuideTopicId,
): GuideDialogView {
	return pageCount(topics, id) > 0
		? { kind: "topic", topicId: id, page: 0 }
		: GUIDE_MENU;
}

/** Past a topic's last page goes back to the menu, so a player mashing Enter lands somewhere they can pick the next topic or leave. */
export function nextPage(
	topics: readonly GuideTopic[],
	view: GuideDialogView,
): GuideDialogView {
	if (view.kind === "menu") return view;
	const count = pageCount(topics, view.topicId);
	return view.page + 1 < count ? { ...view, page: view.page + 1 } : GUIDE_MENU;
}

export function prevPage(view: GuideDialogView): GuideDialogView {
	if (view.kind === "menu") return view;
	return view.page > 0 ? { ...view, page: view.page - 1 } : GUIDE_MENU;
}

export const TYPEWRITER_CHARS_PER_SEC = 48;

/** How many characters of `text` are showing `elapsedMs` after it started typing; reduced motion shows it all at once. */
export function typedLength(
	text: string,
	elapsedMs: number,
	reducedMotion: boolean,
	charsPerSec = TYPEWRITER_CHARS_PER_SEC,
): number {
	if (reducedMotion) return text.length;
	const n = Math.floor((Math.max(0, elapsedMs) * charsPerSec) / 1000);
	return Math.min(text.length, n);
}
