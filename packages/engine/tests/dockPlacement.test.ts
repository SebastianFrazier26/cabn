import { describe, expect, it } from "vitest";
import {
	DOCK_KEEPOUT_GAP_PX,
	DOCK_MARGIN_PX,
	DOCK_MIN_WIDTH_PX,
	placeDock,
} from "../src/systems/dockPlacement.js";
import {
	DOCK_PAGE_LAYOUT_WIDTH,
	dockLayoutWidth,
	MINI_PAGE_VIRTUAL_WIDTH,
	previewDockOpen,
	unionRect,
} from "../src/systems/portalFx.js";

const span = { top: 40, bottom: 680 };
/** The arch sprite (192px) centred at `cx`, vertically mid-screen. */
const arch = (cx: number, half = 96) => ({
	x: cx - half,
	y: 360 - half,
	w: half * 2,
	h: half * 2,
});
const dockLeftEdge = (w: number, width: number) => w - DOCK_MARGIN_PX - width;

describe("placeDock", () => {
	it("at 1280 with the arch mid-screen, keeps today's spot and width", () => {
		const preferred = Math.min(480, 0.46 * 1280);
		expect(placeDock(1280, preferred, span, arch(640))).toEqual({
			side: "right",
			width: preferred,
		});
	});

	it("keeps the usual spot with no keepout, or one clear of the dock vertically", () => {
		expect(placeDock(1024, 471, span, null)).toEqual({
			side: "right",
			width: 471,
		});
		expect(
			placeDock(1024, 471, span, { x: 500, y: 700, w: 300, h: 50 }),
		).toEqual({ side: "right", width: 471 });
	});

	it("at 1024, narrows the dock until it clears the arch", () => {
		const keepout = arch(512);
		const p = placeDock(1024, 471, span, keepout);
		expect(p.side).toBe("right");
		expect(p.width).toBeLessThan(471);
		expect(p.width).toBeGreaterThanOrEqual(DOCK_MIN_WIDTH_PX);
		expect(dockLeftEdge(1024, p.width)).toBeGreaterThanOrEqual(
			keepout.x + keepout.w + DOCK_KEEPOUT_GAP_PX,
		);
	});

	it("moves to the side away from the arch when narrowing can't clear it", () => {
		const keepout = arch(700);
		const p = placeDock(1024, 471, span, keepout);
		expect(p.side).toBe("left");
		expect(DOCK_MARGIN_PX + p.width + DOCK_KEEPOUT_GAP_PX).toBeLessThanOrEqual(
			keepout.x,
		);
		expect(p.width).toBeLessThanOrEqual(471);
	});

	it("falls back to the minimum width on the roomier side when nothing clears", () => {
		expect(placeDock(640, 294, span, arch(300, 200))).toEqual({
			side: "right",
			width: 294,
		});
		expect(placeDock(900, 414, span, arch(560, 250))).toEqual({
			side: "left",
			width: DOCK_MIN_WIDTH_PX,
		});
	});
});

describe("dockLayoutWidth", () => {
	it("keeps the 640 layout for a full-width dock's slot", () => {
		expect(dockLayoutWidth(446)).toBe(DOCK_PAGE_LAYOUT_WIDTH);
		expect(dockLayoutWidth(900)).toBe(DOCK_PAGE_LAYOUT_WIDTH);
	});

	it("lays a narrowed dock's page out narrower so text stays readable", () => {
		const w = dockLayoutWidth(288);
		expect(w).toBeLessThan(DOCK_PAGE_LAYOUT_WIDTH);
		expect(288 / w).toBeGreaterThanOrEqual(0.64);
		expect(dockLayoutWidth(100)).toBe(MINI_PAGE_VIRTUAL_WIDTH);
	});
});

describe("unionRect / previewDockOpen", () => {
	it("unions two rects, or passes one through", () => {
		const a = { x: 0, y: 0, w: 10, h: 10 };
		expect(unionRect(a, null)).toBe(a);
		expect(unionRect(a, { x: -5, y: 5, w: 30, h: 2 })).toEqual({
			x: -5,
			y: 0,
			w: 30,
			h: 10,
		});
	});

	it("is open exactly when the dock renders", () => {
		const base = {
			mode: "world",
			spyglassOpen: false,
			focusedPortalPreview: { portalId: "a" },
			activeWorldBase: "/w/",
		};
		expect(previewDockOpen(base)).toBe(true);
		expect(previewDockOpen({ ...base, focusedPortalPreview: null })).toBe(
			false,
		);
		expect(previewDockOpen({ ...base, spyglassOpen: true })).toBe(false);
		expect(previewDockOpen({ ...base, mode: "file" })).toBe(false);
		expect(previewDockOpen({ ...base, activeWorldBase: null })).toBe(false);
	});
});
