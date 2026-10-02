import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";
import { hashStringSeed } from "../systems/deterministicRandom.js";
import {
	type MotionProfile,
	motionOffset,
	motionProfile,
	type OrbitEllipse,
	type OrbitRect,
	orbitAngle,
	type Point,
	pathFigureEight,
	portalOrbitSeed,
	sampleOrbit,
	staticOrbitAngle,
	type TrailBlend,
} from "../systems/monsterOrbit.js";

export interface OrbitDepths {
	/** Just under the arch sprite, so the upper half of the orbit disappears behind the stone and the opening's preview. */
	behind: number;
	front: number;
}

export type OrbitAnchor =
	| { kind: "portal"; portalId: string; ellipse: OrbitEllipse }
	| { kind: "path"; center: Point; pathAngle: number; halfLength: number };

interface Entry {
	id: string;
	sprite: Phaser.GameObjects.Sprite;
	anchor: OrbitAnchor;
	profile: MotionProfile;
	baseScale: number;
	seed: number;
	index: number;
	count: number;
	offset: number;
	direction: 1 | -1;
	trailMs: number;
	inFront: boolean;
}

/** One revolution every ~11s — slow enough to read as a lazy swirl, not a spinner. */
const ORBIT_SPEED_RAD_PER_SEC = 0.55;
const PATH_LOOP_SPEED = 0.45;
/** Beyond the camera's view before an orbit stops being simulated and drawn. */
const CULL_MARGIN_PX = 160;

/**
 * Drives every world monster's swirl in one per-frame pass rather than a
 * tween per sprite: the position is an orbit sample plus a species offset,
 * and depth flips between "behind the arch" and "in front of it" as the
 * monster crosses the ellipse's far half — tweens can't express that swap.
 * Trails come from four shared, non-emitting particle emitters (blend mode x
 * depth layer), fed by emitParticleAt at a per-species cadence, so particle
 * cost scales with on-screen monsters, not with a live emitter per sprite.
 */
