import {
	type Cluster,
	type Position,
	parseSeyn,
	type SeynLinkTarget,
	type SignEntry,
	seynNearValue,
	type WorldManifest,
} from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { FX_SPARK_KEY, SIGNPOST_KEY, SIGNPOST_PATH } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import type { Interactable } from "../systems/clickWalk.js";
import { stepBlend, targetBlend } from "../systems/dayNight.js";
import type { CircleKeepout } from "../systems/edgeScenery.js";
import {
	placeSign,
	resolveSignLink,
	type SignLinkWorld,
	type SignWorldGeometry,
	signKeepouts,
	standInFront,
	suggestSignPath,
} from "../systems/signs.js";
import {
	createLightPool,
	type LightPool,
	updateLightPool,
} from "./lightPools.js";

/** 24x32 cells at 2 screen px each — the player's and the guide's size. */
const SIGN_W = 48;
const SIGN_H = 64;
const FOOTPRINT = { w: 40, h: SIGN_H };
/** Props sit at 2, the guide at 2.5; monsters are 4 and the player 5. */
const SIGN_DEPTH = 2.4;
const GHOST_DEPTH = 5.63;
/** Above the night grade (5.5) and light pools (5.6), like the click marker. */
const HIGHLIGHT_DEPTH = 5.62;
/** Within this distance of its board a sign shows its popup and Enter reads it — one radius, so the popup's "Enter to read" is always true. */
export const SIGN_INTERACT_RADIUS = 84;
const SIGN_FOCUS_RADIUS = SIGN_INTERACT_RADIUS;
const SIGN_ARRIVE_RADIUS = 40;
const HIGHLIGHT_MS = 2400;

export function preloadSignAssets(load: Phaser.Loader.LoaderPlugin): void {
	load.image(SIGNPOST_KEY, SIGNPOST_PATH);
}

export interface SignLayerOptions {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	manifest: WorldManifest;
	/** The bundle's signs.json entries (BootScene); published to the store, which owns them from then on. */
	signs: readonly SignEntry[];
	portalWorldPos: ReadonlyMap<string, Position>;
	groundRadius: (cluster: Cluster) => number;
	/** Things already standing in the world that a sign must not cover: props, the guide, the spawn point. */
	obstacles: readonly CircleKeepout[];
	reducedMotion: boolean;
	/** Summoned walk (no portal entry on arrival) — a link or search result leading somewhere. */
	walkTo: (pos: Position) => void;
	playerPos: () => Position;
	/** Other things Enter goes to first when the player is within their radius (the guide NPC) — the popup stays down there. */
	enterTakers?: readonly CircleKeepout[];
	/** Which of the store's signs this world draws; absent draws all. The store keeps every sign either way, so a hidden one comes back unchanged. */
	shows?: (sign: SignEntry) => boolean;
}

interface PlacedSign {
	entry: SignEntry;
	/** Anchor + @offset — a sign only moves when this changes, never because its text did or another sign arrived. */
	signature: string;
	feet: Position;
	sprite: Phaser.GameObjects.Image;
	light: LightPool | null;
}

interface PlacementPreview {
	near: { kind: "file" | "folder"; path: string };
	anchor: Position;
	feet: Position;
	offset: Position;
}

/** The centre of a sign's board, where a player reads it from. */
function boardCentre(feet: Position): Position {
	return { x: feet.x, y: feet.y - SIGN_H / 2 };
}

/**
 * Every sign in the current world: sprites placed beside their anchors
 * (systems/signs.ts keeps them off arches, paths and each other), the
 * approach popup, reading, following links, and — for the owner only — the
 * placement ghost. Draws exactly store.signs, so an owner's save shows up
 * live. WorldScene spawns it and routes clicks/Enter here; it tears itself
 * down with the scene.
 */
export class SignLayer {
	private readonly placed = new Map<string, PlacedSign>();
	private readonly clustersById: Map<string, Cluster>;
	private readonly clusterByPath: Map<string, Cluster>;
	private readonly geometry: SignWorldGeometry;
	private readonly unsubscribe: () => void;
	private blend: number;
	private ghost: Phaser.GameObjects.Image | null = null;
	private ghostLine: Phaser.GameObjects.Graphics | null = null;
	private ghostLabel: Phaser.GameObjects.Text | null = null;

