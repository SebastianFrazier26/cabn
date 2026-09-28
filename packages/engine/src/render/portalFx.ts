import type { Position } from "@cabn/world-schema";
import type Phaser from "phaser";
import {
	AMBIENT_MOTE_COUNT,
	ambientMote,
	edgeGlowAlpha,
	hashSeed,
	LOADING_MOTE_COUNT,
	loadingMote,
	type Mote,
	openingRect,
	RESOLVE_MS,
	RESOLVE_MS_REDUCED,
	type Rect,
	resolveProgress,
	sheenPhase,
} from "../systems/portalFx.js";
import type { ArchOpening } from "./archPreviews.js";

/** What PortalFx reads from ArchPreviews — kept as an interface so the two classes don't reach into each other's internals. */
export interface ArchFxSource {
	forEachVisible(
		cb: (id: string, pos: Position, kind: string, detailed: boolean) => void,
	): void;
	/** 0 = the painted page is still dark (just resolved), 1 = fully lit. */
	setPreviewReveal(id: string, reveal: number): void;
}

/**
 * Animated magic inside every on-screen world arch: a swirl of motes while
 * the arch still shows the shared placeholder ("loading"), a bloom-outward
 * handover as its detailed preview lights up, then sparse rising motes, a
 * pulsing stepped edge glow and an occasional diagonal sheen over the page.
 *
 * Design choice (2026-09-28, playtest round 2): one Phaser Blitter for every
 * arch, not a ParticleEmitter per arch. All motes, glows and sheen frames
 * are frames of one small generated atlas, so the whole effect is a single
 * batched draw whose bobs are pooled and re-placed each frame from pure,
 * stateless functions (systems/portalFx.ts). Cost scales with arches on
 * screen (ArchPreviews already hides off-screen ones and this only visits
 * visible entries), never with world size. Emitters would have meant per-
 * arch update lists and particle lifecycles for what is really just
 * "evaluate a position formula".
 */

type Palette = readonly [number, number, number, number];

const COOL: Palette = [0x7fe3f0, 0x9aa8ff, 0xf2b544, 0xb27cd6];
const WARM: Palette = [0xf2b544, 0xff9f6b, 0xfff1c4, 0x7fe3f0];
const MYSTIC: Palette = [0xb27cd6, 0xf2b544, 0x7fe3f0, 0xff8fb8];

function paletteFor(kind: string): { motes: Palette; glow: number } {
	switch (kind) {
		case "code":
		case "url":
			return { motes: COOL, glow: 0x8fe8ff };
		case "markdown":
		case "text":
			return { motes: WARM, glow: 0xffc861 };
		default:
			return { motes: MYSTIC, glow: 0xd0a0ff };
	}
}

const SHAPE_FRAMES = ["dot", "plus", "spark"] as const;
const MOTE_CELL = 2;
const SHAPE_HALF = [
	MOTE_CELL / 2,
	(3 * MOTE_CELL) / 2,
	(5 * MOTE_CELL) / 2,
] as const;
const SHEEN_FRAMES = 16;
const SHEEN_BAND = 5;
const TRAIL_LAG_MS = 90;

interface ArchState {
	seed: number;
	detailed: boolean;
	resolveStart: number;
	revealed: boolean;
}

