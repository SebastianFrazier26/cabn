import type { Position, RichPortalPreview } from "@cabn/world-schema";
import Phaser from "phaser";
import { PALETTE, toCssColor } from "../palette.js";
import {
	type ArchColorRole,
	type ArchDrawOp,
	DEFAULT_ARCH_METRICS,
	fitContain,
	isInView,
	layoutArchPreview,
	type Rect,
	selectDetailPortals,
} from "../systems/archPreview.js";
import { resolveRelativeUrl } from "./resolveUrl.js";

/**
 * The literal file preview painted inside each world portal arch.
 *
 * Design choice (M10 portals-in-world, 2026-09-28): a Phaser canvas texture
 * per portal, not a DOM overlay. The preview then lives in the scene graph —
 * it depth-sorts with the player walking in front of an arch, pans with the
 * camera for free, and gets the day/night grade like every other world
 * sprite — where a DOM overlay would need per-frame world->screen projection
 * for every visible arch and would float above the grade and the player.
 * The live, scrollable, interactive view (CodeMirror) stays in the DOM, in
 * the expanded dock (react/PortalPreviewDock.tsx), where one instance at a
 * time is cheap. The one exception is a url preview's live page, which is
 * a DOM iframe projected over the nearest url arch (react/PortalLivePage.tsx)
 * — again only one at a time.
 *
 * Cost control: only portals near the player *and* on screen get a detailed
 * canvas (selectDetailPortals, capped at MAX_DETAILED, LRU-evicted past
 * MAX_CACHED), at most BUILD_BUDGET_PER_FRAME builds per frame; every other
 * arch shares one small placeholder texture per preview kind, and arches
 * off screen are hidden outright.
 */

const COLORS: Record<ArchColorRole, string> = {
	codeBg: "#1f1a2e",
	parchmentBg: toCssColor(PALETTE.parchment),
	urlBg: "#1d2c3a",
	imageBg: "#2a2419",
	sealedBg: "#2a2419",
	ink: toCssColor(PALETTE.ink),
	cream: toCssColor(PALETTE.cream),
	keyword: toCssColor(PALETTE.gold),
	string: "#a8c66c",
	comment: "#8f8a7a",
	number: toCssColor(PALETTE.amethyst),
	heading: toCssColor(PALETTE.rust),
	muted: "#b5a98a",
	chestWood: "#9a5b2c",
	chestDark: "#4a2a14",
	chestGold: toCssColor(PALETTE.gold),
};

const FONT_FAMILY = '"Courier New", monospace';
const DETAIL_RADIUS = 520;
const MAX_DETAILED = 10;
const MAX_CACHED = 18;
const BUILD_BUDGET_PER_FRAME = 2;
const LOD_INTERVAL_MS = 200;
/** Detail textures are drawn at 2x and linear-filtered down, so text stays legible instead of nearest-sampled mush. */
const TEXTURE_SCALE = 2;

export interface ArchOpening {
	width: number;
	height: number;
	/** Opening centre relative to the arch sprite's centre. */
	offsetY: number;
}

export interface ArchPreviewTarget {
	id: string;
	pos: Position;
	preview: RichPortalPreview;
}

interface Entry {
	target: ArchPreviewTarget;
	image: Phaser.GameObjects.Image;
	detailKey: string | null;
	dirty: boolean;
}

type ImageState =
	| { status: "loading"; img: HTMLImageElement }
	| { status: "ready"; img: HTMLImageElement }
	| { status: "failed" };

let instanceSeq = 0;