	static spawn(scene: Phaser.Scene, opts: SignLayerOptions): SignLayer {
		return new SignLayer(scene, opts);
	}

	private constructor(
		private readonly scene: Phaser.Scene,
		private readonly opts: SignLayerOptions,
	) {
		this.clustersById = new Map(opts.manifest.clusters.map((c) => [c.id, c]));
		this.clusterByPath = new Map(
			opts.manifest.clusters.filter((c) => !c.annexOf).map((c) => [c.path, c]),
		);
		this.geometry = {
			arches: [...opts.portalWorldPos.values()],
			hubs: opts.manifest.clusters.map((c) => c.pos),
			paths: opts.manifest.paths.flatMap((p) => {
				const a = this.clustersById.get(p.from)?.pos;
				const b = this.clustersById.get(p.to)?.pos;
				return a && b ? [{ a, b }] : [];
			}),
			obstacles: opts.obstacles,
		};
		this.ensureTexture();
		this.blend = targetBlend(opts.store.getState().timeOfDay);
		opts.store
			.getState()
			.setSigns(
				[...opts.signs],
				Object.fromEntries(
					[...this.clusterByPath].map(([path, c]) => [path, c.id]),
				),
			);
		this.sync(opts.store.getState().signs);

		this.unsubscribe = opts.store.subscribe((state, prev) => {
			if (state.signs !== prev.signs) this.sync(state.signs);
			if (state.signPlacing !== prev.signPlacing && !state.signPlacing)
				this.hideGhostUnlessDrafting();
			if (state.signDraft !== prev.signDraft) this.hideGhostUnlessDrafting();
			// A sleeping WorldScene (a file open over it) keeps its objects, so
			// nothing sign-related can stay open underneath the file view.
			if (state.mode !== "world" && prev.mode === "world") {
				if (state.openSignPath) state.setOpenSign(null);
				if (state.signPlacing) state.setSignPlacing(false);
				if (state.focusedSignPath) state.setFocusedSign(null);
			}
		});
		opts.bus.on("sign:follow-link", this.onFollowLink);
		opts.bus.on("sign:place-here", this.onPlaceHere);
		opts.bus.on("tool:walk-to-portal", this.onWalkToPortal);
		scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
	}

	interactables(): Interactable[] {
		return [...this.placed.values()].map((s) => ({
			id: s.entry.path,
			kind: "sign" as const,
			pos: boardCentre(s.feet),
			hitRadius: SIGN_W / 2 + 4,
			arriveRadius: SIGN_ARRIVE_RADIUS,
			// Wins over an arch's much larger hit circle where they overlap.
			priority: 1,
		}));
	}

	/** The nearest sign within Enter's reach of the player, with its distance, so the caller can prefer a closer portal. */
	inReach(player: Position): { path: string; dist: number } | null {
		let best: { path: string; dist: number } | null = null;
		for (const s of this.placed.values()) {
			const c = boardCentre(s.feet);
			const dist = Math.hypot(player.x - c.x, player.y - c.y);
			if (dist <= SIGN_INTERACT_RADIUS && (!best || dist < best.dist))
				best = { path: s.entry.path, dist };
		}
		return best;
	}

	open(path: string): void {
		if (!this.placed.has(path)) return;
		const state = this.opts.store.getState();
		if (state.signDraft) return;
		state.setOpenSign(path);
	}

	/** The reader or the owner's editor is up — WorldScene holds the player still. */
	isReading(): boolean {
		const s = this.opts.store.getState();
		return s.openSignPath !== null || s.signDraft !== null;
	}

	isPlacing(): boolean {
		return this.opts.store.getState().signPlacing;
	}

	/** The owner clicked the world while placing: the sign goes where the ghost shows it. */
	placeAtPointer(): void {
		const pointer = this.scene.input.activePointer;
		const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
		this.commitPlacement({ x: p.x, y: p.y });
	}

	private onPlaceHere = (): void => {
		if (!this.isPlacing()) return;
		const player = this.opts.playerPos();
		// Beside the player's feet, not under them.
		this.commitPlacement({ x: player.x + 44, y: player.y + 24 });
	};

	private commitPlacement(point: Position): void {
		const preview = this.previewAt(point);
		const state = this.opts.store.getState();
		if (!preview) {
			state.setSignPlacing(false);
			return;
		}
		this.showGhost(preview);
		state.setSignDraft({
			path: null,
			near: preview.near,
			offset: preview.offset,
			body: "# \n\n",
			suggestedPath: suggestSignPath(
				preview.near,
				new Set(state.signs.map((s) => s.path)),
			),
		});
	}