export class PortalFx {
	private readonly blitter: Phaser.GameObjects.Blitter;
	private readonly pool: Phaser.GameObjects.Bob[] = [];
	/** Bob#frame is protected; tracked alongside so an unchanged frame skips setFrame's texture lookup. */
	private readonly poolFrames: string[] = [];
	private used = 0;
	private readonly states = new Map<string, ArchState>();
	private readonly atlasKey: string;
	private readonly w: number;
	private readonly h: number;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly opening: ArchOpening,
		depth: number,
		private readonly reducedMotion: boolean,
	) {
		this.w = Math.round(opening.width);
		this.h = Math.round(opening.height);
		this.atlasKey = `cabn-portalfx-${this.w}x${this.h}`;
		this.ensureAtlas();
		this.blitter = scene.add.blitter(0, 0, this.atlasKey).setDepth(depth);
	}

	update(time: number, source: ArchFxSource): void {
		this.used = 0;
		const resolveMs = this.reducedMotion ? RESOLVE_MS_REDUCED : RESOLVE_MS;
		source.forEachVisible((id, pos, kind, detailed) => {
			let st = this.states.get(id);
			if (!st) {
				// First seen already detailed (a cached texture scrolling back
				// on screen) — nothing to resolve, it was revealed before.
				st = {
					seed: hashSeed(id),
					detailed,
					resolveStart: Number.NEGATIVE_INFINITY,
					revealed: true,
				};
				this.states.set(id, st);
			}
			if (detailed && !st.detailed) {
				st.resolveStart = time;
				st.revealed = false;
			} else if (!detailed && st.detailed) {
				source.setPreviewReveal(id, 1);
				st.revealed = true;
			}
			st.detailed = detailed;

			const rect = openingRect(pos, this.opening);
			const pal = paletteFor(kind);
			if (!detailed) {
				this.drawGlow(
					rect,
					pal.glow,
					0.8 * edgeGlowAlpha(st.seed, time, this.reducedMotion),
				);
				this.drawSwirl(st.seed, time, rect, pal.motes, 0);
				return;
			}

			const p = resolveProgress(time - st.resolveStart, resolveMs);
			if (!st.revealed) {
				source.setPreviewReveal(id, p);
				if (p >= 1) st.revealed = true;
			}
			this.drawGlow(
				rect,
				pal.glow,
				edgeGlowAlpha(st.seed, time, this.reducedMotion),
			);
			if (p < 1) this.drawSwirl(st.seed, time, rect, pal.motes, p);
			for (let i = 0; i < AMBIENT_MOTE_COUNT; i++) {
				const mote = ambientMote(st.seed, i, time, rect, this.reducedMotion);
				if (mote) this.drawMote({ ...mote, alpha: mote.alpha * p }, pal.motes);
			}
			const sheen = sheenPhase(st.seed, time, this.reducedMotion);
			if (sheen !== null && p >= 1) {
				const frame = Math.min(
					SHEEN_FRAMES - 1,
					Math.round(sheen * (SHEEN_FRAMES - 1)),
				);
				this.place(
					Math.round(rect.x),
					Math.round(rect.y),
					`sheen${frame}`,
					0.5,
					0xffffff,
				);
			}
		});
		for (let i = this.used; i < this.pool.length; i++) {
			const bob = this.pool[i] as Phaser.GameObjects.Bob;
			if (!bob.visible) break;
			bob.visible = false;
		}
	}

	destroy(): void {
		this.blitter.destroy();
		this.pool.length = 0;
		this.states.clear();
	}

	/** The loading swirl; the big sparkle motes drag a dim trail one step behind them so the orbit reads as motion even in a still frame. */
	private drawSwirl(
		seed: number,
		time: number,
		rect: Rect,
		palette: Palette,
		spread: number,
	): void {
		for (let i = 0; i < LOADING_MOTE_COUNT; i++) {
			const mote = loadingMote(seed, i, time, rect, this.reducedMotion, spread);
			if (mote.shape === 2 && !this.reducedMotion) {
				const trail = loadingMote(
					seed,
					i,
					time - TRAIL_LAG_MS,
					rect,
					false,
					spread,
				);
				this.drawMote(
					{ ...trail, shape: 1, alpha: trail.alpha * 0.45 },
					palette,
				);
			}
			this.drawMote(mote, palette);
		}
	}

	private drawMote(mote: Mote, palette: Palette): void {
		if (mote.alpha <= 0.02) return;
		const half = SHAPE_HALF[mote.shape];
		this.place(
			mote.x - half,
			mote.y - half,
			SHAPE_FRAMES[mote.shape],
			mote.alpha,
			palette[mote.color % palette.length] as number,
		);
	}

	private drawGlow(rect: Rect, tint: number, alpha: number): void {
		this.place(Math.round(rect.x), Math.round(rect.y), "glow", alpha, tint);
	}

	private place(
		x: number,
		y: number,
		frame: string,
		alpha: number,
		tint: number,
	): void {
		let bob = this.pool[this.used];
		if (!bob) {
			bob = this.blitter.create(x, y, frame);
			this.pool.push(bob);
			this.poolFrames.push(frame);
		} else {
			bob.x = x;
			bob.y = y;
			if (this.poolFrames[this.used] !== frame) {
				bob.setFrame(frame);
				this.poolFrames[this.used] = frame;
			}
			bob.visible = true;
		}
		bob.alpha = alpha;
		bob.tint = tint;
		this.used++;
	}

	/**
	 * One white atlas, tinted per bob: mote shapes, a stepped edge-glow frame
	 * the size of the opening, and a strip holding one slanted sheen band
	 * that SHEEN_FRAMES crop windows slide across — the crop is what keeps
	 * the band clipped to the opening without a mask.
	 */
	private ensureAtlas(): void {
		const textures = this.scene.textures;
		if (textures.exists(this.atlasKey)) return;
		const { w, h } = this;
		const slant = Math.round(h * 0.35);
		const stripW = 2 * w + slant + SHEEN_BAND * 2;
		const glowY = 12;
		const sheenY = glowY + h + 2;
		const tex = textures.createCanvas(
			this.atlasKey,
			Math.max(stripW, w, 16),
			sheenY + h,
		);
		if (!tex) return;
		const ctx = tex.getContext();
		ctx.fillStyle = "#ffffff";

		// Shapes on a 2px cell — the world's art density (see render/scale.ts).
		const c = MOTE_CELL;
		ctx.fillRect(0, 0, c, c);
		tex.add("dot", 0, 0, 0, c, c);

		ctx.fillRect(4 + c, 0, c, 3 * c);
		ctx.fillRect(4, c, 3 * c, c);
		tex.add("plus", 0, 4, 0, 3 * c, 3 * c);

		const sx = 12;
		ctx.fillRect(sx + 2 * c, 0, c, 5 * c);
		ctx.fillRect(sx, 2 * c, 5 * c, c);
		ctx.globalAlpha = 0.5;
		for (const [dx, dy] of [
			[1, 1],
			[3, 1],
			[1, 3],
			[3, 3],
		] as const)
			ctx.fillRect(sx + dx * c, dy * c, c, c);
		ctx.globalAlpha = 1;
		tex.add("spark", 0, sx, 0, 5 * c, 5 * c);

		// Stepped, not a blurred gradient: flat pixel-RPG bands of falling alpha.
		const steps: [number, number][] = [
			[1, 0.95],
			[2, 0.45],
			[2, 0.2],
			[2, 0.08],
		];
		let inset = 0;
		for (const [thickness, alpha] of steps) {
			ctx.globalAlpha = alpha;
			const x0 = inset;
			const y0 = glowY + inset;
			const iw = w - inset * 2;
			const ih = h - inset * 2;
			ctx.fillRect(x0, y0, iw, thickness);
			ctx.fillRect(x0, y0 + ih - thickness, iw, thickness);
			ctx.fillRect(x0, y0 + thickness, thickness, ih - thickness * 2);
			ctx.fillRect(
				x0 + iw - thickness,
				y0 + thickness,
				thickness,
				ih - thickness * 2,
			);
			inset += thickness;
		}
		ctx.globalAlpha = 1;
		tex.add("glow", 0, 0, glowY, w, h);

		const centre = w + SHEEN_BAND + slant / 2;
		for (let row = 0; row < h; row++) {
			const cx = Math.round(centre + slant * (0.5 - row / h));
			ctx.globalAlpha = 0.18;
			ctx.fillRect(cx - SHEEN_BAND, sheenY + row, SHEEN_BAND * 2, 1);
			ctx.globalAlpha = 0.4;
			ctx.fillRect(cx - 2, sheenY + row, 4, 1);
		}
		ctx.globalAlpha = 1;
		const travel = stripW - w;
		for (let i = 0; i < SHEEN_FRAMES; i++) {
			const offset = Math.round((travel * i) / (SHEEN_FRAMES - 1));
			tex.add(`sheen${i}`, 0, offset, sheenY, w, h);
		}
		tex.refresh();
	}
}