export class ArchPreviews {
	private readonly entries = new Map<string, Entry>();
	private readonly images = new Map<string, ImageState>();
	/** Most-recently-wanted last. */
	private lru: string[] = [];
	private wanted: string[] = [];
	private lastLodAt = Number.NEGATIVE_INFINITY;
	private readonly prefix = `cabn-arch-${instanceSeq++}`;
	private destroyed = false;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly opening: ArchOpening,
		private readonly depth: number,
		private readonly worldBase: string,
	) {}

	add(target: ArchPreviewTarget): void {
		const image = this.scene.add
			.image(
				target.pos.x,
				target.pos.y + this.opening.offsetY,
				this.placeholderKey(target.preview.kind),
			)
			.setDisplaySize(this.opening.width, this.opening.height)
			.setDepth(this.depth);
		this.entries.set(target.id, {
			target,
			image,
			detailKey: null,
			dirty: false,
		});
	}

	/** A quill edit (or reset) changed what this portal shows — repaint it on the next tick it's detailed. */
	setPreview(id: string, preview: RichPortalPreview): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.target = { ...entry.target, preview };
		if (entry.detailKey) entry.dirty = true;
		else entry.image.setTexture(this.placeholderKey(preview.kind));
	}

	update(time: number, player: Position, view: Rect): void {
		if (time - this.lastLodAt >= LOD_INTERVAL_MS) {
			this.lastLodAt = time;
			this.recomputeLod(player, view);
		}
		let budget = BUILD_BUDGET_PER_FRAME;
		for (const id of this.wanted) {
			if (budget <= 0) break;
			const entry = this.entries.get(id);
			if (!entry || (entry.detailKey && !entry.dirty)) continue;
			this.paint(entry);
			budget--;
		}
	}

	/** For render/portalFx.ts: on-screen arches, and whether each shows its own painted preview yet or still the shared placeholder. */
	forEachVisible(
		cb: (id: string, pos: Position, kind: string, detailed: boolean) => void,
	): void {
		for (const entry of this.entries.values()) {
			if (!entry.image.visible) continue;
			cb(
				entry.target.id,
				entry.target.pos,
				entry.target.preview.kind,
				entry.detailKey !== null,
			);
		}
	}

	/** The resolve animation lights a freshly painted page up out of the dark (a tint, not alpha — fading alpha would show the ground through the arch's empty opening mid-fade). */
	setPreviewReveal(id: string, reveal: number): void {
		const image = this.entries.get(id)?.image;
		if (!image) return;
		if (reveal >= 1) {
			image.clearTint();
			return;
		}
		const r = Math.max(0, reveal);
		const channel = (lo: number) => Math.round(lo + (255 - lo) * r);
		image.setTint((channel(42) << 16) | (channel(40) << 8) | channel(64));
	}

	destroy(): void {
		this.destroyed = true;
		for (const entry of this.entries.values()) {
			entry.image.destroy();
			if (entry.detailKey) this.scene.textures.remove(entry.detailKey);
		}
		this.entries.clear();
		for (const state of this.images.values()) {
			if (state.status !== "failed") {
				state.img.onload = null;
				state.img.onerror = null;
			}
		}
		this.images.clear();
	}

	private recomputeLod(player: Position, view: Rect): void {
		const pad = Math.max(this.opening.width, this.opening.height);
		const candidates = [...this.entries.values()].map((e) => ({
			id: e.target.id,
			pos: e.target.pos,
		}));
		this.wanted = selectDetailPortals(
			candidates,
			player,
			view,
			DETAIL_RADIUS,
			MAX_DETAILED,
			pad,
		);
		for (const entry of this.entries.values())
			entry.image.setVisible(isInView(entry.target.pos, view, pad));

		// Re-wanted portals move to the back of the LRU; evict from the front
		// only once over MAX_CACHED, so walking back and forth between two
		// clusters doesn't repaint arches that were just visible.
		const wantedSet = new Set(this.wanted);
		this.lru = [...this.lru.filter((id) => !wantedSet.has(id)), ...this.wanted];
		while (this.lru.length > MAX_CACHED) {
			const evictId = this.lru.shift();
			const entry = evictId ? this.entries.get(evictId) : undefined;
			if (entry?.detailKey) {
				entry.image.setTexture(this.placeholderKey(entry.target.preview.kind));
				entry.image.setDisplaySize(this.opening.width, this.opening.height);
				this.scene.textures.remove(entry.detailKey);
				entry.detailKey = null;
				entry.dirty = false;
			}
		}
	}

	private paint(entry: Entry): void {
		const w = Math.round(this.opening.width * TEXTURE_SCALE);
		const h = Math.round(this.opening.height * TEXTURE_SCALE);
		const key = entry.detailKey ?? `${this.prefix}-${entry.target.id}`;
		let texture: Phaser.Textures.CanvasTexture | null;
		if (entry.detailKey) {
			texture = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
		} else {
			texture = this.scene.textures.createCanvas(key, w, h);
			if (!texture) return;
		}
		const ctx = texture.getContext();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
		const ops = layoutArchPreview(
			entry.target.preview,
			this.opening.width,
			this.opening.height,
			DEFAULT_ARCH_METRICS,
		);
		this.execute(ctx, ops);
		texture.refresh();
		// After refresh(), not once at creation: every WebGL re-upload
		// (WebGLRenderer.canvasToTexture) resets the filter from the game's
		// antialias flag, which pixelArt turns off — nearest-sampling a 2x
		// canvas down to 1x drops every other pixel row (underscores vanished).
		texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

		if (!entry.detailKey) {
			entry.detailKey = key;
			entry.image.setTexture(key);
			entry.image.setDisplaySize(this.opening.width, this.opening.height);
		}
		entry.dirty = false;
	}

	private execute(
		ctx: CanvasRenderingContext2D,
		ops: readonly ArchDrawOp[],
	): void {
		ctx.textBaseline = "top";
		for (const op of ops) {
			switch (op.op) {
				case "fill":
					ctx.fillStyle = COLORS[op.color];
					ctx.fillRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
					break;
				case "text":
					ctx.fillStyle = COLORS[op.color];
					ctx.font = `${op.bold ? "bold " : ""}${op.sizePx}px ${FONT_FAMILY}`;
					ctx.fillText(op.text, op.x, op.y);
					break;
				case "image": {
					const state = this.requestImage(op.asset);
					if (state.status === "ready") {
						const fit = fitContain(
							state.img.naturalWidth,
							state.img.naturalHeight,
							op.box,
						);
						ctx.imageSmoothingEnabled = false;
						ctx.drawImage(state.img, fit.x, fit.y, fit.w, fit.h);
					} else if (state.status === "loading") {
						ctx.fillStyle = COLORS.muted;
						ctx.font = `${DEFAULT_ARCH_METRICS.fontPx}px ${FONT_FAMILY}`;
						ctx.fillText(
							"…",
							op.box.x + op.box.w / 2 - 3,
							op.box.y + op.box.h / 2,
						);
					}
					break;
				}
			}
		}
	}

	/** Plain HTMLImageElement, not Phaser's loader — this is a one-off draw source for a canvas, not a texture the scene keeps, and the loader's queue belongs to scene preload. */
	private requestImage(asset: string): ImageState {
		const url = resolveRelativeUrl(this.worldBase, asset);
		const existing = this.images.get(url);
		if (existing) return existing;
		const img = new Image();
		const state: ImageState = { status: "loading", img };
		this.images.set(url, state);
		img.onload = () => {
			if (this.destroyed) return;
			this.images.set(url, { status: "ready", img });
			this.markDirtyUsing(asset);
		};
		img.onerror = () => {
			if (this.destroyed) return;
			this.images.set(url, { status: "failed" });
			this.markDirtyUsing(asset);
		};
		img.src = url;
		return state;
	}

	private markDirtyUsing(asset: string): void {
		for (const entry of this.entries.values()) {
			const p = entry.target.preview;
			const uses =
				(p.kind === "image" && p.asset === asset) ||
				(p.kind === "url" && p.fallbackImage === asset);
			if (uses && entry.detailKey) entry.dirty = true;
		}
	}

	private placeholderKey(kind: RichPortalPreview["kind"]): string {
		const key = `cabn-arch-placeholder-${kind}`;
		if (this.scene.textures.exists(key)) return key;
		const w = Math.round(this.opening.width);
		const h = Math.round(this.opening.height);
		const texture = this.scene.textures.createCanvas(key, w, h);
		if (!texture) return key;
		const ctx = texture.getContext();
		const style = PLACEHOLDER_STYLE[kind];
		// A dark stepped "tunnel" instead of the old bold glyph: render/
		// portalFx.ts swirls loading motes over it, so the placeholder only has
		// to read as an unlit portal. The glyph stays as a faint rune so a
		// glance still tells code from prose at a distance.
		ctx.fillStyle = "#0d0a18";
		ctx.fillRect(0, 0, w, h);
		ctx.globalAlpha = 0.45;
		ctx.fillStyle = COLORS[style.bg];
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = COLORS[style.fg];
		const ringStep = Math.round(Math.min(w, h) / 9);
		for (let i = 1; i <= 4; i++) {
			ctx.globalAlpha = 0.06 * i;
			const inset = i * ringStep;
			ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
		}
		ctx.globalAlpha = 0.22;
		ctx.fillStyle = COLORS[style.fg];
		ctx.font = `bold ${Math.round(w * 0.32)}px ${FONT_FAMILY}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(style.glyph, w / 2, h / 2);
		ctx.globalAlpha = 1;
		texture.refresh();
		return key;
	}
}

const PLACEHOLDER_STYLE: Record<
	RichPortalPreview["kind"],
	{ bg: ArchColorRole; fg: ArchColorRole; glyph: string }
> = {
	code: { bg: "codeBg", fg: "keyword", glyph: "{}" },
	markdown: { bg: "parchmentBg", fg: "heading", glyph: "#" },
	image: { bg: "imageBg", fg: "muted", glyph: "▣" },
	text: { bg: "parchmentBg", fg: "ink", glyph: "¶" },
	url: { bg: "urlBg", fg: "keyword", glyph: "↗" },
	sealed: { bg: "sealedBg", fg: "chestGold", glyph: "▤" },
};