	/** What placing at `point` would do: the nearest arch or fountain becomes the target, and the sign lands where placeSign actually puts it. */
	private previewAt(point: Position): PlacementPreview | null {
		let best: {
			near: PlacementPreview["near"];
			anchor: Position;
			hub: Cluster;
			d: number;
		} | null = null;
		for (const portal of this.opts.manifest.portals) {
			const pos = this.opts.portalWorldPos.get(portal.id);
			const hub = this.clustersById.get(portal.clusterId);
			if (!pos || !hub) continue;
			const d = Math.hypot(point.x - pos.x, point.y - pos.y);
			if (!best || d < best.d)
				best = { near: { kind: "file", path: portal.id }, anchor: pos, hub, d };
		}
		for (const cluster of this.clusterByPath.values()) {
			const d = Math.hypot(point.x - cluster.pos.x, point.y - cluster.pos.y);
			if (!best || d < best.d)
				best = {
					near: { kind: "folder", path: cluster.path },
					anchor: cluster.pos,
					hub: cluster,
					d,
				};
		}
		if (!best) return null;
		const offset = { x: point.x - best.anchor.x, y: point.y - best.anchor.y };
		const feet = this.place(
			best.anchor,
			best.near.kind === "file" ? "portal" : "cluster",
			best.hub,
			offset,
			[...this.placed.values()].map((s) => s.feet),
		);
		if (!feet) return null;
		return {
			near: best.near,
			anchor: best.anchor,
			feet,
			offset: {
				x: Math.round(feet.x - best.anchor.x),
				y: Math.round(feet.y - best.anchor.y),
			},
		};
	}

	private place(
		anchor: Position,
		anchorKind: "portal" | "cluster",
		hub: Cluster,
		offset: Position | null,
		others: Position[],
	): Position | null {
		const { circles, segments } = signKeepouts(this.geometry, others);
		const input = {
			anchor,
			anchorKind,
			hub: hub.pos,
			offset,
			circles,
			segments,
			footprint: FOOTPRINT,
			maxFromHub: this.opts.groundRadius(hub) - 12,
		};
		return (
			placeSign(input) ??
			// A crowded clearing: still never on an arch or path, but allowed
			// past props and a little way into the rim.
			placeSign({
				...input,
				...signKeepouts({ ...this.geometry, obstacles: [] }, []),
				maxFromHub: this.opts.groundRadius(hub) + 80,
			})
		);
	}

	private anchorOf(
		entry: SignEntry,
	): { pos: Position; kind: "portal" | "cluster"; hub: Cluster } | null {
		if (entry.anchor.kind === "portal") {
			const pos = this.opts.portalWorldPos.get(entry.anchor.id);
			const portal = this.opts.manifest.portals.find(
				(p) => p.id === entry.anchor.id,
			);
			const hub = portal ? this.clustersById.get(portal.clusterId) : undefined;
			return pos && hub ? { pos, kind: "portal", hub } : null;
		}
		const hub = this.clustersById.get(entry.anchor.id);
		return hub ? { pos: hub.pos, kind: "cluster", hub } : null;
	}

	private sync(signs: readonly SignEntry[]): void {
		const shows = this.opts.shows;
		const sorted = (shows ? signs.filter(shows) : [...signs]).sort((a, b) =>
			a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
		);
		const wanted = new Map(sorted.map((s) => [s.path, s]));
		for (const [path, placed] of this.placed) {
			const entry = wanted.get(path);
			if (!entry || signatureOf(entry) !== placed.signature) {
				this.destroySign(placed);
				this.placed.delete(path);
			} else placed.entry = entry;
		}
		for (const entry of sorted) {
			if (this.placed.has(entry.path)) continue;
			const anchor = this.anchorOf(entry);
			if (!anchor) continue;
			const doc = parseSeyn(entry.source, { path: entry.path });
			const feet = this.place(
				anchor.pos,
				anchor.kind,
				anchor.hub,
				doc.offset,
				[...this.placed.values()].map((s) => s.feet),
			);
			if (!feet) continue;
			this.placed.set(entry.path, {
				entry,
				signature: signatureOf(entry),
				feet,
				...this.drawSign(feet),
			});
		}
		const focused = this.opts.store.getState().focusedSignPath;
		if (focused && !this.placed.has(focused))
			this.opts.store.getState().setFocusedSign(null);
	}