export class MonsterOrbits {
	private entries = new Map<string, Entry>();
	private emitters = new Map<
		string,
		Phaser.GameObjects.Particles.ParticleEmitter
	>();
	private readonly trailsEnabled: boolean;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly reducedMotion: boolean,
		private readonly depths: OrbitDepths,
	) {
		this.trailsEnabled = !reducedMotion && scene.textures.exists(FX_SPARK_KEY);
	}

	add(
		id: string,
		sprite: Phaser.GameObjects.Sprite,
		species: string,
		anchor: OrbitAnchor,
	): void {
		const seed = (hashStringSeed(`monster:${id}`) % 1000) / 1000;
		const { offset, direction } =
			anchor.kind === "portal"
				? portalOrbitSeed(anchor.portalId)
				: { offset: seed * Math.PI * 2, direction: 1 as const };
		const entry: Entry = {
			id,
			sprite,
			anchor,
			profile: motionProfile(species),
			baseScale: sprite.scaleX,
			seed,
			index: 0,
			count: 1,
			offset,
			direction,
			trailMs: seed * 200,
			inFront: true,
		};
		this.entries.set(id, entry);
		sprite.setAlpha(entry.profile.baseAlpha);
		this.reindex();
		if (this.reducedMotion) this.placeStatic();
	}

	remove(id: string): void {
		if (!this.entries.delete(id)) return;
		this.reindex();
		if (this.reducedMotion) this.placeStatic();
	}

	update(timeMs: number, deltaMs: number, view: Phaser.Geom.Rectangle): void {
		if (this.reducedMotion) return;
		const t = timeMs / 1000;
		for (const entry of this.entries.values()) {
			const anchorPt = anchorPoint(entry.anchor);
			const visible =
				anchorPt.x > view.x - CULL_MARGIN_PX &&
				anchorPt.x < view.right + CULL_MARGIN_PX &&
				anchorPt.y > view.y - CULL_MARGIN_PX &&
				anchorPt.y < view.bottom + CULL_MARGIN_PX;
			entry.sprite.setVisible(visible);
			if (!visible) continue;
			this.step(entry, t, deltaMs);
		}
	}

	/** World-space box this portal's live monsters can reach (orbit at full wobble plus sprite and bob), or null when none orbit it. */
	portalReach(portalId: string): OrbitRect | null {
		let x0 = Number.POSITIVE_INFINITY;
		let y0 = Number.POSITIVE_INFINITY;
		let x1 = Number.NEGATIVE_INFINITY;
		let y1 = Number.NEGATIVE_INFINITY;
		for (const { anchor, profile, sprite } of this.entries.values()) {
			if (anchor.kind !== "portal" || anchor.portalId !== portalId) continue;
			const { cx, cy, rx, ry } = anchor.ellipse;
			const k = 1 + profile.radialWobble;
			const pad =
				Math.max(sprite.displayWidth, sprite.displayHeight) * 0.75 +
				profile.bobPx;
			x0 = Math.min(x0, cx - rx * k - pad);
			x1 = Math.max(x1, cx + rx * k + pad);
			y0 = Math.min(y0, cy - ry * k - pad);
			y1 = Math.max(y1, cy + ry * k + pad);
		}
		return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
	}

	destroy(): void {
		for (const emitter of this.emitters.values()) emitter.destroy();
		this.emitters.clear();
		this.entries.clear();
	}

	private step(entry: Entry, t: number, deltaMs: number): void {
		const { sprite, profile, anchor } = entry;
		const motion = motionOffset(profile, t, entry.seed);
		let x: number;
		let y: number;
		let scale = 1;
		let inFront = true;
		let travelX: 1 | -1 = 1;
		if (anchor.kind === "portal") {
			const angle = orbitAngle(
				entry.index,
				entry.count,
				t,
				ORBIT_SPEED_RAD_PER_SEC,
				entry.direction,
				entry.offset,
			);
			const s = sampleOrbit(
				anchor.ellipse,
				angle,
				entry.direction,
				motion.radialScale,
			);
			x = s.x;
			y = s.y;
			scale = s.scale;
			inFront = s.inFront;
			travelX = s.travelX;
		} else {
			const phase = entry.offset + PATH_LOOP_SPEED * t;
			const p = pathFigureEight(
				anchor.center,
				anchor.pathAngle,
				anchor.halfLength,
				phase,
			);
			const ahead = pathFigureEight(
				anchor.center,
				anchor.pathAngle,
				anchor.halfLength,
				phase + 0.05,
			);
			x = p.x;
			y = p.y;
			travelX = ahead.x >= p.x ? 1 : -1;
		}
		sprite.setPosition(x, y + motion.dy);
		sprite.setScale(entry.baseScale * scale);
		sprite.setRotation(motion.rotation);
		sprite.setAlpha(motion.alpha);
		if (profile.facing) {
			const facesTravel =
				profile.facing === "right" ? travelX > 0 : travelX < 0;
			sprite.setFlipX(!facesTravel);
		}
		if (inFront !== entry.inFront) {
			entry.inFront = inFront;
			sprite.setDepth(inFront ? this.depths.front : this.depths.behind);
		}
		this.emitTrail(entry, x, y + motion.dy, deltaMs);
	}

	private emitTrail(entry: Entry, x: number, y: number, deltaMs: number) {
		const trail = entry.profile.trail;
		if (!this.trailsEnabled || !trail) return;
		entry.trailMs += deltaMs;
		if (entry.trailMs < trail.everyMs) return;
		entry.trailMs = 0;
		const emitter = this.emitter(trail.blend, entry.inFront);
		emitter.setParticleTint(trail.tint);
		emitter.setParticleAlpha({ start: trail.alpha, end: 0 });
		emitter.setParticleSpeed(0, trail.riseY);
		const h = entry.sprite.displayHeight;
		emitter.emitParticleAt(
			x + (Math.random() - 0.5) * 8,
			y + h * 0.2 + (Math.random() - 0.5) * 6,
			1,
		);
	}

	private emitter(
		blend: TrailBlend,
		front: boolean,
	): Phaser.GameObjects.Particles.ParticleEmitter {
		const key = `${blend}:${front ? "front" : "behind"}`;
		const existing = this.emitters.get(key);
		if (existing) return existing;
		const emitter = this.scene.add.particles(0, 0, FX_SPARK_KEY, {
			emitting: false,
			lifespan: { min: 650, max: 1050 },
			scale: { start: 0.42, end: 0 },
			alpha: { start: 0.6, end: 0 },
			blendMode:
				blend === "add" ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
		});
		// A hair under the monster layer it belongs to, so a trail never paints over its own monster.
		emitter.setDepth((front ? this.depths.front : this.depths.behind) - 0.01);
		this.emitters.set(key, emitter);
		return emitter;
	}

	/** Recomputes each portal group's index/count so siblings stay evenly spaced after one is defeated or revived. */
	private reindex(): void {
		const groups = new Map<string, Entry[]>();
		for (const entry of this.entries.values()) {
			const key =
				entry.anchor.kind === "portal"
					? `portal:${entry.anchor.portalId}`
					: `path:${entry.id}`;
			const list = groups.get(key) ?? [];
			list.push(entry);
			groups.set(key, list);
		}
		for (const list of groups.values()) {
			list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
			list.forEach((entry, index) => {
				entry.index = index;
				entry.count = list.length;
			});
		}
	}

	private placeStatic(): void {
		for (const entry of this.entries.values()) {
			const { anchor, sprite } = entry;
			if (anchor.kind === "portal") {
				const s = sampleOrbit(
					anchor.ellipse,
					staticOrbitAngle(entry.index, entry.count),
				);
				sprite.setPosition(s.x, s.y);
				sprite.setScale(entry.baseScale * s.scale);
			} else {
				sprite.setPosition(anchor.center.x, anchor.center.y);
			}
			sprite.setRotation(0);
			sprite.setAlpha(entry.profile.baseAlpha);
			sprite.setDepth(this.depths.front);
			entry.inFront = true;
		}
	}
}

function anchorPoint(anchor: OrbitAnchor): Point {
	return anchor.kind === "portal"
		? { x: anchor.ellipse.cx, y: anchor.ellipse.cy }
		: anchor.center;
}
