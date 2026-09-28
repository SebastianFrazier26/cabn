/**
 * Pure rules behind signposts (render/signposts.ts is the Phaser side):
 * where a sign stands, what the world keeps it off, where a link leads, and
 * what a new sign's file is called. No Phaser, no DOM — unit-tested.
 */
import {
	parseSeyn,
	SEYN_EXTENSION,
	type SeynLinkTarget,
	type SignEntry,
} from "@cabn/world-schema";
import {
	type CircleKeepout,
	type Footprint,
	footprintClear,
	keepoutDistance,
	type SegmentKeepout,
} from "./edgeScenery.js";

export interface Point {
	x: number;
	y: number;
}

export interface SignPlacementInput {
	/** Centre of what the sign describes — an arch or a fountain/bonfire. */
	anchor: Point;
	anchorKind: "portal" | "cluster";
	/** Centre of the clearing the anchor belongs to. */
	hub: Point;
	/** The author's @offset from the anchor, if any. */
	offset: Point | null;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
	/** Sign box, anchored bottom-centre at the returned point. */
	footprint: Footprint;
	/** Candidates farther than this from the hub are skipped, so a sign stays in its clearing instead of the forest. */
	maxFromHub: number;
	minRadius?: number;
	maxRadius?: number;
}

const ANGLE_STEPS = 32;
const RADIUS_STEP = 8;
const DEFAULT_MIN_RADIUS = 40;
const DEFAULT_MAX_RADIUS = 240;
const CLEARANCE = 4;

/**
 * Where a sign would stand with no @offset: beside an arch's lower half on
 * the side facing away from the hub (so signs frame the clearing's rim
 * rather than crowding its middle), or at a fountain's lower right.
 */
export function defaultSignSpot(
	anchor: Point,
	anchorKind: "portal" | "cluster",
	hub: Point,
): Point {
	if (anchorKind === "cluster") return { x: anchor.x + 84, y: anchor.y + 70 };
	const side = anchor.x >= hub.x ? 1 : -1;
	return { x: anchor.x + side * 112, y: anchor.y + 80 };
}

/**
 * The sign's feet (bottom-centre): the requested spot (anchor + @offset, or
 * defaultSignSpot) when its footprint clears every keepout, else the clear
 * candidate on rings around the anchor nearest that spot. Never inside a
 * keepout; null when nothing within reach is clear. Deterministic.
 */
export function placeSign(input: SignPlacementInput): Point | null {
	const want = input.offset
		? { x: input.anchor.x + input.offset.x, y: input.anchor.y + input.offset.y }
		: defaultSignSpot(input.anchor, input.anchorKind, input.hub);
	const ok = (p: Point) =>
		Math.hypot(p.x - input.hub.x, p.y - input.hub.y) <= input.maxFromHub &&
		footprintClear(
			p.x,
			p.y,
			input.footprint,
			input.circles,
			input.segments,
			CLEARANCE,
		) &&
		// footprintClear samples a tree's canopy shape; a signboard is a wide
		// rectangle at the top, so its corners are checked too.
		[-0.5, 0.5].every((side) =>
			[1, 0.6].every(
				(up) =>
					keepoutDistance(
						p.x + side * input.footprint.w,
						p.y - up * input.footprint.h,
						input.circles,
						input.segments,
					) >= 0,
			),
		);
	if (ok(want)) return { x: Math.round(want.x) + 0, y: Math.round(want.y) + 0 };

	let best: { p: Point; d: number } | null = null;
	const minR = input.minRadius ?? DEFAULT_MIN_RADIUS;
	const maxR = input.maxRadius ?? DEFAULT_MAX_RADIUS;
	for (let r = minR; r <= maxR; r += RADIUS_STEP) {
		for (let i = 0; i < ANGLE_STEPS; i++) {
			const a = (i / ANGLE_STEPS) * Math.PI * 2;
			const p = {
				x: Math.round(input.anchor.x + Math.cos(a) * r) + 0,
				y: Math.round(input.anchor.y + Math.sin(a) * r) + 0,
			};
			const d = Math.hypot(p.x - want.x, p.y - want.y);
			if (best && d >= best.d) continue;
			if (ok(p)) best = { p, d };
		}
	}
	return best?.p ?? null;
}

export interface SignWorldGeometry {
	arches: readonly Point[];
	/** Clearing centres (bonfire/fountains). */
	hubs: readonly Point[];
	paths: readonly { a: Point; b: Point }[];
	/** Round things already standing in the world (props, the guide, the spawn point), with how much room they need. */
	obstacles: readonly CircleKeepout[];
}

/**
 * The arch's stone is taller than it is wide (~150 x 180 px at world scale),
 * so one circle either misses its roof or pushes signs far off its sides; two
 * stacked circles make a capsule that hugs it. A single 80px circle let a
 * sign stand on the roof's shoulder (owner placing, 2026-09-28).
 */
export const SIGN_ARCH_KEEPOUT = 78;
export const SIGN_ARCH_CAPSULE_DY = 34;
/** The grass in front of an arch's opening, where the player walks in. */
export const SIGN_ARCH_APRON = { dy: 104, radius: 40 };
/** Fountain body, and the cluster label drawn under it. */
export const SIGN_HUB_KEEPOUT = 66;
export const SIGN_HUB_LABEL = { dy: 84, radius: 50 };
export const SIGN_PATH_HALF_WIDTH = 30;
/** Room one standing sign keeps from the next. */
export const SIGN_SPACING = 34;