	private drawSign(feet: Position): {
		sprite: Phaser.GameObjects.Image;
		light: LightPool | null;
	} {
		const sprite = this.scene.add
			.image(feet.x, feet.y, SIGNPOST_KEY)
			.setOrigin(0.5, 1)
			.setDisplaySize(SIGN_W, SIGN_H)
			.setDepth(SIGN_DEPTH);
		const light = this.scene.textures.exists(FX_SPARK_KEY)
			? createLightPool(
					this.scene,
					{
						x: feet.x,
						y: feet.y - SIGN_H * 0.72,
						radiusPx: 30,
						color: PALETTE.gold,
						alpha: 0.45,
					},
					this.placed.size,
				)
			: null;
		return { sprite, light };
	}

	private destroySign(sign: PlacedSign): void {
		sign.sprite.destroy();
		sign.light?.sprite.destroy();
	}

	/** Draws a plain board into the texture cache when the pipeline sprite didn't load, so a sign is never an invisible hit target. */
	private ensureTexture(): void {
		if (this.scene.textures.exists(SIGNPOST_KEY)) return;
		const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
		g.fillStyle(PALETTE.ink, 1).fillRect(20, 20, 8, 44);
		g.fillStyle(PALETTE.trail, 1).fillRect(22, 20, 4, 44);
		g.fillStyle(PALETTE.ink, 1).fillRect(2, 4, 44, 26);
		g.fillStyle(PALETTE.gold, 1).fillRect(5, 7, 38, 20);
		g.generateTexture(SIGNPOST_KEY, SIGN_W, SIGN_H);
		g.destroy();
	}

	private linkWorld(): SignLinkWorld {
		return {
			portalIds: new Set(this.opts.portalWorldPos.keys()),
			clusterByPath: new Map(
				[...this.clusterByPath].map(([path, c]) => [path, c.id]),
			),
			signPaths: new Set(this.placed.keys()),
		};
	}

	private onFollowLink = ({ target }: { target: SeynLinkTarget }): void => {
		const resolved = resolveSignLink(target, this.linkWorld());
		if (!resolved || resolved.kind === "url") return;
		let pos: Position | undefined;
		let kind: "portal" | "cluster" | "sign";
		if (resolved.kind === "portal") {
			pos = this.opts.portalWorldPos.get(resolved.id);
			kind = "portal";
		} else if (resolved.kind === "cluster") {
			pos = this.clustersById.get(resolved.id)?.pos;
			kind = "cluster";
		} else {
			const feet = this.placed.get(resolved.path)?.feet;
			pos = feet && boardCentre(feet);
			kind = "sign";
		}
		if (!pos) return;
		this.opts.store.getState().setOpenSign(null);
		this.opts.walkTo(standInFront(pos, kind));
		this.highlight(pos, kind);
	};

	/** Orb search results for a sign carry its path as their id; WorldScene ignores ids it has no portal for. */
	private onWalkToPortal = ({ portalId }: { portalId: string }): void => {
		const sign = this.placed.get(portalId);
		if (!sign) return;
		const centre = boardCentre(sign.feet);
		this.opts.walkTo(standInFront(centre, "sign"));
		this.highlight(centre, "sign");
	};

	private highlight(pos: Position, kind: "portal" | "cluster" | "sign"): void {
		const radius = kind === "portal" ? 104 : kind === "cluster" ? 76 : 40;
		const ring = this.scene.add
			.circle(pos.x, pos.y, radius)
			.setStrokeStyle(4, PALETTE.gold, 0.95)
			.setDepth(HIGHLIGHT_DEPTH);
		if (this.opts.reducedMotion) {
			this.scene.time.delayedCall(HIGHLIGHT_MS, () => ring.destroy());
			return;
		}
		this.scene.tweens.add({
			targets: ring,
			scale: { from: 0.85, to: 1.12 },
			alpha: { from: 1, to: 0.35 },
			duration: 600,
			yoyo: true,
			repeat: Math.floor(HIGHLIGHT_MS / 1200) - 1,
			onComplete: () => ring.destroy(),
		});
	}

