import type { Position } from "@cabn/world-schema";

/**
 * Pure half of the portal effects (render/portalFx.ts is the Phaser half,
 * react/PortalLivePage.tsx the DOM half): where each mote sits at a given
 * time, how the loading swirl hands over to the painted preview, and how an
 * arch's opening maps from world space onto the page for the live url
 * mini-page. Deterministic in (seed, index, time) so it's unit-testable and
 * needs no per-mote state — the renderer just evaluates it every frame.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Mote {
	/** Centre of the mote. */
	x: number;
	y: number;
	alpha: number;
	/** Index into the renderer's palette for this arch. */
	color: number;
	/** 0 = 1-cell dot, 1 = 3-cell plus, 2 = 5-cell sparkle (cells are 2px). */
	shape: 0 | 1 | 2;
}

/** Half the largest mote (the 10px sparkle), so a centred mote never spills past the opening onto the stone. */
export const MOTE_INSET = 5;

export const LOADING_MOTE_COUNT = 18;
export const AMBIENT_MOTE_COUNT = 5;
export const RESOLVE_MS = 520;
/** Under reduced motion the handover is a short crossfade, not a burst. */
export const RESOLVE_MS_REDUCED = 180;

/** Stable 32-bit hash of an id — each arch gets its own phase so a ring of arches doesn't swirl in lockstep. */
export function hashSeed(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Deterministic 0..1 from (seed, salt) — mulberry32 finaliser, no state carried between frames. */
export function rand01(seed: number, salt: number): number {
	let t = (seed + Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rounded to whole pixels — the art is flat pixel-RPG, and sub-pixel motes shimmer as they're resampled. */
function px(v: number): number {
	return Math.round(v);
}

/**
 * The "loading" swirl inside a distant arch's opening: motes on breathing
 * elliptical orbits around the opening's centre, each with its own speed,
 * radius and twinkle. `spread` (0..1) pushes them outward — the resolve
 * animation drives it to 1 as the painted preview fades in, so the swirl
 * reads as blooming open into the page rather than simply vanishing.
 * Reduced motion freezes the orbit at a seed-chosen constellation and drops
 * the twinkle.
 */
export function loadingMote(
	seed: number,
	index: number,
	timeMs: number,
	rect: Rect,
	reducedMotion: boolean,
	spread = 0,
): Mote {
	const r0 = rand01(seed, index * 7 + 1);
	const r1 = rand01(seed, index * 7 + 2);
	const r2 = rand01(seed, index * 7 + 3);
	const r3 = rand01(seed, index * 7 + 4);
	const t = reducedMotion ? 0 : timeMs / 1000;
	const dir = index % 3 === 0 ? -1 : 1;
	const angle = r0 * Math.PI * 2 + dir * t * (0.9 + r1 * 1.4);
	const breathe = reducedMotion ? 0 : Math.sin(t * (1.1 + r2) + r3 * 6) * 0.18;
	const base = 0.35 + r2 * 0.6 + breathe;
	const radius = base + (1.15 - base) * clamp01(spread);
	const cx = rect.x + rect.w / 2;
	const cy = rect.y + rect.h / 2;
	const rx = (rect.w / 2 - MOTE_INSET) * radius;
	const ry = (rect.h / 2 - MOTE_INSET) * radius;
	const twinkle = reducedMotion
		? 0.8
		: 0.55 + 0.45 * Math.sin(t * (3 + r1 * 4) + r0 * 10);
	return {
		x: px(clampInsetX(cx + Math.cos(angle) * rx, rect)),
		y: px(clampInsetY(cy + Math.sin(angle) * ry, rect)),
		alpha: clamp01(twinkle * (1 - clamp01(spread) ** 2)),
		color: index % 4,
		shape: index % 3 === 0 ? 2 : index % 3 === 1 ? 1 : 0,
	};
}

/**
 * Slow motes rising through a detailed preview, respawning at the bottom —
 * the "this is a magic window" layer on top of the painted page. Kept sparse
 * (AMBIENT_MOTE_COUNT) so the text stays legible. Returns null under reduced
 * motion: static motes over text would just read as dirt.
 */
export function ambientMote(
	seed: number,
	index: number,
	timeMs: number,
	rect: Rect,
	reducedMotion: boolean,
): Mote | null {
	if (reducedMotion) return null;
	const r0 = rand01(seed, 100 + index * 5);
	const r1 = rand01(seed, 101 + index * 5);
	const r2 = rand01(seed, 102 + index * 5);
	const periodMs = 3200 + r1 * 2600;
	const phase = ((timeMs + r2 * periodMs) % periodMs) / periodMs;
	const sway = Math.sin(phase * Math.PI * 2 + r0 * 6) * 4;
	const x = rect.x + MOTE_INSET + r0 * (rect.w - MOTE_INSET * 2) + sway;
	const y = rect.y + rect.h - MOTE_INSET - phase * (rect.h - MOTE_INSET * 2);
	// Fade in off the floor and out before the top so nothing pops.
	const alpha = Math.sin(phase * Math.PI) * 0.85;
	return {
		x: px(clampInsetX(x, rect)),
		y: px(y),
		alpha,
		color: (index + 1) % 4,
		shape: index % 3 === 0 ? 1 : 0,
	};
}

function clampInsetX(v: number, rect: Rect): number {
	return clampTo(v, rect.x + MOTE_INSET, rect.x + rect.w - MOTE_INSET);
}

function clampInsetY(v: number, rect: Rect): number {
	return clampTo(v, rect.y + MOTE_INSET, rect.y + rect.h - MOTE_INSET);
}

function clampTo(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/** Smoothstep 0..1 over the resolve window. */
export function resolveProgress(elapsedMs: number, durationMs: number): number {
	if (durationMs <= 0) return 1;
	const t = clamp01(elapsedMs / durationMs);
	return t * t * (3 - 2 * t);
}

/** Gentle 0.35..0.75 edge-glow pulse, per-arch phase; a flat 0.5 under reduced motion. */
export function edgeGlowAlpha(
	seed: number,
	timeMs: number,
	reducedMotion: boolean,
): number {
	if (reducedMotion) return 0.5;
	const phase = rand01(seed, 900) * Math.PI * 2;
	return 0.55 + 0.2 * Math.sin(timeMs / 700 + phase);
}

/**
 * Where a diagonal sheen band sits across a detailed preview, as 0..1 of its
 * sweep, or null between sweeps. One sweep every SHEEN_PERIOD_MS, staggered
 * per arch; never under reduced motion.
 */
export const SHEEN_PERIOD_MS = 5200;
export const SHEEN_SWEEP_MS = 900;
export function sheenPhase(
	seed: number,
	timeMs: number,
	reducedMotion: boolean,
): number | null {
	if (reducedMotion) return null;
	const offset = rand01(seed, 901) * SHEEN_PERIOD_MS;
	const t = (timeMs + offset) % SHEEN_PERIOD_MS;
	return t < SHEEN_SWEEP_MS ? t / SHEEN_SWEEP_MS : null;
}

// --- live url mini-page ---------------------------------------------------

export interface CameraView {
	/** Camera's worldView (world-space rect currently on screen). */
	view: Rect;
	zoom: number;
	/** Camera viewport offset inside the game canvas, in game px. */
	offsetX: number;
	offsetY: number;
}

export interface CanvasPlacement {
	/** Canvas's top-left inside the positioned overlay root, in CSS px. */
	left: number;
	top: number;
	/** CSS px per game px (canvas.clientWidth / game width) — 1 under Scale.RESIZE, but not assumed. */
	scaleX: number;
	scaleY: number;
}

/**
 * World-space rect -> CSS px rect inside the overlay root, so a DOM element
 * sits exactly over the arch's opening for this frame's camera. Called from
 * the camera's FOLLOW_UPDATE (after the follow lerp has moved the scroll for
 * this frame), so the iframe doesn't trail the canvas by a frame.
 */
export function projectWorldRect(
	rect: Rect,
	camera: CameraView,
	canvas: CanvasPlacement,
): Rect {
	const sx = camera.offsetX + (rect.x - camera.view.x) * camera.zoom;
	const sy = camera.offsetY + (rect.y - camera.view.y) * camera.zoom;
	return {
		x: canvas.left + sx * canvas.scaleX,
		y: canvas.top + sy * canvas.scaleY,
		w: rect.w * camera.zoom * canvas.scaleX,
		h: rect.h * camera.zoom * canvas.scaleY,
	};
}

/** An arch's opening in world space — `opening` is relative to the arch sprite's centre, as ArchPreviews places its image. */
export function openingRect(
	archPos: Position,
	opening: { width: number; height: number; offsetY: number },
): Rect {
	return {
		x: archPos.x - opening.width / 2,
		y: archPos.y + opening.offsetY - opening.height / 2,
		w: opening.width,
		h: opening.height,
	};
}

export function rectContains(rect: Rect, p: Position): boolean {
	return (
		p.x >= rect.x &&
		p.x <= rect.x + rect.w &&
		p.y >= rect.y &&
		p.y <= rect.y + rect.h
	);
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
	);
}

/** Two projected rects equal to the half-pixel — skips re-styling the DOM on frames the camera didn't actually move it. */
export function sameRect(a: Rect | null, b: Rect): boolean {
	if (!a) return false;
	return (
		Math.abs(a.x - b.x) < 0.5 &&
		Math.abs(a.y - b.y) < 0.5 &&
		Math.abs(a.w - b.w) < 0.5 &&
		Math.abs(a.h - b.h) < 0.5
	);
}

/**
 * The part of the player sprite that dims the live mini-page when it
 * overlaps the opening: the lower body only. The whole-sprite box used to
 * catch the head brushing the bottom of the opening from a stand spot
 * in front of the arch, dimming the page where players naturally stop.
 * (At dock range the page moves into the dock anyway — PortalLivePage.)
 */
export const PLAYER_OCCLUDER_FRACTION = 0.45;

export function playerOccluderRect(sprite: Rect): Rect {
	const h = sprite.h * PLAYER_OCCLUDER_FRACTION;
	return { x: sprite.x, y: sprite.y + sprite.h - h, w: sprite.w, h };
}

export interface WebPortalCandidate {
	id: string;
	pos: Position;
}

/** Nearest url-preview portal within `radius` — the one (and only) arch that gets a live mini-page. Ties break on id so the choice never flickers between two equidistant arches. */
export function pickNearWebPortal(
	candidates: readonly WebPortalCandidate[],
	player: Position,
	radius: number,
): string | null {
	let best: { id: string; d: number } | null = null;
	for (const c of candidates) {
		const d = Math.hypot(c.pos.x - player.x, c.pos.y - player.y);
		if (d > radius) continue;
		if (!best || d < best.d || (d === best.d && c.id < best.id))
			best = { id: c.id, d };
	}
	return best?.id ?? null;
}

/**
 * What a canvas click on a url arch does: open the link when the player is
 * already standing near it and the click lands on the opening itself;
 * otherwise the ordinary click-walk (walk there, enter on arrival). Near
 * means the same radius that mounts the live mini-page, so "the page is
 * showing" and "clicking the page opens it" always agree.
 */
export function urlArchClickAction(
	click: Position,
	player: Position,
	archPos: Position,
	opening: Rect,
	nearRadius: number,
	linkAllowed: boolean,
): "open-link" | "walk" {
	if (!linkAllowed) return "walk";
	const near =
		Math.hypot(archPos.x - player.x, archPos.y - player.y) <= nearRadius;
	return near && rectContains(opening, click) ? "open-link" : "walk";
}

/** Virtual page width the mini-page iframe lays out at before being scaled into the opening — narrow enough to read as a phone-width page, wide enough that most sites don't collapse to a hamburger stub. */
export const MINI_PAGE_VIRTUAL_WIDTH = 360;

export function miniPageScale(openingCssWidth: number): number {
	return openingCssWidth > 0 ? openingCssWidth / MINI_PAGE_VIRTUAL_WIDTH : 0;
}

/**
 * Layout width of the live page once it moves into the dock. Wider than the
 * arch thumbnail's phone width so most sites show their desktop-ish layout,
 * but not a full 1024+: scaled into a ~460px dock that would shrink body
 * text below ~8px. At 640 a 16px font lands around 11-12px.
 */
export const DOCK_PAGE_LAYOUT_WIDTH = 640;

export function pageScale(cssWidth: number, layoutWidth: number): number {
	return cssWidth > 0 && layoutWidth > 0 ? cssWidth / layoutWidth : 0;
}

/** The store slice deciding whether the live page belongs in the dock. */
export interface DockCandidateState {
	mode: string;
	spyglassOpen: boolean;
	focusedPortalPreview: {
		portalId: string;
		preview: { kind: string; embedBlocked?: string };
	} | null;
	nearWebPortal: { portalId: string } | null;
}

/**
 * The live page moves into the dock exactly when the dock is showing that
 * same url portal (PortalPreviewDock's own visibility rules: world mode,
 * spyglass closed) and the site isn't known to refuse framing.
 */
export function shouldDockLivePage(s: DockCandidateState): boolean {
	const focused = s.focusedPortalPreview;
	return (
		s.mode === "world" &&
		!s.spyglassOpen &&
		focused !== null &&
		s.nearWebPortal !== null &&
		focused.portalId === s.nearWebPortal.portalId &&
		focused.preview.kind === "url" &&
		!focused.preview.embedBlocked
	);
}

/** A slot's client rect re-expressed relative to the live page's positioned parent (both from getBoundingClientRect). */
export function liveSlotRect(
	slot: { left: number; top: number; width: number; height: number },
	parent: { left: number; top: number },
): Rect {
	return {
		x: slot.left - parent.left,
		y: slot.top - parent.top,
		w: slot.width,
		h: slot.height,
	};
}