/** Everything a sign must never cover: arches and their entry aprons, fountains/bonfire and their labels, path ribbons, existing obstacles, and other signs. */
export function signKeepouts(
	world: SignWorldGeometry,
	otherSigns: readonly Point[],
): { circles: CircleKeepout[]; segments: SegmentKeepout[] } {
	const circles: CircleKeepout[] = [];
	for (const a of world.arches) {
		for (const dy of [-SIGN_ARCH_CAPSULE_DY, SIGN_ARCH_CAPSULE_DY])
			circles.push({ x: a.x, y: a.y + dy, radius: SIGN_ARCH_KEEPOUT });
		circles.push({
			x: a.x,
			y: a.y + SIGN_ARCH_APRON.dy,
			radius: SIGN_ARCH_APRON.radius,
		});
	}
	for (const h of world.hubs) {
		circles.push({ x: h.x, y: h.y, radius: SIGN_HUB_KEEPOUT });
		circles.push({
			x: h.x,
			y: h.y + SIGN_HUB_LABEL.dy,
			radius: SIGN_HUB_LABEL.radius,
		});
	}
	circles.push(...world.obstacles);
	// Other signs are stored by their feet; their box centre is half a sign up.
	for (const s of otherSigns)
		circles.push({ x: s.x, y: s.y - 24, radius: SIGN_SPACING });
	const segments = world.paths.map((p) => ({
		ax: p.a.x,
		ay: p.a.y,
		bx: p.b.x,
		by: p.b.y,
		halfWidth: SIGN_PATH_HALF_WIDTH,
	}));
	return { circles, segments };
}

/** A new sign's default file: beside a file it's `<dir>/<stem>.seyn`, in a folder `<folder>/<folder name>.seyn` (`welcome.seyn` at the root), suffixed `-2`, `-3`... past any path already taken. */
export function suggestSignPath(
	near: { kind: "file" | "folder"; path: string },
	taken: ReadonlySet<string>,
): string {
	let dir: string;
	let stem: string;
	if (near.kind === "folder") {
		dir = near.path === "." ? "" : near.path;
		stem =
			near.path === "." ? "welcome" : (near.path.split("/").pop() ?? "sign");
	} else {
		const slash = near.path.lastIndexOf("/");
		dir = slash === -1 ? "" : near.path.slice(0, slash);
		const name = near.path.slice(slash + 1);
		const dot = name.lastIndexOf(".");
		stem = dot > 0 ? name.slice(0, dot) : name;
	}
	stem =
		stem.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/^[^A-Za-z0-9]+/, "") ||
		"sign";
	const prefix = dir === "" ? "" : `${dir}/`;
	let candidate = `${prefix}${stem}${SEYN_EXTENSION}`;
	for (let n = 2; taken.has(candidate); n++)
		candidate = `${prefix}${stem}-${n}${SEYN_EXTENSION}`;
	return candidate;
}

/**
 * The same rule `cabn serve`'s owner API enforces — checked in the editor
 * too so a bad name is caught before a round trip: a relative path of plain
 * segments ending in a `.seyn` file name that starts with a letter or digit.
 */
export function isValidSignFileName(path: string): boolean {
	if (path.length === 0 || path.length > 512) return false;
	const segments = path.split("/");
	const file = segments.pop() ?? "";
	if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.seyn$/.test(file)) return false;
	return segments.every(
		(s) =>
			/^[A-Za-z0-9_][A-Za-z0-9._ -]{0,100}$/.test(s) && s !== "node_modules",
	);
}

/** What a link would lead to in this world, or null when the target isn't here (deleted file, typo). */
export type ResolvedSignLink =
	| { kind: "url"; url: string }
	| { kind: "portal"; id: string }
	| { kind: "cluster"; id: string }
	| { kind: "sign"; path: string };

export interface SignLinkWorld {
	portalIds: ReadonlySet<string>;
	/** Folder path -> cluster id (the original cluster, not an annex). */
	clusterByPath: ReadonlyMap<string, string>;
	signPaths: ReadonlySet<string>;
}

export function resolveSignLink(
	target: SeynLinkTarget,
	world: SignLinkWorld,
): ResolvedSignLink | null {
	switch (target.kind) {
		case "url":
			return { kind: "url", url: target.url };
		case "file":
			return world.portalIds.has(target.path)
				? { kind: "portal", id: target.path }
				: null;
		case "folder": {
			const id = world.clusterByPath.get(target.path);
			return id ? { kind: "cluster", id } : null;
		}
		case "sign":
			return world.signPaths.has(target.path)
				? { kind: "sign", path: target.path }
				: null;
		case "invalid":
			return null;
	}
}

/** Belt and braces before an <a href>: the parser only ever produces https urls, but the reader never trusts that on its own. */
export function isSafeSignUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return (
			u.protocol === "https:" && u.hostname !== "" && !u.username && !u.password
		);
	} catch {
		return false;
	}
}

export function signTitle(sign: SignEntry): string {
	const doc = parseSeyn(sign.source, { path: sign.path });
	return doc.title ?? sign.path.slice(sign.path.lastIndexOf("/") + 1);
}

/** Where the player stops when a link or search result walks them to something: just in front of it, never inside it. */
export function standInFront(
	target: Point,
	kind: "portal" | "cluster" | "sign",
): Point {
	// A sign's point is its board centre; 74 below it puts the player just past the post's foot, still inside its reading reach.
	const dy = kind === "portal" ? 124 : kind === "cluster" ? 86 : 74;
	return { x: target.x, y: target.y + dy };
}
