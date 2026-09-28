import type { Portal, RichPortalPreview } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import {
	type ArchDrawOp,
	effectiveRichPreview,
	layoutArchPreview,
} from "../src/systems/archPreview.js";
import {
	DOCK_PAGE_LAYOUT_WIDTH,
	type DockCandidateState,
	liveSlotRect,
	openingRect,
	PLAYER_OCCLUDER_FRACTION,
	pageScale,
	playerOccluderRect,
	rectsOverlap,
	shouldDockLivePage,
} from "../src/systems/portalFx.js";
import { classifyFocus } from "../src/systems/uiFocus.js";

const URL_PREVIEW: Extract<RichPortalPreview, { kind: "url" }> = {
	kind: "url",
	url: "https://blocked.example/",
	title: "A site",
};

function urlPortal(
	rich: RichPortalPreview = URL_PREVIEW,
): Pick<Portal, "file" | "preview" | "richPreview"> {
	return {
		file: {
			path: "docs/site.md",
			name: "site.md",
			kind: "markdown",
			bytes: 5,
			binary: false,
		},
		preview: { lines: [], truncated: false },
		richPreview: rich,
	};
}

describe("embeds.json verdicts in effectiveRichPreview", () => {
	test("a blocked verdict for the same url marks the preview", () => {
		const out = effectiveRichPreview(urlPortal(), undefined, undefined, {
			url: URL_PREVIEW.url,
			framable: false,
			detail: "X-Frame-Options: deny",
		});
		expect(out).toMatchObject({
			kind: "url",
			embedBlocked: "X-Frame-Options: deny",
		});
	});

	test("a verdict without detail still blocks", () => {
		const out = effectiveRichPreview(urlPortal(), undefined, undefined, {
			url: URL_PREVIEW.url,
			framable: false,
		});
		expect(out.kind === "url" && out.embedBlocked).toBeTruthy();
	});

	test("framable, missing, or stale (different url) verdicts leave it live", () => {
		for (const embed of [
			undefined,
			{ url: URL_PREVIEW.url, framable: true },
			{ url: "https://other.example/", framable: false },
		]) {
			const out = effectiveRichPreview(
				urlPortal(),
				undefined,
				undefined,
				embed,
			);
			expect(out).toEqual(URL_PREVIEW);
		}
	});

	test("verdicts never touch non-url previews", () => {
		const text: RichPortalPreview = { kind: "text", text: "hi" };
		expect(
			effectiveRichPreview(urlPortal(text), undefined, undefined, {
				url: URL_PREVIEW.url,
				framable: false,
			}),
		).toEqual(text);
	});

	test("the arch card of a blocked site says it opens in the browser", () => {
		const texts = (ops: ArchDrawOp[]) =>
			ops.flatMap((o) => (o.op === "text" ? [o.text] : []));
		const blocked = layoutArchPreview(
			{ ...URL_PREVIEW, embedBlocked: "X-Frame-Options: deny" },
			120,
			160,
		);
		expect(texts(blocked)).toContain("↗ opens in tab");
		expect(texts(layoutArchPreview(URL_PREVIEW, 120, 160))).not.toContain(
			"↗ opens in tab",
		);
	});
});

describe("shouldDockLivePage", () => {
	const base: DockCandidateState = {
		mode: "world",
		spyglassOpen: false,
		focusedPortalPreview: {
			portalId: "docs/site.md",
			preview: { kind: "url" },
		},
		nearWebPortal: { portalId: "docs/site.md" },
	};

	test("docks when the dock shows the same live url portal", () => {
		expect(shouldDockLivePage(base)).toBe(true);
	});

	test.each<[string, Partial<DockCandidateState>]>([
		["file mode", { mode: "file" }],
		["spyglass open (the dock hides)", { spyglassOpen: true }],
		["no focused portal", { focusedPortalPreview: null }],
		["no live page", { nearWebPortal: null }],
		["dock shows a different portal", { nearWebPortal: { portalId: "x" } }],
		[
			"focused portal isn't a url",
			{
				focusedPortalPreview: {
					portalId: "docs/site.md",
					preview: { kind: "code" },
				},
			},
		],
		[
			"site refuses framing",
			{
				focusedPortalPreview: {
					portalId: "docs/site.md",
					preview: { kind: "url", embedBlocked: "X-Frame-Options: deny" },
				},
			},
		],
	])("stays in the arch: %s", (_, patch) => {
		expect(shouldDockLivePage({ ...base, ...patch })).toBe(false);
	});
});

describe("dock placement maths", () => {
	test("slot rect is relative to the positioned parent", () => {
		expect(
			liveSlotRect(
				{ left: 900, top: 140, width: 452, height: 500 },
				{ left: 100, top: 40 },
			),
		).toEqual({ x: 800, y: 100, w: 452, h: 500 });
	});

	test("page scale maps css width onto the layout width", () => {
		expect(pageScale(DOCK_PAGE_LAYOUT_WIDTH / 2, DOCK_PAGE_LAYOUT_WIDTH)).toBe(
			0.5,
		);
		expect(pageScale(0, DOCK_PAGE_LAYOUT_WIDTH)).toBe(0);
		expect(pageScale(100, 0)).toBe(0);
	});

	test("a ~460px dock keeps body text readable (>= 11px for 16px text)", () => {
		expect(16 * pageScale(452, DOCK_PAGE_LAYOUT_WIDTH)).toBeGreaterThanOrEqual(
			11,
		);
	});
});

describe("player occlusion of the live page", () => {
	// Same geometry as WorldScene: a 96px arch's opening, a 48x64 player.
	const archPos = { x: 0, y: 0 };
	const opening = openingRect(archPos, {
		width: 96 * 0.47,
		height: 96 * 0.65,
		offsetY: 96 * 0.17,
	});
	const playerAt = (x: number, y: number) => ({
		x: x - 24,
		y: y - 32,
		w: 48,
		h: 64,
	});

	test("occluder is the bottom slice of the sprite", () => {
		const r = playerOccluderRect({ x: 10, y: 20, w: 48, h: 64 });
		expect(r.h).toBeCloseTo(64 * PLAYER_OCCLUDER_FRACTION);
		expect(r.y + r.h).toBeCloseTo(84);
		expect(r.x).toBe(10);
		expect(r.w).toBe(48);
	});

	test("standing just below the opening no longer dims it (the whole sprite would)", () => {
		const below = playerAt(0, opening.y + opening.h + 20);
		expect(rectsOverlap(opening, below)).toBe(true);
		expect(rectsOverlap(opening, playerOccluderRect(below))).toBe(false);
	});

	test("walking across the opening still dims it", () => {
		const across = playerAt(0, opening.y + opening.h / 2);
		expect(rectsOverlap(opening, playerOccluderRect(across))).toBe(true);
	});
});

describe("focus classification of the docked page", () => {
	test("a focused iframe owns the keyboard", () => {
		expect(classifyFocus({ tagName: "IFRAME" })).toBe("text");
		expect(classifyFocus({ tagName: "iframe" })).toBe("text");
	});
});