	private showGhost(preview: PlacementPreview): void {
		if (!this.ghost) {
			this.ghost = this.scene.add
				.image(0, 0, SIGNPOST_KEY)
				.setOrigin(0.5, 1)
				.setDisplaySize(SIGN_W, SIGN_H)
				.setAlpha(0.7)
				.setDepth(GHOST_DEPTH);
			this.ghostLine = this.scene.add.graphics().setDepth(GHOST_DEPTH - 0.001);
			this.ghostLabel = this.scene.add
				.text(0, 0, "", {
					fontFamily: '"Courier New", monospace',
					fontSize: "13px",
					fontStyle: "bold",
					color: toCssColor(PALETTE.cream),
					stroke: toCssColor(PALETTE.ink),
					strokeThickness: 3,
				})
				.setOrigin(0.5, 0)
				.setDepth(GHOST_DEPTH);
		}
		this.ghost.setPosition(preview.feet.x, preview.feet.y).setVisible(true);
		this.ghostLine
			?.clear()
			.lineStyle(2, PALETTE.gold, 0.8)
			.lineBetween(
				preview.feet.x,
				preview.feet.y - SIGN_H / 2,
				preview.anchor.x,
				preview.anchor.y,
			)
			.setVisible(true);
		this.ghostLabel
			?.setText(`beside ${seynNearValue(preview.near)}`)
			.setPosition(preview.feet.x, preview.feet.y + 4)
			.setVisible(true);
	}

	private hideGhostUnlessDrafting(): void {
		const s = this.opts.store.getState();
		if (s.signPlacing || (s.signDraft && s.signDraft.path === null)) return;
		this.ghost?.setVisible(false);
		this.ghostLine?.setVisible(false);
		this.ghostLabel?.setVisible(false);
	}

	private onUpdate = (_time: number, delta: number): void => {
		const state = this.opts.store.getState();
		this.blend = stepBlend(
			this.blend,
			targetBlend(state.timeOfDay),
			delta,
			600,
			this.opts.reducedMotion,
		);
		for (const s of this.placed.values())
			if (s.light) updateLightPool(s.light, this.blend, 1);
		if (state.mode !== "world") return;

		if (state.signPlacing) {
			const pointer = this.scene.input.activePointer;
			const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
			const preview = this.previewAt({ x: p.x, y: p.y });
			if (preview) this.showGhost(preview);
		}

		let focused: string | null = null;
		if (!state.signPlacing && !state.signDraft) {
			const player = this.opts.playerPos();
			let bestDist = SIGN_FOCUS_RADIUS;
			for (const s of this.placed.values()) {
				const c = boardCentre(s.feet);
				const d = Math.hypot(player.x - c.x, player.y - c.y);
				if (d <= bestDist) {
					bestDist = d;
					focused = s.entry.path;
				}
			}
			// Same tie-break as WorldScene.interact(): with an arch closer than
			// the sign, Enter goes through the arch, so the popup (whose hint
			// promises Enter reads the sign) stays down.
			if (
				focused &&
				this.opts.enterTakers?.some(
					(t) => Math.hypot(player.x - t.x, player.y - t.y) <= t.radius,
				)
			)
				focused = null;
			if (focused) {
				for (const arch of this.geometry.arches) {
					if (Math.hypot(player.x - arch.x, player.y - arch.y) < bestDist) {
						focused = null;
						break;
					}
				}
			}
		}
		if (focused !== state.focusedSignPath) state.setFocusedSign(focused);
	};

	destroy = (): void => {
		this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
		this.opts.bus.off("sign:follow-link", this.onFollowLink);
		this.opts.bus.off("sign:place-here", this.onPlaceHere);
		this.opts.bus.off("tool:walk-to-portal", this.onWalkToPortal);
		this.unsubscribe();
		for (const s of this.placed.values()) this.destroySign(s);
		this.placed.clear();
		this.ghost?.destroy();
		this.ghostLine?.destroy();
		this.ghostLabel?.destroy();
		const state = this.opts.store.getState();
		state.setFocusedSign(null);
		state.setOpenSign(null);
		state.setSignPlacing(false);
		state.setSignDraft(null);
	};
}

function signatureOf(entry: SignEntry): string {
	const offset = parseSeyn(entry.source, { path: entry.path }).offset;
	return `${entry.anchor.kind}:${entry.anchor.id}|${offset ? `${offset.x},${offset.y}` : ""}`;
}
