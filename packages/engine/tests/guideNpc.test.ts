import { describe, expect, it } from "vitest";
import { keepoutDistance } from "../src/systems/edgeScenery.js";
import { guideTopics } from "../src/systems/guideContent.js";
import {
	GUIDE_MENU,
	nextPage,
	openTopic,
	prevPage,
	typedLength,
} from "../src/systems/guideDialog.js";
import {
	type GuidePlacementInput,
	placeGuideNpc,
	shouldShowGuide,
} from "../src/systems/guideNpc.js";
import {
	emptySaveData,
	parseSaveData,
	withGuideTalked,
} from "../src/systems/save.js";

describe("shouldShowGuide", () => {
	it("shows only in the shelf's first world, or a world booted on its own", () => {
		expect(shouldShowGuide(0, undefined)).toBe(true);
		expect(shouldShowGuide(undefined, undefined)).toBe(true);
		expect(shouldShowGuide(1, undefined)).toBe(false);
		expect(shouldShowGuide(3, true)).toBe(false);
	});

	it("never shows when cabn.json says guide: false", () => {
		expect(shouldShowGuide(0, false)).toBe(false);
		expect(shouldShowGuide(undefined, false)).toBe(false);
	});
});

const FOOTPRINT = { w: 48, h: 64 };

function baseInput(
	overrides: Partial<GuidePlacementInput> = {},
): GuidePlacementInput {
	return {
		hub: { x: 0, y: 0 },
		circles: [{ x: 0, y: 0, radius: 48 }],
		segments: [],
		footprint: FOOTPRINT,
		minRadius: 76,
		maxRadius: 190,
		preferredRadius: 96,
		...overrides,
	};
}

/** Same sample test placeGuideNpc runs, re-derived here so the assertion doesn't just echo the implementation's return value. */
function clear(p: { x: number; y: number }, input: GuidePlacementInput) {
	const { w, h } = input.footprint;
	const feet = p.y + h / 2;
	const samples: [number, number][] = [
		[p.x, feet],
		[p.x, feet - h * 0.5],
		[p.x, feet - h * 0.88],
		[p.x - w * 0.42, feet - h * 0.35],
		[p.x + w * 0.42, feet - h * 0.35],
	];
	return samples.every(
		([x, y]) => keepoutDistance(x, y, input.circles, input.segments) >= -1,
	);
}

describe("placeGuideNpc", () => {
	it("prefers due west of the fire at the preferred radius when that's open", () => {
		expect(placeGuideNpc(baseInput())).toEqual({ x: -96, y: 0 });
	});

	it("steps around a path running west out of the hub", () => {
		const input = baseInput({
			segments: [{ ax: 0, ay: 0, bx: -800, by: 0, halfWidth: 28 }],
		});
		const spot = placeGuideNpc(input);
		expect(spot).not.toBeNull();
		if (!spot) return;
		expect(clear(spot, input)).toBe(true);
		expect(Math.abs(spot.y)).toBeGreaterThan(28);
	});

	// Eight arches sit on a ~245px ring (portalRing.ts: 8 slots of 192px).
	it("keeps off arches, the spawn point and every path of a busy hub", () => {
		const arches = Array.from({ length: 8 }, (_, i) => {
			const a = (i / 8) * Math.PI * 2;
			return { x: Math.cos(a) * 250, y: Math.sin(a) * 250, radius: 77 };
		});
		const input = baseInput({
			circles: [
				{ x: 0, y: 0, radius: 48 },
				{ x: 64, y: 0, radius: 68 },
				...arches,
			],
			segments: [0.4, 1.9, 3.3, 4.6].map((a) => ({
				ax: 0,
				ay: 0,
				bx: Math.cos(a) * 900,
				by: Math.sin(a) * 900,
				halfWidth: 28,
			})),
		});
		const spot = placeGuideNpc(input);
		expect(spot).not.toBeNull();
		if (spot) expect(clear(spot, input)).toBe(true);
		expect(placeGuideNpc(input)).toEqual(spot);
	});

	it("gives up (no guide) rather than standing on something when every spot is taken", () => {
		expect(
			placeGuideNpc(baseInput({ circles: [{ x: 0, y: 0, radius: 400 }] })),
		).toBeNull();
	});
});

describe("guide dialogue navigation", () => {
	const topics = guideTopics("other");

	it("opens a topic at its first page and walks forward back to the menu", () => {
		let view = openTopic(topics, "moving");
		expect(view).toEqual({ kind: "topic", topicId: "moving", page: 0 });
		const pages = topics.find((t) => t.id === "moving")?.pages.length ?? 0;
		for (let i = 1; i < pages; i++) view = nextPage(topics, view);
		expect(view).toEqual({ kind: "topic", topicId: "moving", page: pages - 1 });
		expect(nextPage(topics, view)).toEqual(GUIDE_MENU);
	});

	it("goes back a page, and from the first page back to the menu", () => {
		const second = nextPage(topics, openTopic(topics, "tools"));
		expect(prevPage(second)).toEqual({
			kind: "topic",
			topicId: "tools",
			page: 0,
		});
		expect(prevPage(prevPage(second))).toEqual(GUIDE_MENU);
		expect(prevPage(GUIDE_MENU)).toEqual(GUIDE_MENU);
	});

	it("types at a fixed rate, and all at once under reduced motion", () => {
		const text = "Well met, traveler!";
		expect(typedLength(text, 0, false)).toBe(0);
		expect(typedLength(text, 100, false, 50)).toBe(5);
		expect(typedLength(text, 60_000, false)).toBe(text.length);
		expect(typedLength(text, 0, true)).toBe(text.length);
	});
});

describe("guide save flag", () => {
	it("marks talked once and survives a save round trip", () => {
		const save = withGuideTalked(emptySaveData("w"));
		expect(save.guideTalked).toBe(true);
		expect(withGuideTalked(save)).toBe(save);
		expect(parseSaveData(JSON.parse(JSON.stringify(save)))?.guideTalked).toBe(
			true,
		);
	});

	it("still reads a save written before the flag existed", () => {
		const old = emptySaveData("w");
		expect(parseSaveData(JSON.parse(JSON.stringify(old)))?.guideTalked).toBe(
			undefined,
		);
	});
});
