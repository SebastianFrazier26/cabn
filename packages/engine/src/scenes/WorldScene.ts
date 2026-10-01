import {
	clearingRadiusYForRing,
	GROUND_RADIUS_Y_RATIO,
} from "@cabn/converter/core";
import type {
	Cluster,
	EmbedVerdict,
	GitMeta,
	MediaPreview,
	Monster,
	Portal,
	Position,
	SignEntry,
	WorldChunk,
	WorldManifest,
	WorldPath,
} from "@cabn/world-schema";
import { WorldChunkSchema, worldLayerIssues } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import {
	ASSET_KEYS,
	biomeTileSheetKey,
	OPTIONAL_ASSET_KEYS,
	PORTAL_ARCH_FRAME_SIZE,
	PORTAL_VARIANT_SHEET_KEY,
	type SkylinePiece,
	WORLD_FOUNTAIN_GEM_KEY,
	WORLD_FOUNTAIN_IDLE_ANIM,
	WORLD_FOUNTAIN_KEY,
} from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { createPetWorldAccess } from "../pets/worldAccess.js";
import { type ArchOpening, ArchPreviews } from "../render/archPreviews.js";
import {
	type AtmosphereHandle,
	attachAtmosphere,
} from "../render/atmosphere.js";
import { ChunkStreamer } from "../render/chunkStream.js";
import {
	attachPointerInput,
	BOUNDS_INSET_PX,
	ClickWalker,
	drivePlayer,
	type PointerInputHandle,
	physicsBounds,
} from "../render/clickWalker.js";
import { dashedLine } from "../render/dashedLine.js";
import {
	attachLanternFlicker,
	attachWorldEffects,
	type WorldEffectsHandle,
} from "../render/effects.js";
import { bakeClusterGround } from "../render/groundBaker.js";
import { bakeGroundFieldChunk, CHUNK_SIZE_PX } from "../render/groundField.js";
import { GUIDE_INTERACT_RADIUS, GuideNpc } from "../render/guideNpc.js";
import type { LightPoolOptions } from "../render/lightPools.js";
import { MonsterOrbits } from "../render/monsterOrbit.js";
import {
	createMonsterSprite,
	renderedMonsterSpecies,
} from "../render/monsterSprite.js";
import {
	bakePathChunk,
	bakePathRibbonChunk,
	bakePathRibbons,
	bakePaths,
	type PathSegment,
	planPathRibbonChunks,
	planPathStamps,
	type WorldBounds,
} from "../render/pathBaker.js";
import { stampPointsAlongSegment } from "../render/pathStamps.js";
import { PetCompanion } from "../render/petCompanion.js";
import {
	createMovementKeys,
	createPlayer,
	DEFAULT_PLAYER_SPEED,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
} from "../render/playerController.js";
import { PortalFx } from "../render/portalFx.js";
import {
	materializeProp,
	type PlacedProp,
	type PlannedProp,
	planProps,
	propFootprints,
	propLightWorldPos,
	propSmokeWorldPos,
} from "../render/propPlacement.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import { Rift } from "../render/rift.js";
import {
	BONFIRE_RAW_SIZE_PX,
	BONFIRE_SCALE,
	CABINET_SCALE,
	MONSTER_HOVER_SIZE,
	WORLD_PORTAL_SCALE,
} from "../render/scale.js";
import { SignLayer } from "../render/signposts.js";
import { computeWorldBounds as sharedComputeWorldBounds } from "../render/worldBounds.js";
import {
	parseWorldChunkKey,
	worldChunkCandidatesNear,
	worldChunkPositionOf,
} from "../render/worldChunkGrid.js";
import {
	attachSky,
	bakeLazyEdgeSceneryChunk,
	boundsWithSky,
	type EdgeDressing,
	materializeEdgeSceneryExtras,
	planLazyEdgeScenery,
} from "../render/worldDressing.js";
import {
	type DisplayPreview,
	effectiveRichPreview,
} from "../systems/archPreview.js";
import {
	type ArchVariant,
	archVariantFor,
	archVariantFrame,
	archVariantGlow,
} from "../systems/archVariant.js";
import { relocateMonsters } from "../systems/battle.js";
import { touchChunk } from "../systems/chunkCache.js";
import {
	type ClickTarget,
	clampToBounds,
	type Interactable,
} from "../systems/clickWalk.js";
import {
	type CircleKeepout,
	type EdgeSceneryLayer,
	keepoutDistance,
	type LayeredSceneryItem,
	type SegmentKeepout,
} from "../systems/edgeScenery.js";
import { canOpenPortalLink, openPortalLink } from "../systems/embedGuard.js";
import {
	monsterClearancePx,
	type PortalOrbitShape,
	portalOrbitEllipseFor,
} from "../systems/monsterOrbit.js";
import { perfMark } from "../systems/perfMarks.js";
import {
	newlyApproached,
	type PortalPoint,
} from "../systems/portalApproach.js";
import {
	openingRect,
	pickNearWebPortal,
	playerOccluderRect,
	projectWorldRect,
	type Rect,
	rectsOverlap,
	unionRect,
	urlArchClickAction,
} from "../systems/portalFx.js";
import {
	layoutPortalRing,
	type PortalRingSizes,
} from "../systems/portalRing.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import {
	applyOverridesToChunk,
	clearSave,
	computeScenerySeed,
	computeWorldId,
	emptySaveData,
	loadSave,
	persistSave,
	previewSourceLines,
	type SaveData,
	withBagSlots,
	withDefeatedMonster,
	withFileOverride,
	withGuideTalked,
	withoutFileOverride,
	withPlayerPosition,
	withVisitedCluster,
} from "../systems/save.js";
import type { ScatterExclusion } from "../systems/scatter.js";
import {
	cabinTransitionDelayMs,
	layerRiseMs,
	layerTransitionDelayMs,
} from "../systems/sceneTransition.js";
import { subtleTint, type Theme, themeFromSeed } from "../systems/theme.js";
import { activeFocusOwner } from "../systems/uiFocus.js";
import {
	type ActiveWorldLayer,
	DEFAULT_SKIN,
	editorSaveTarget,
	inLayerClearing,
	isHiddenPath,
	type LayerClearing,
	pointsAlongPolyline,
	polylineMidpoint,
	type RingGeometry,
	resolveSkin,
	type SkinSceneryKind,
	type SkinStrip,
	skinAnimKey,
	skinTextures,
	type WorldSkin,
} from "../systems/worldLayer.js";
import { summarizeWorldMap } from "../systems/worldMap.js";
import {
	type AssetAvailability,
	BONFIRE_IDLE_ANIM,
	PORTAL_IDLE_ANIM,
} from "./PreloadScene.js";
import { WorldLayerSeam } from "./worldLayerSeam.js";

export interface WorldSceneData {
	manifest: WorldManifest;
	worldBase: string;
	availability: AssetAvailability;
	/** Set when this world was entered from the shelf — lets Escape at spawn go back. */
	returnTo?: { shelfUrl: string };
	/** The bundle's media.json entries (BootScene), keyed by portal id; empty for a bundle without one. */
	media?: ReadonlyMap<string, MediaPreview>;
	/** See BootSceneData — decides whether this is the shelf's first world, the one the guide NPC stands in. */
	shelfIndex?: number;
	/** The bundle's embeds.json verdicts (BootScene); empty for a bundle without one. */
	embeds?: ReadonlyMap<string, EmbedVerdict>;
	/** The bundle's signs.json entries (BootScene); empty for a bundle without one. */
	signs?: readonly SignEntry[];
	/** history.json (BootScene) — absent for a world without git history. */
	git?: WorldGitData;
	/** A world layer to show over this world (systems/worldLayer.ts) — only ever set by WorldScene's own layer toggle restart. */
	layer?: ActiveWorldLayer;
	/** Where the player stands after a layer toggle restart, instead of the saved spot. */
	spawnAt?: Position;
}

export interface WorldGitData {
	meta: GitMeta;
	historyBase: string;
	universe: { slug: string; branch: string } | null;
}

const CLUSTER_LOAD_RADIUS = 260;
// Approach/enter radii scale with the 2x arch (WORLD_PORTAL_SCALE). Focus —
// the expanded preview dock, and a url portal's live embed — is tighter than
// approach so merely walking past an arch doesn't pop a panel open.
const PORTAL_APPROACH_RADIUS = 150;
const PORTAL_FOCUS_RADIUS = 100;
const PORTAL_ENTER_RADIUS = 70;
const RETURN_TO_SHELF_RADIUS = 140;
/** Enter at the bonfire (with no portal in reach) returns to the shelf, same as Esc there — tighter than RETURN_TO_SHELF_RADIUS so it only fires when you're plainly standing at the fire, not at a portal on its ring. */
const BONFIRE_INTERACT_RADIUS = 90;
/** Where a click-walk to a portal stops (and enters) — inside PORTAL_ENTER_RADIUS so arrival always lands within Enter's reach. */
const PORTAL_ARRIVE_RATIO = 0.6;
/** Spyglass/orb "walk me there" — brisker than a normal walk, a summoned walk should read as brisk, not a full retrace. */
const SUMMONED_WALK_SPEED = 320;
/** How long a click-walk that arrived at a portal waits for that cluster's chunk fetch before giving up (entering needs the file's content). */
const ARRIVAL_CHUNK_WAIT_MS = 3000;
const MAX_LOADED_CHUNKS = 8;
// Measured from portal_arch_strip_soft.png's alpha channel (2026-09-28): the
// transparent opening spans x 68-192 and y 86-256 of each 256px frame, i.e.
// it runs to the frame's bottom edge, well below the sprite's centre. Inset a
// couple of pixels so the preview tucks under the stone rather than past it.
const ARCH_OPENING_WIDTH_RATIO = 0.47;
const ARCH_OPENING_HEIGHT_RATIO = 0.65;
const ARCH_OPENING_Y_OFFSET_RATIO = 0.17;
const PORTAL_ARCH_DISPLAY_SIZE = PORTAL_ARCH_FRAME_SIZE * WORLD_PORTAL_SCALE;
/** Keystone plaque centre (portal-variants.ts PLAQUE: grid rows 5-11 of 48, centred on the frame's middle row). */
const ARCH_PLAQUE_Y_OFFSET_RATIO = (8.5 - 24) / 48;
/** Portal-type trim overlay, between the arch (3) and its preview. */
const ARCH_VARIANT_DEPTH = 3.01;
/** Just above the arch sprite (3) so the preview covers the opening's idle sparkles, below monsters (4) and the player (5). */
const ARCH_PREVIEW_DEPTH = 3.05;
/** Motes/glow/sheen over the preview, still below monsters (4) and the player (5). */
const ARCH_FX_DEPTH = 3.06;
/** An orbiting monster on the far half of its ellipse — under the arch (3) so the stone and the opening's preview both hide it. */
const MONSTER_BEHIND_ARCH_DEPTH = 2.95;
const MONSTER_DEPTH = 4;
/** Reach either side of a path's midpoint for the cross-cluster ouroboros' figure-eight. */
const PATH_MONSTER_LOOP_PX = 70;
// MONSTER_HOVER_SIZE was tuned beside the old 96px arch; circling the 2x arch
// (192px) at those sizes they read as specks, so world monsters get a boost —
// capped so the already-large ouroboros doesn't swallow the opening.
const WORLD_MONSTER_SIZE_BOOST = 1.3;
const WORLD_MONSTER_MAX_PX = 72;
function worldMonsterPx(drawnSpecies: string, fallbackPx: number): number {
	return Math.min(
		(MONSTER_HOVER_SIZE[drawnSpecies] ?? fallbackPx) * WORLD_MONSTER_SIZE_BOOST,
		WORLD_MONSTER_MAX_PX,
	);
}
const ARCH_OPENING: ArchOpening = {
	width: PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_WIDTH_RATIO,
	height: PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_HEIGHT_RATIO,
	offsetY: PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_Y_OFFSET_RATIO,
};

// M10b batch 3: the old radius formula (90 + min(count,40)*4, capping out at
// 250px for a 40-portal cluster) put arches 39px apart at that cap — well
// under PORTAL_ARCH_DISPLAY_SIZE (96px) itself, so a busy cluster's arches
// visibly overlapped ("packs file arches tightly around the bonfire",
// batch-3 review). This derives the ring radius from the actual spacing
// needed instead: circumference / count must be at least one arch slot.
// Since 2026-09-28 round 2 each path leaving the hub also claims a gate in
// the ring (systems/portalRing.ts), mirrored in packages/converter/src/
// layout.ts's estimatedClearingRadius() so whole clusters are sized for it.
//
// 2026-09-28 (2x arches): spacing is now 1.0x the frame, not 1.2x — the frame
// has ~11% transparent margin each side (visible stone is ~200/256 of it), so
// 1.0x still leaves a ~40px gap between neighbouring arches without doubling
// every busy clearing's radius. The minimum radius grew so a 192px-tall arch
// at the top/bottom of a small ring clears the cabinet/bonfire at the centre.
const PORTAL_RING_SIZES: PortalRingSizes = {
	archSlotPx: PORTAL_ARCH_DISPLAY_SIZE,
	// Half a slot: with the arch's own transparent margin that leaves ~30-50px
	// of grass between a path ribbon's edge and the nearest arch.
	pathGatePx: PORTAL_ARCH_DISPLAY_SIZE / 2,
	minRadiusPx: 180,
};
/** Room beyond the outermost portal ring for the prop-framing annulus + the flower-ring edge marking — this is what actually grows a clearing to fit its own content, rather than a flat per-file increment. */
const CLEARING_OUTER_MARGIN = 90;

const DECALS_PER_CLUSTER = 14;
const PROPS_PER_CLUSTER = 4;
/** How far into the clearing's outer annulus props are confined (see systems/scatter.ts's minRadiusFrac) — "frame the edges/corners", not scatter anywhere between the plaza and the boundary. */
const PROP_ANNULUS_INNER_FRAC = 0.68;
/** Where the fountain's lower basin water sits relative to the sprite centre (world-fountain.ts's WATER.cy, 41 of 58 cells) — the night light pool reflects off the water, not the column. */
const FOUNTAIN_WATER_OFFSET_Y = 24;
/** The gem socket's centre relative to the sprite centre (world-fountain.ts's GEM.cy, 30 of 58 cells, at 2px per cell). */
const FOUNTAIN_GEM_OFFSET_Y = 2;
/** Lantern amber rather than the bonfire's gold: over the pale-blue water gold summed to a cold white (art polish 2, 2026-09-28). */
const FOUNTAIN_GLOW = 0xeb8c3c;
/** How far the fountain gem's theme tint is kept from white (systems/theme.ts's subtleTint). At full strength the multiply sank the gem to the stone's own value, so it vanished by day and night alike. */
const FOUNTAIN_GEM_TINT_STRENGTH = 0.7;
// Half the arch's display size + room for a prop's own half-extent — batch 1
// excluded only 44px around a portal, so a prop could land partway inside the
// sprite. Exclusions test the prop's *centre*, so since the 2026-09-28 art
// density pass (cottages/trees ~120px tall) a +10px margin still let a tree
// canopy overlap an arch (playtest round 2).
const PORTAL_EXCLUSION_RADIUS = PORTAL_ARCH_DISPLAY_SIZE / 2 + 50;
const SPAWN_EXCLUSION_RADIUS = 56;
// Batch 1 never excluded the cluster center itself — cabinet/bonfire always
// sit exactly there, so a prop or decal could land directly on top of one.
const CLUSTER_CENTER_EXCLUSION_RADIUS = 90;
// Path half-width (~17px) + a prop's half-extent, for the same centre-only
// reason as PORTAL_EXCLUSION_RADIUS: at 26px cottages and wells sat on the
// path ribbon itself (playtest round 2).
const PATH_CORRIDOR_EXCLUSION_RADIUS = 70;
const PATH_CORRIDOR_SAMPLE_SPACING = 40;
/** Fixed, not per-world — the field's own texture variety already comes from tile position, not from needing a different seed per world. */
const FIELD_SEED = 20260928;

// M10 stream-bake (docs/testing/2026-09-29-wide-pass.md Bug 1): ground-field
// and per-cluster-ground bakes stream in around the camera instead of over
// the whole world, so entry cost is bounded by the viewport, not by cluster
// count/world spread. Budgets deliberately small (a synchronous RT bake
// can't be pre-empted mid-draw, so this is "stop asking for more once we've
// already spent this much," not a hard cap) — see chunkStream.ts's own doc
// comment for why "always bake at least one" matters here.
const GROUND_STREAM_BUDGET_MS = 4;
const GROUND_STREAM_MAX_CHUNKS_PER_FRAME = 3;
const CLUSTER_GROUND_STREAM_BUDGET_MS = 4;
const CLUSTER_GROUND_STREAM_MAX_PER_FRAME = 2;
/** 3s of buffer at the fastest movement this game has (click-walk's own SUMMONED_WALK_SPEED, 320px/s) — long enough that the per-frame budget above has finished a chunk well before the player could reach its edge on foot, short enough that it still scales with viewport, not world size. */
const GROUND_STREAM_LOOKAHEAD_PX = SUMMONED_WALK_SPEED * 3;
/** One full field chunk of hysteresis: a chunk sitting exactly on the load boundary must not load/evict/reload every frame as floating-point camera motion nudges it back and forth (see chunkStream.test.ts's own hysteresis case). */
const GROUND_STREAM_EVICT_HYSTERESIS_PX = CHUNK_SIZE_PX;
/** Same reasoning as ShelfScene's TOWER_SPAWN_CLEARANCE — clear space between the player's physics body and the bonfire's edge. */
const BONFIRE_SPAWN_CLEARANCE = 24;
/** Edge scenery keeps this far outside a clearing's own ground radius, so the forest frames the clearing instead of crowding its flower ring. */
const EDGE_SCENERY_CLEARING_PAD = 36;
/** Half the path ribbon's width (its sand edge disc radius, ~16.5px) plus a little air. */
const EDGE_SCENERY_PATH_HALF_WIDTH = 20;
/** Subtle per-world identity tint over the tiled ground — a low-alpha overlay rather than Phaser's multiplicative sprite tint, which would recolor the tile art itself instead of just washing over it. */
const GROUND_THEME_TINT_ALPHA = 0.12;
/** A skin's arch overlay (runes) sits on the stone, under the portal-type trim. */
const ARCH_SKIN_OVERLAY_DEPTH = 3.005;
/** The brazier standing in for the root bonfire reads as the world's hearth: a little larger than a cluster's. */
const ROOT_BRAZIER_SCALE = 0.9;
/** Where a brazier's flames sit relative to its sprite centre (the skin's brazier art), for its night light. */
const BRAZIER_FLAME_OFFSET_Y = -28;
/** A base cluster's prop this close to a layer path's centreline is hidden while the layer shows (props were placed without layer paths, so they never move). */
const LAYER_PATH_PROP_CLEARANCE = 42;

export class WorldScene extends Phaser.Scene {
	private manifest!: WorldManifest;
	private worldBase = "";
	private media: ReadonlyMap<string, MediaPreview> = new Map();
	private embeds: ReadonlyMap<string, EmbedVerdict> = new Map();
	private availability!: AssetAvailability;
	private returnTo: { shelfUrl: string } | undefined;
	private shelfIndex: number | undefined;
	private guideNpc: GuideNpc | null = null;
	private rift: Rift | null = null;
	private git: WorldGitData | undefined;
	private signEntries: readonly SignEntry[] = [];
	private signs: SignLayer | null = null;
	private pet: PetCompanion | null = null;
	private initData!: WorldSceneData;
	/** The world as its bundle has it; `manifest` is this plus the active layer, if any. */
	private baseManifest!: WorldManifest;
	private layerSeam: WorldLayerSeam | null = null;
	private skin: WorldSkin = DEFAULT_SKIN;
	private skinLoadFailed = new Set<string>();
	private layerSwitching = false;
	/** Set the instant a return-to-shelf is confirmed, guarding the transition-hold window (see handleReturnToShelf) against a second Esc press re-triggering scene.start before the first one fires. */
	private returningToShelf = false;
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private clustersById = new Map<string, Cluster>();
	private portalsById = new Map<string, Portal>();
	private portalWorldPos = new Map<string, Position>();
	private portalRingRadii = new Map<string, number>();
	private clearingRadiiY = new Map<string, number>();
	private portalSprites = new Map<string, Phaser.GameObjects.Sprite>();
	private portalVariantOverlays = new Map<string, Phaser.GameObjects.Image>();
	private portalVariants = new Map<string, ArchVariant>();
	private portalPathById = new Map<string, string>();
	private worldFiles = new Set<string>();

	private monstersById = new Map<string, Monster>();
	private portalMonsterIds = new Map<string, string[]>();
	private monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
	private monsterOrbits: MonsterOrbits | null = null;
	/** portalId -> its monsters re-checked against that saved override text, so re-entering an unchanged edited file doesn't re-run the annotators. */
	private overrideMonsters = new Map<
		string,
		{ content: string; monsters: Monster[] }
	>();

	/** clusterId -> path -> file content, exactly as fetched — never mutated, so a "reset this file" always has the pristine original to fall back to. */
	private chunkContents = new Map<string, Record<string, string>>();
	/** Same shape, with `save.fileOverrides` spliced in — what portal entry/exit and the arch preview actually read from; recomputed via refreshEffectiveChunk() whenever a chunk (re)loads or an override changes. */
	private effectiveChunkContents = new Map<string, Record<string, string>>();
	private chunkLoadOrder: string[] = [];
	private chunkFetchesInFlight = new Set<string>();

	private worldId = "";
	private scenerySeed = "";
	private save: SaveData = emptySaveData("");
	private editedMarkers = new Map<string, Phaser.GameObjects.Text>();
	/** Every prop materialized so far, across every cluster whose ground has streamed in — setupAmbientEffects() reads this once, at entry, to find light-emitting props (cottage windows, lamp posts); anything materialized later goes through registerPropAmbient instead (see drawGround()'s doc comment). */
	private placedProps: PlacedProp[] = [];
	/** Where every cluster's props go — planned for the whole world up front (cheap position data, no sprites), independent of which clusters have actually streamed in. Signs/spawn/click-walk keepouts and the shadow-owner e2e's "props never move" expectations read this instead of waiting on placedProps. */
	private plannedProps = new Map<string, PlannedProp[]>();
	/** True once raiseLayer() has run its one-time seam.collect() scan — a cluster's ground/props materialized before that point are picked up by that scan; materialized after, they need an explicit layerSeam.addRiser() instead (see bakeOneClusterGround/materializeClusterProps). */
	private layerRisersCollected = false;
	/** Ground-field grid chunks streamed in/out around the camera (render/chunkStream.ts) — see drawGround()'s doc comment for why only the field itself evicts and per-cluster ground below doesn't. */
	private groundFieldStreamer: ChunkStreamer<
		string,
		Phaser.GameObjects.RenderTexture
	> | null = null;
	private clusterGroundStreamer: ChunkStreamer<
		string,
		Phaser.GameObjects.RenderTexture
	> | null = null;
	/** Cluster-ground streaming's theme-tint ellipses accrete into this one Graphics as each cluster's ground bakes (in whatever order the streamer picks), same as they always did in the old all-at-once loop. */
	private groundTintOverlay: Phaser.GameObjects.Graphics | null = null;
	/** Payload is null for a chunk that was checked and has nothing to draw (bakeScenery/path chunks only exist where content actually falls — see sceneryBaker.ts's own doc comment) — still "loaded" so the streamer never re-checks it every frame. */
	private edgeSceneryStreamer: ChunkStreamer<
		string,
		Phaser.GameObjects.RenderTexture | null
	> | null = null;
	/** Filler is planned lazily per chunk (edgeScenery.ts's planFillerChunkForContext), so unlike every other streamer here there's no whole-world item list to fall back on — this is the only record of what's actually been planned/baked so far, read by EdgeDressing.items (see drawEdgeScenery). */
	private edgeSceneryLoadedItems = new Map<string, LayeredSceneryItem[]>();
	private pathStreamer: ChunkStreamer<
		string,
		Phaser.GameObjects.RenderTexture | null
	> | null = null;
	private ambientEffects: WorldEffectsHandle | null = null;
	/** Grows as streamed-in clusters' cottages are materialized (registerPropAmbient) — mutable, kept accurate so a *future* full rebuild (a day/night toggle) still finds every chimney, even ones added after the last rebuild. */
	private chimneyPositions: Position[] = [];
	private ambientReducedMotion = false;
	private atmosphere: AtmosphereHandle | null = null;
	private edgeDressing: EdgeDressing | null = null;
	private sky: ReturnType<typeof attachSky> | null = null;
	private unsubscribeBagSlots: (() => void) | null = null;
	private unsubscribeAmbientTimeOfDay: (() => void) | null = null;

	private player!: PlayerHandle;
	private movementKeys!: MovementKeys;
	private playerTextures!: PlayerTextures;

	private keys!: {
		enter: Phaser.Input.Keyboard.Key;
		esc: Phaser.Input.Keyboard.Key;
	};
	private walker!: ClickWalker;
	private pointerInput!: PointerInputHandle;
	/** A click-walk arrived at this interactable; handled in update() once portal approach state is current. */
	private pendingArrival: { target: Interactable; waitedMs: number } | null =
		null;

	private archPreviews: ArchPreviews | null = null;
	private portalFx: PortalFx | null = null;
	private focusedPortalId: string | null = null;
	private nearWebPortalId: string | null = null;
	private portalsInRange = new Set<string>();

	/** One theme per world (see drawClusters' doc comment) — computed once in create() so drawGround's ground-tint overlay and drawClusters' cabinet/bonfire tint always agree. */
	private theme!: Theme;

	constructor() {
		super({ key: "world", active: false });
	}

	init(data: WorldSceneData): void {
		this.initData = data;
		this.baseManifest = data.manifest;
		this.layerSeam = data.layer
			? WorldLayerSeam.create(data.manifest, data.layer)
			: null;
		this.manifest = this.layerSeam?.manifest ?? data.manifest;
		this.skin = this.layerSeam?.skin ?? DEFAULT_SKIN;
		this.layerSwitching = false;
		this.resetWorldState();
		this.worldBase = data.worldBase;
		this.media = data.media ?? new Map();
		this.embeds = data.embeds ?? new Map();
		this.signEntries = [
			...(data.signs ?? []),
			...(this.layerSeam?.signs ?? []),
		];
		this.availability = data.availability;
		this.returnTo = data.returnTo;
		this.shelfIndex = data.shelfIndex;
		this.git = data.git;
		// Phaser reuses the scene instance across scene.start(), so a flag set
		// by the last visit's return-to-shelf would otherwise still be true.
		this.returningToShelf = false;
		this.pendingArrival = null;
		this.store = this.registry.get("store");
		this.bus = this.registry.get("bus");
	}

	/**
	 * A layer skin's textures load here, lazily, the first time that layer
	 * shows (and stay cached for the next toggle). Nothing here runs for
	 * DEFAULT_SKIN, which names no textures.
	 */
	preload(): void {
		this.skinLoadFailed = new Set();
		const pending = skinTextures(this.skin).filter(
			(t) => !this.textures.exists(t.key),
		);
		if (pending.length === 0) return;
		const onError = (file: Phaser.Loader.File): void => {
			this.skinLoadFailed.add(file.key);
		};
		this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
		this.load.once(Phaser.Loader.Events.COMPLETE, () =>
			this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError),
		);
		for (const t of pending) {
			if ("frameWidth" in t)
				this.load.spritesheet(t.key, t.path, {
					frameWidth: t.frameWidth,
					frameHeight: t.frameHeight,
				});
			else this.load.image(t.key, t.path);
		}
	}

	/** Drops any skin texture group that didn't load, and registers the skin's animations once per game. */
	private settleSkin(): void {
		this.skin = resolveSkin(
			this.skin,
			(key) => this.textures.exists(key) && !this.skinLoadFailed.has(key),
		);
		const strips: (SkinStrip | null | undefined)[] = [
			this.skin.arch?.strip,
			this.skin.arch?.overlay,
			this.skin.brazier,
		];
		for (const strip of strips) {
			if (!strip || this.anims.exists(skinAnimKey(strip))) continue;
			this.anims.create({
				key: skinAnimKey(strip),
				frames: this.anims.generateFrameNumbers(strip.key, {
					start: 0,
					end: strip.frames - 1,
				}),
				frameRate: strip.frameRate,
				repeat: -1,
			});
		}
	}

	create(): void {
		perfMark("cabn:world:create-start");
		this.settleSkin();
		// Before the atmosphere, sky and ambient effects read timeOfDay, so a
		// pinned layer starts in its own look instead of cross-fading into it.
		this.store.getState().setTimeOfDayPin(this.skin.fixedTimeOfDay);
		for (const cluster of this.manifest.clusters)
			this.clustersById.set(cluster.id, cluster);
		for (const portal of this.manifest.portals) {
			this.portalsById.set(portal.id, portal);
			this.portalPathById.set(portal.id, portal.file.path);
			this.worldFiles.add(portal.file.path);
		}
		for (const monster of this.manifest.monsters) {
			this.monstersById.set(monster.id, monster);
			if (monster.portalId) {
				const list = this.portalMonsterIds.get(monster.portalId) ?? [];
				list.push(monster.id);
				this.portalMonsterIds.set(monster.portalId, list);
			}
		}

		this.worldId = computeWorldId(this.manifest.meta);
		this.scenerySeed = computeScenerySeed(this.baseManifest);
		this.save = loadSave(this.worldId);
		this.layerSeam?.openSlot(this.worldId);
		this.theme = themeFromSeed(this.manifest.meta.themeSeed ?? 0);

		// Portal positions and the player spawn point both have to exist before
		// drawGround() runs — its decal/prop scatter must exclude them — so
		// they're computed (not yet rendered) ahead of everything else.
		this.computePortalPositions();
		this.layerSeam?.computeRoutes((id) => this.ringGeometry(id));
		this.store
			.getState()
			.setWorldMap(
				summarizeWorldMap(
					this.manifest,
					this.portalWorldPos,
					this.layerSeam?.layer ?? null,
				),
			);
		this.publishVisitedClusters();
		const spawn = this.resolveSpawnPos();

		const beforeBake = new Set(this.children.list);
		// Scatter keeps clear of where a fresh visit starts, not of wherever
		// the player happens to stand: a layer toggle restarts the scene at
		// the player's spot, and props and scenery must not move with it.
		const sceneryKeepout = this.defaultSpawnPos();
		perfMark("cabn:world:bake-start");
		this.drawGround(sceneryKeepout);
		perfMark("cabn:world:ground-baked");
		this.drawPaths(sceneryKeepout);
		perfMark("cabn:world:paths-baked");
		this.drawEdgeScenery(sceneryKeepout);
		perfMark("cabn:world:edge-scenery-baked");
		this.drawClusters();
		this.drawPortals();
		this.drawEditedMarkers();
		perfMark("cabn:world:bake-end");
		this.monsterOrbits = new MonsterOrbits(this, prefersReducedMotion(), {
			behind: MONSTER_BEHIND_ARCH_DEPTH,
			front: MONSTER_DEPTH,
		});
		// Before the orbits are drawn: an override that never went through a
		// save's re-check (a restored stash) may already have fixed some.
		for (const portalId of Object.keys(this.save.fileOverrides))
			this.liveMonstersFor(portalId);
		this.drawMonsters();
		this.guideNpc = GuideNpc.spawn(this, {
			manifest: this.baseManifest,
			shelfIndex: this.shelfIndex,
			store: this.store,
			spawn: this.defaultSpawnPos(),
			portalPositions: this.basePortalPositions(),
			bonfireWidth: this.bonfireDisplayWidth(),
			reducedMotion: prefersReducedMotion(),
			talked: () => this.save.guideTalked === true,
			markTalked: () => {
				this.save = withGuideTalked(this.save);
				persistSave(this.save);
			},
		});
		this.publishGitContext();
		this.rift = Rift.spawn(this, {
			manifest: this.baseManifest,
			store: this.store,
			bus: this.bus,
			spawn: this.defaultSpawnPos(),
			portalPositions: this.basePortalPositions(),
			bonfireWidth: this.bonfireDisplayWidth(),
			guidePos: this.guideNpc?.pos ?? null,
			reducedMotion: prefersReducedMotion(),
			returnTo: this.returnTo,
			shelfIndex: this.shelfIndex,
			applyOverrides: (files) => {
				const savedAt = new Date().toISOString();
				for (const [portalId, content] of Object.entries(files)) {
					if (this.portalsById.has(portalId))
						this.save = withFileOverride(this.save, portalId, content, savedAt);
				}
				persistSave(this.save);
			},
			beforeTravel: () => this.persistPlayerPos(),
		});
		this.createPlayer(spawn);
		this.spawnSigns();
		this.raiseLayer(beforeBake);
		this.setupInput();
		this.pet = new PetCompanion(this, {
			store: this.store,
			reducedMotion: prefersReducedMotion(),
			playerPos: () => ({ x: this.player.body.x, y: this.player.body.y }),
		});
		this.publishPetWorld();
		this.setupCamera();
		this.publishPortalIndex();
		this.publishMonsterIndex();
		this.setupToolBusListeners();
		this.setupSaveListeners();
		this.setupLayerListeners();
		this.setupAmbientEffects();
		perfMark("cabn:world:create-end");
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.unsubscribeAmbientTimeOfDay?.();
			this.unsubscribeAmbientTimeOfDay = null;
			this.ambientEffects?.destroy();
			this.ambientEffects = null;
			this.atmosphere?.destroy();
			this.atmosphere = null;
			this.sky?.destroy();
			this.sky = null;
			this.edgeDressing?.destroy();
			this.edgeDressing = null;
			this.archPreviews?.destroy();
			this.archPreviews = null;
			this.portalFx?.destroy();
			this.portalFx = null;
			this.monsterOrbits?.destroy();
			this.monsterOrbits = null;
			this.monsterSprites.clear();
			this.portalVariantOverlays.clear();
			this.portalVariants.clear();
			this.groundFieldStreamer?.destroyAll((_key, rt) => rt.destroy());
			this.groundFieldStreamer = null;
			this.clusterGroundStreamer?.destroyAll((_key, rt) => rt.destroy());
			this.clusterGroundStreamer = null;
			this.groundTintOverlay?.destroy();
			this.groundTintOverlay = null;
			this.edgeSceneryStreamer?.destroyAll((_key, rt) => rt?.destroy());
			this.edgeSceneryStreamer = null;
			this.pathStreamer?.destroyAll((_key, rt) => rt?.destroy());
			this.pathStreamer = null;
			// Phaser's CameraManager shuts down first (it subscribed when the
			// scene started, before create()) and clears `main` — without the
			// `?.` every return to the shelf threw here and froze the game.
			this.cameras.main?.off(
				Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE,
				this.projectWebPortal,
			);
			this.setFocusedPortal(null);
			this.setNearWebPortal(null);
			this.store.getState().setWorldMap(null);
			this.store.getState().setPetWorld(null);
			this.pet = null;
		});
	}

	/** Signposts for the bundle's .seyn files (render/signposts.ts) — placed last so they can keep clear of the props, the guide and the spawn point too. */
	private spawnSigns(): void {
		const spawn = this.defaultSpawnPos();
		// From plannedProps (data), not placedProps (sprites) — every cluster's
		// props are planned up front regardless of which have streamed in yet
		// (see drawGround()'s doc comment), so signs keep clear of all of them,
		// not just whichever happen to be materialized when spawnSigns() runs.
		const footprints = propFootprints(this);
		const obstacles: CircleKeepout[] = [...this.plannedProps.values()]
			.flat()
			.map((prop) => {
				const fp = footprints[prop.name];
				return { x: prop.x, y: prop.y, radius: Math.max(fp.w, fp.h) * 0.4 };
			});
		obstacles.push({ x: spawn.x, y: spawn.y, radius: 40 });
		if (this.guideNpc)
			obstacles.push({
				x: this.guideNpc.pos.x,
				y: this.guideNpc.pos.y,
				radius: 44,
			});
		this.signs = SignLayer.spawn(this, {
			store: this.store,
			bus: this.bus,
			manifest: this.manifest,
			signs: this.signEntries,
			portalWorldPos: this.portalWorldPos,
			groundRadius: (cluster) => this.groundRadius(cluster),
			obstacles,
			reducedMotion: prefersReducedMotion(),
			walkTo: (pos) =>
				this.walker.walkTo(
					clampToBounds(pos, physicsBounds(this), BOUNDS_INSET_PX),
					{
						from: { x: this.player.body.x, y: this.player.body.y },
						speed: SUMMONED_WALK_SPEED,
						showMarker: false,
					},
				),
			playerPos: () => ({ x: this.player.body.x, y: this.player.body.y }),
			enterTakers: this.signEnterTakers(),
		});
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.signs = null;
		});
	}

	/** Where Enter keeps its old meaning even with a sign in reach: talking to the guide, and (from a shelf) going back at the bonfire — which covers the fresh spawn point. */
	private signEnterTakers(): CircleKeepout[] {
		const takers: CircleKeepout[] = [];
		if (this.guideNpc)
			takers.push({ ...this.guideNpc.pos, radius: GUIDE_INTERACT_RADIUS });
		const root = this.rootCluster();
		if (root && this.returnTo)
			takers.push({ ...root.pos, radius: BONFIRE_INTERACT_RADIUS });
		return takers;
	}

	/** What the pet may read (pets/worldAccess.ts): effective text, save overrides included; files an undefeated magpie guards stay in the browser. */
	private publishPetWorld(): void {
		// Pets only ever see the base world: never a layer's files or text.
		const basePortals = new Map(
			this.baseManifest.portals.map((p) => [p.id, p] as const),
		);
		const magpieGuarded = (path: string): boolean =>
			(this.portalMonsterIds.get(path) ?? []).some((id) => {
				const monster = this.monstersById.get(id);
				return (
					monster?.species === "magpie" &&
					!this.save.defeatedMonsterIds.includes(id)
				);
			});
		this.store.getState().setPetWorld(
			createPetWorldAccess({
				worldBase: this.worldBase,
				files: this.baseManifest.portals.map((p) => ({
					path: p.file.path,
					bytes: p.file.bytes,
					kind: p.file.kind,
				})),
				loadedText: (path) => {
					const portal = basePortals.get(path);
					return portal
						? this.effectiveChunkContents.get(portal.clusterId)?.[path]
						: undefined;
				},
				savedOverride: (path) => this.save.fileOverrides[path]?.content,
				chunkFor: (path) => {
					const portal = basePortals.get(path);
					return portal
						? this.clustersById.get(portal.clusterId)?.chunk
						: undefined;
				},
				withheld: (path) =>
					magpieGuarded(path)
						? "A magpie is guarding a leaked secret in this file, so it stays in the player's browser. Ask them to defeat the magpie (remove the secret) first."
						: null,
			}),
		);
	}

	/** Day/night grade + light pools (render/atmosphere.ts), fireflies/motes/embers/smoke (render/effects.ts), and the lamp-post/cottage-window flicker. */
	private setupAmbientEffects(): void {
		const reducedMotion = prefersReducedMotion();
		this.ambientReducedMotion = reducedMotion;
		const root =
			this.manifest.clusters.find((c) => c.path === ".") ??
			this.manifest.clusters[0];
		// this.chimneyPositions and every entry prop's lantern flicker are
		// already set by registerPropAmbient, called as each prop materialized
		// (drawGround runs — and therefore materializes every entry cluster's
		// props — before create() ever reaches this method); a cluster
		// streamed in later pushes its own cottage chimneys the same way and
		// re-triggers rebuild() below, so neither needs recomputing here.
		const warmLight = this.skin.lightColor ?? PALETTE.gold;
		const lights: LightPoolOptions[] = this.placedProps.flatMap((prop) => {
			const pos = propLightWorldPos(prop);
			if (!pos) return [];
			return [
				{
					x: pos.x,
					y: pos.y,
					radiusPx: 44,
					color: warmLight,
					alpha: 0.7,
					flicker: prop.name === "lamp-post",
				},
			];
		});
		const skinGlow = this.skin.dayGlowStrength ?? 0;
		if (root) {
			lights.push({
				x: root.pos.x,
				y: root.pos.y,
				radiusPx: 120,
				color: warmLight,
				alpha: 0.75,
				flicker: true,
				...(this.skin.brazier ? { dayStrength: skinGlow } : {}),
			});
		}
		lights.push(...(this.edgeDressing?.lights ?? []));
		lights.push(...this.pathGlowLights());
		if (this.availability.worldArt) {
			for (const cluster of this.manifest.clusters) {
				if (cluster === root) continue;
				if (this.hasBrazier(cluster)) {
					lights.push({
						x: cluster.pos.x,
						y: cluster.pos.y + BRAZIER_FLAME_OFFSET_Y,
						radiusPx: 70,
						color: warmLight,
						alpha: 0.8,
						flicker: true,
						dayStrength: skinGlow,
					});
					continue;
				}
				lights.push(
					{
						x: cluster.pos.x,
						y: cluster.pos.y + FOUNTAIN_WATER_OFFSET_Y,
						radiusPx: 60,
						color: FOUNTAIN_GLOW,
						alpha: 0.75,
						holeStrength: 0.35,
					},
					{
						x: cluster.pos.x,
						y: cluster.pos.y + FOUNTAIN_GEM_OFFSET_Y,
						radiusPx: 9,
						color: this.gemTint(),
						alpha: 0.35,
					},
				);
			}
		}
		// Each arch's preview is its own faint light source — without this the
		// night grade darkens the in-arch text to illegible. Cool and dim so the
		// additive glow doesn't wash the preview out; the grade hole (see
		// render/atmosphere.ts) is what actually keeps it readable.
		for (const pos of this.portalWorldPos.values()) {
			lights.push({
				x: pos.x,
				y: pos.y + PORTAL_ARCH_DISPLAY_SIZE * ARCH_OPENING_Y_OFFSET_RATIO,
				radiusPx: PORTAL_ARCH_DISPLAY_SIZE * 0.32,
				color: PALETTE.paleGhostBlue,
				alpha: 0.08,
			});
		}
		// The keystone plaque is what tells arch types apart, and the grade
		// otherwise swallows it — a small light in the variant's rune colour.
		for (const [portalId, variant] of this.portalVariants) {
			const pos = this.portalWorldPos.get(portalId);
			if (!pos || variant === "generic") continue;
			lights.push({
				x: pos.x,
				y: pos.y + PORTAL_ARCH_DISPLAY_SIZE * ARCH_PLAQUE_Y_OFFSET_RATIO,
				radiusPx: PORTAL_ARCH_DISPLAY_SIZE * 0.12,
				color: archVariantGlow(variant, this.skin.archTint),
				alpha: 0.35,
			});
		}
		this.atmosphere = attachAtmosphere(this, this.store, {
			lights,
			reducedMotion,
			skin: this.skin,
		});
		if (this.availability.atmosphereArt) {
			this.sky = attachSky(
				this,
				this.computeWorldBounds(),
				this.scenerySeed,
				this.atmosphere,
				reducedMotion,
				this.skin.skylineTint ?? undefined,
				{
					...(this.layerSeam ? { baseBounds: this.baseWorldBounds() } : {}),
					...(this.skin.sky ? { skyKey: this.skin.sky.key } : {}),
					...(this.skin.skyline
						? {
								pieceTextureFor: (piece: SkylinePiece) =>
									this.skin.skyline?.[piece]?.key,
							}
						: {}),
				},
			);
		}

		// Fireflies-vs-motes is a swap, not a fade — rebuilt on the toggle
		// itself while the grade/lights cross-fade in render/atmosphere.ts.
		const rebuild = (): void => {
			this.ambientEffects?.destroy();
			this.ambientEffects = attachWorldEffects(this, {
				bounds: this.computeWorldBounds(),
				timeOfDay: this.store.getState().timeOfDay,
				bonfirePos: root?.pos,
				chimneyPositions: this.chimneyPositions,
				reducedMotion,
				particles: this.skin.particles,
				ambient: this.skin.ambient,
			});
		};
		rebuild();
		this.unsubscribeAmbientTimeOfDay = this.store.subscribe((state, prev) => {
			if (state.timeOfDay !== prev.timeOfDay) rebuild();
		});
	}

	/**
	 * The incremental counterpart to setupAmbientEffects()'s own one-time
	 * lantern/light/chimney setup — called for a prop materialized *after*
	 * that method already ran (a cluster streaming in as the player walks).
	 * A no-op before setupAmbientEffects has run at all (this.atmosphere is
	 * still null then; that method's own initial pass will pick up any
	 * already-materialized prop itself, so nothing is lost either way).
	 */
	private registerPropAmbient(prop: PlacedProp): void {
		if (prop.name === "lamp-post" || prop.name === "cottage") {
			attachLanternFlicker(this, prop.sprite, this.ambientReducedMotion);
		}
		const lightPos = propLightWorldPos(prop);
		if (lightPos) {
			const warmLight = this.skin.lightColor ?? PALETTE.gold;
			this.atmosphere?.addLight({
				x: lightPos.x,
				y: lightPos.y,
				radiusPx: 44,
				color: warmLight,
				alpha: 0.7,
				flicker: prop.name === "lamp-post",
			});
		}
		const smokePos = propSmokeWorldPos(prop);
		if (smokePos) {
			// Kept up to date for any *future* full rebuild (a day/night toggle
			// swaps fireflies for motes and needs every chimney again, not just
			// the ones that existed when it fires) — but the chimney itself
			// joins the running effects incrementally, not via a full rebuild:
			// destroying and recreating every existing emitter just to add one
			// cottage's smoke was a real (not hypothetical) source of a >50ms
			// task on every later cluster's first cottage — see this task's own
			// report. this.ambientEffects is still null during entry
			// materialization (setupAmbientEffects hasn't run yet); its own
			// first attachWorldEffects() call picks up chimneyPositions in full.
			this.chimneyPositions.push(smokePos);
			this.ambientEffects?.addChimney(smokePos);
		}
	}

	// The spyglass panel and the orb's world-search results both read this off
	// the store rather than holding their own copy of the manifest — React
	// only ever gets game state through {store, bus}, never a manifest prop.
	private publishGitContext(): void {
		const git = this.git;
		if (!git) {
			this.store.getState().setGit(null);
			return;
		}
		const branch =
			git.universe?.branch ??
			git.meta.branches.find((b) => b.current)?.name ??
			git.meta.head.branch ??
			"HEAD";
		const suffix = git.universe ? `#${git.universe.branch}` : "";
		const source = this.manifest.meta.source;
		this.store.getState().setGit({
			meta: git.meta,
			generatedAt: this.manifest.meta.generatedAt,
			historyBase: git.historyBase,
			branch,
			universe: git.universe,
			worldId: this.worldId,
			rootSource:
				suffix && source.endsWith(suffix)
					? source.slice(0, -suffix.length)
					: source,
		});
	}

	private publishPortalIndex(): void {
		this.store.getState().setActiveWorldBase(this.worldBase);
		this.store.getState().setPortals(
			this.manifest.portals.map((portal) => ({
				id: portal.id,
				clusterId: portal.clusterId,
				name: portal.file.name,
				path: portal.file.path,
				kind: portal.file.kind,
				bytes: portal.file.bytes,
				previewLine:
					previewSourceLines(
						portal.id,
						portal.preview.lines,
						this.save.fileOverrides,
					)[0] ?? "",
				edited: portal.id in this.save.fileOverrides,
				...(this.layerSeam?.isLayerPortal(portal.id)
					? { layer: true as const }
					: {}),
			})),
		);
	}

	// mitt's on/off take no context argument (unlike Phaser's own EventEmitter,
	// used for the SHUTDOWN hook right below) — both listeners are arrow class
	// fields specifically so `this` is already bound and the same function
	// reference can be handed to both on() and off().
	private setupToolBusListeners(): void {
		this.bus.on("tool:opener-use", this.onOpenerUse);
		this.bus.on("tool:walk-to-portal", this.onWalkToPortal);
		this.bus.on("pet:open-file", this.onPetOpenFile);
		this.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.teardownToolBusListeners,
			this,
		);
	}

	private teardownToolBusListeners(): void {
		this.bus.off("tool:opener-use", this.onOpenerUse);
		this.bus.off("tool:walk-to-portal", this.onWalkToPortal);
		this.bus.off("pet:open-file", this.onPetOpenFile);
		this.bus.off("chunk:loaded", this.onPetChunkLoaded);
	}

	private petOpenPending: string | null = null;

	/** The pet chat's "review in spellbook": opens the file straight from here (no walk), once its chunk is in. */
	private onPetOpenFile = ({ portalId }: { portalId: string }): void => {
		if (this.store.getState().mode !== "world") return;
		const portal = this.portalsById.get(portalId);
		if (!portal) return;
		if (this.effectiveChunkContents.has(portal.clusterId)) {
			this.enterPortal(portalId);
			return;
		}
		this.petOpenPending = portalId;
		this.bus.off("chunk:loaded", this.onPetChunkLoaded);
		this.bus.on("chunk:loaded", this.onPetChunkLoaded);
		const cluster = this.clustersById.get(portal.clusterId);
		if (cluster && !this.chunkFetchesInFlight.has(cluster.id))
			this.loadChunk(cluster);
	};

	private onPetChunkLoaded = ({ clusterId }: { clusterId: string }): void => {
		const pending = this.petOpenPending;
		const portal = pending ? this.portalsById.get(pending) : undefined;
		if (!pending || !portal || portal.clusterId !== clusterId) return;
		this.petOpenPending = null;
		this.bus.off("chunk:loaded", this.onPetChunkLoaded);
		if (this.store.getState().mode === "world") this.enterPortal(pending);
	};

	// Rides the same ClickWalker as click-to-move (was a position tween), so
	// it gets the walk bob/facing and WASD cancels it; it only walks there —
	// entering stays the player's call.
	private onWalkToPortal = ({ portalId }: { portalId: string }): void => {
		const target = this.portalWorldPos.get(portalId);
		if (!target) return;
		this.walker.walkTo(target, {
			from: { x: this.player.body.x, y: this.player.body.y },
			speed: SUMMONED_WALK_SPEED,
			showMarker: false,
		});
	};

	/** manifest.paths touching this cluster, sampled near this cluster's own ground so decals/props never land on the dirt track leading out of it — reuses stampPointsAlongSegment purely as a "points along a line" sampler, nothing drawn here. */
	private pathExclusionsForCluster(cluster: Cluster): ScatterExclusion[] {
		const exclusions: ScatterExclusion[] = [];
		const radius = this.groundReach(cluster) + PATH_CORRIDOR_EXCLUSION_RADIUS;
		for (const path of this.ringPaths(cluster.id)) {
			if (path.from !== cluster.id && path.to !== cluster.id) continue;
			const otherId = path.from === cluster.id ? path.to : path.from;
			const other = this.clustersById.get(otherId);
			if (!other) continue;
			// A layer path bends just past its base ring (layerPathRoutes), so
			// its corridor is sampled along the bend; a straight path keeps
			// exactly today's samples, from this cluster outward.
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			const polyline =
				from && to ? this.pathPolyline(path, from, to) : [cluster.pos];
			const samples =
				polyline.length > 2
					? polyline.flatMap((a, i) => {
							const b = polyline[i + 1];
							return b
								? stampPointsAlongSegment(a, b, PATH_CORRIDOR_SAMPLE_SPACING)
								: [];
						})
					: stampPointsAlongSegment(
							cluster.pos,
							other.pos,
							PATH_CORRIDOR_SAMPLE_SPACING,
						);
			for (const point of samples) {
				if (
					Phaser.Math.Distance.Between(
						point.x,
						point.y,
						cluster.pos.x,
						cluster.pos.y,
					) <= radius
				) {
					exclusions.push({
						x: point.x,
						y: point.y,
						radius: PATH_CORRIDOR_EXCLUSION_RADIUS,
					});
				}
			}
		}
		return exclusions;
	}

	private clusterExclusions(
		cluster: Cluster,
		spawn: Position,
	): ScatterExclusion[] {
		const exclusions = this.pathExclusionsForCluster(cluster);
		exclusions.push({
			x: cluster.pos.x,
			y: cluster.pos.y,
			radius: CLUSTER_CENTER_EXCLUSION_RADIUS,
		});
		for (const portalId of cluster.portalIds) {
			const pos = this.portalWorldPos.get(portalId);
			if (pos)
				exclusions.push({
					x: pos.x,
					y: pos.y,
					radius: PORTAL_EXCLUSION_RADIUS,
				});
		}
		if (
			Phaser.Math.Distance.Between(
				spawn.x,
				spawn.y,
				cluster.pos.x,
				cluster.pos.y,
			) <=
			this.groundReach(cluster) + SPAWN_EXCLUSION_RADIUS
		) {
			exclusions.push({
				x: spawn.x,
				y: spawn.y,
				radius: SPAWN_EXCLUSION_RADIUS,
			});
		}
		return exclusions;
	}

	/** Half the viewport diagonal (in world px) plus a fixed walking-speed lookahead — the streamed bakes' "close enough to load" radius. Independent of world size by construction: it only ever grows with viewport, never with cluster count or spread. No scene in this codebase changes `camera.zoom` away from its default of 1, and there is no map-teleport or click-walk camera jump — checked by grep, not assumed — so this deliberately doesn't divide by zoom; add that back only alongside a real zoom-changing feature. */
	private streamLoadRadiusPx(): number {
		const viewportDiagonal = Math.hypot(this.scale.width, this.scale.height);
		return viewportDiagonal / 2 + GROUND_STREAM_LOOKAHEAD_PX;
	}

	private streamEvictRadiusPx(): number {
		return this.streamLoadRadiusPx() + GROUND_STREAM_EVICT_HYSTERESIS_PX;
	}

	/** One cluster's ground RT + its theme-tint ellipse — split out of drawGround so clusterGroundStreamer (below) can call it for whichever cluster it's baking, in whatever order distance/direction picks, same as bakeGroundFieldChunk for field chunks. Never called twice for the same cluster (clusterGroundStreamer's evictRadius is Infinity — see drawGround's doc comment on why clusters don't evict). */
	private bakeOneClusterGround(
		clusterId: string,
		spawn: Position,
	): Phaser.GameObjects.RenderTexture {
		const cluster = this.clustersById.get(clusterId);
		if (!cluster)
			throw new Error(`bakeOneClusterGround: unknown cluster ${clusterId}`);
		const radiusX = this.groundRadius(cluster);
		const radiusY = this.groundRadiusY(cluster);
		const exclusions = this.clusterExclusions(cluster, spawn);
		const rt = bakeClusterGround({
			scene: this,
			clusterId: cluster.id,
			biomeSheetKey:
				this.skin.clearingTiles?.key ?? biomeTileSheetKey(cluster.biome),
			centerX: cluster.pos.x,
			centerY: cluster.pos.y,
			radiusX,
			radiusY,
			exclusions,
			decalCount: DECALS_PER_CLUSTER,
			ringFlowerCount: Math.max(6, Math.round(radiusX / 22)),
			seed: 20260928,
			tint: this.skin.groundTint ?? undefined,
			...(this.skin.decals ? { decalSheetKey: this.skin.decals.key } : {}),
		});
		rt.setDepth(0.5);
		this.groundTintOverlay?.fillStyle(this.theme.tint, GROUND_THEME_TINT_ALPHA);
		this.groundTintOverlay?.fillEllipse(
			cluster.pos.x,
			cluster.pos.y,
			radiusX * 2,
			radiusY * 2,
		);
		// Entry clusters exist before raiseLayer()'s one-time seam.collect()
		// scan runs, so that scan already picks them up; a cluster streamed in
		// afterward (the player walked toward it) needs an explicit riser so
		// it still sinks correctly if the layer is later turned off.
		if (
			this.layerRisersCollected &&
			(this.layerSeam?.layer.clusterIds.has(clusterId) ?? false)
		) {
			this.layerSeam?.addRiser(rt);
		}
		return rt;
	}

	/**
	 * One continuous grass field across the whole world (`groundField.ts`,
	 * chunked), with clusters marked as clearings on top of it — a subtle
	 * biome-tinted patch, a ring of flowers at its edge, and scattered decals
	 * — rather than batch 1's isolated per-cluster ellipses floating over an
	 * empty background. Falls back to the old tinted-ellipse-only fill (no
	 * field at all) when the batch-1/2 art didn't load — never a half-tiled
	 * scene. Props (trees, fences, etc.) are placed here too since they share
	 * the same per-cluster exclusion zones, even though they render as their
	 * own sprites rather than being baked (see propPlacement.ts's doc comment).
	 *
	 * M10 stream-bake: the field and per-cluster ground RTs (this method's
	 * two most expensive parts, per docs/testing/2026-09-29-wide-pass.md Bug
	 * 1) now bake only what's near `spawn` synchronously here; update() (see
	 * streamGroundBakes()) bakes the rest incrementally, budgeted, as the
	 * camera moves. The field streamer evicts chunks that fall out of range
	 * (an open world can have unbounded chunks as the player wanders, so RT
	 * count must stay bounded); the cluster streamer never evicts — a
	 * world's cluster count is fixed and already bounded by its own file
	 * count, so once a cluster's ground is baked it simply stays, exactly
	 * like today's un-streamed behaviour, just spread over more frames to
	 * get there. Props/skin-swap/light registration stay synchronous for
	 * every cluster below (not the measured bottleneck, and
	 * setupAmbientEffects() right after create() needs every light-emitting
	 * prop to exist already) — the two-bake-radii tradeoff this leaves is
	 * documented on this task's own report, not silently dropped.
	 */
	private drawGround(spawn: Position): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(0);
			for (const cluster of this.manifest.clusters) {
				g.fillStyle(PALETTE.biome[cluster.biome], 0.35);
				g.fillEllipse(
					cluster.pos.x,
					cluster.pos.y,
					this.groundRadius(cluster) * 2,
					this.groundRadiusY(cluster) * 2,
				);
			}
			return;
		}

		const fieldSheetKey =
			this.skin.fieldTiles?.key ?? biomeTileSheetKey("meadow");
		const fieldTint = this.skin.groundTint ?? undefined;
		this.groundFieldStreamer = new ChunkStreamer<
			string,
			Phaser.GameObjects.RenderTexture
		>({
			loadRadius: this.streamLoadRadiusPx(),
			evictRadius: this.streamEvictRadiusPx(),
			budgetMs: GROUND_STREAM_BUDGET_MS,
			maxPerFrame: GROUND_STREAM_MAX_CHUNKS_PER_FRAME,
			positionOf: worldChunkPositionOf,
			bake: (key) => {
				const { col, row } = parseWorldChunkKey(key);
				return bakeGroundFieldChunk(
					this,
					col,
					row,
					fieldSheetKey,
					FIELD_SEED,
					fieldTint,
				).setDepth(0);
			},
			evict: (_key, rt) => rt.destroy(),
		});
		this.groundFieldStreamer.loadNowSync(
			worldChunkCandidatesNear(spawn, this.streamLoadRadiusPx()).map(
				(c) => c.key,
			),
		);
		perfMark("cabn:world:ground-field-baked");

		this.groundTintOverlay = this.add.graphics().setDepth(0.6);
		// Props: planned for every cluster up front (planProps is pure position
		// data, no sprites — cheap even for hundreds of clusters), materialized
		// only as each cluster's own ground streams in, in the same bake
		// callback below. Anything that needs a prop's position before its
		// cluster has streamed in (spawnSigns, the shadow-owner e2e) reads
		// plannedProps instead of waiting on a sprite to exist.
		const layerPathSegments = this.layerPathKeepoutSegments();
		for (const cluster of this.manifest.clusters) {
			const exclusions = this.clusterExclusions(cluster, spawn);
			const planned = planProps({
				clusterId: cluster.id,
				centerX: cluster.pos.x,
				centerY: cluster.pos.y,
				radiusX: this.groundRadius(cluster),
				radiusY: this.groundRadiusY(cluster),
				exclusions,
				count: PROPS_PER_CLUSTER,
				minRadiusFrac: PROP_ANNULUS_INNER_FRAC,
			}).filter((p) => !this.isOnLayerPath(p.x, p.y, layerPathSegments));
			this.plannedProps.set(cluster.id, planned);
		}

		this.clusterGroundStreamer = new ChunkStreamer<
			string,
			Phaser.GameObjects.RenderTexture
		>({
			loadRadius: this.streamLoadRadiusPx(),
			evictRadius: Number.POSITIVE_INFINITY,
			budgetMs: CLUSTER_GROUND_STREAM_BUDGET_MS,
			maxPerFrame: CLUSTER_GROUND_STREAM_MAX_PER_FRAME,
			positionOf: (id) => this.clustersById.get(id)?.pos ?? { x: 0, y: 0 },
			bake: (id) => {
				const rt = this.bakeOneClusterGround(id, spawn);
				this.materializeClusterProps(id);
				return rt;
			},
			evict: () => {
				// Never called: evictRadius above is Infinity.
			},
		});
		const clusterLoadRadius = this.streamLoadRadiusPx();
		const entryClusterIds = this.manifest.clusters
			.filter(
				(c) =>
					Math.hypot(c.pos.x - spawn.x, c.pos.y - spawn.y) <= clusterLoadRadius,
			)
			.map((c) => c.id);
		this.clusterGroundStreamer.loadNowSync(entryClusterIds);
	}

	/**
	 * Materializes one cluster's already-planned props (plannedProps) into
	 * real sprites — called from clusterGroundStreamer's bake callback, so it
	 * runs once per cluster whether that happens synchronously at entry or
	 * later as the player walks toward it. Skin swap and ambient registration
	 * (light pool, lantern flicker, chimney smoke) happen here too, right as
	 * each sprite is created, rather than as a separate pass over
	 * this.placedProps afterward — there is no "afterward" that's guaranteed
	 * to see every cluster once materialization itself is spread over frames.
	 */
	private materializeClusterProps(clusterId: string): void {
		const planned = this.plannedProps.get(clusterId) ?? [];
		if (planned.length === 0) return;
		const swaps = this.skin.props;
		const scatterTint = this.skin.scatterTint;
		const isLayerCluster =
			this.layerRisersCollected &&
			(this.layerSeam?.layer.clusterIds.has(clusterId) ?? false);
		for (const plan of planned) {
			const prop = materializeProp(this, plan, 2);
			const swap = swaps?.[prop.name];
			if (swap) prop.sprite.setTexture(swap.key);
			else if (scatterTint !== null) prop.sprite.setTint(scatterTint);
			this.placedProps.push(prop);
			this.registerPropAmbient(prop);
			if (isLayerCluster) this.layerSeam?.addRiser(prop.sprite);
		}
	}

	/** Every point along a layer path's polyline, as segments — pure query, split out of the old clearPropsOffLayerPaths (props are no longer created before this can run, so there's nothing left to destroy; see planProps's filter in drawGround and isOnLayerPath). */
	private layerPathKeepoutSegments(): [Position, Position][] {
		const seam = this.layerSeam;
		if (!seam) return [];
		const segments: [Position, Position][] = [];
		for (const path of this.manifest.paths) {
			if (!seam.isLayerPath(path)) continue;
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) continue;
			const points = this.pathPolyline(path, from, to);
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				if (a && b) segments.push([a, b]);
			}
		}
		return segments;
	}

	/** True if (x, y) falls within LAYER_PATH_PROP_CLEARANCE of any of the given layer-path segments — planProps filters candidate positions against this before a prop is ever materialized (base props were placed without the layer's paths, so they never move across the toggle; the few a layer path would have run over just never get planned there in the first place). */
	private isOnLayerPath(
		x: number,
		y: number,
		segments: readonly [Position, Position][],
	): boolean {
		return segments.some(
			([a, b]) =>
				keepoutDistance(
					x,
					y,
					[],
					[{ ax: a.x, ay: a.y, bx: b.x, by: b.y, halfWidth: 0 }],
				) < LAYER_PATH_PROP_CLEARANCE,
		);
	}

	/**
	 * Base paths stream in chunked, same shape as the ground field (see
	 * drawGround()'s doc comment) — a very spread-out world's path ribbon used
	 * to be one RenderTexture sized to the whole world's bounds, which for
	 * this repo's own 146-cluster world (~61,000 x 67,000px bounds) requests a
	 * multi-gigapixel texture no real GPU allocates, hanging entry outright
	 * rather than merely being slow (the ground-field/cluster-ground fix alone
	 * doesn't help here — this is a second, independent scaling bug, not the
	 * one the original wide-pass report profiled). A layer's own paths stay
	 * whole-bounds and synchronous: they're a narrower, owner-only feature
	 * (see this task's own report for the disclosed gap) and need to be
	 * collected as a single, known riser set for the layer's rise/sink
	 * animation, which streamed-in chunks arriving after raiseLayer() ran
	 * wouldn't be part of without extra bookkeeping this pass doesn't add.
	 */
	private drawPaths(spawn: Position): void {
		if (!this.availability.worldArt) {
			const g = this.add.graphics().setDepth(1);
			g.lineStyle(2, PALETTE.trail, 0.8);
			for (const path of this.manifest.paths) {
				const from = this.clustersById.get(path.from);
				const to = this.clustersById.get(path.to);
				if (!from || !to) continue; // schema guarantees this in a valid manifest; guard keeps a corrupt bundle from crashing the scene
				dashedLine(g, from.pos, to.pos);
			}
			return;
		}

		const segments: PathSegment[] = [];
		const layerSegments: PathSegment[] = [];
		for (const path of this.manifest.paths) {
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) continue;
			const id = `${path.from}::${path.to}`;
			const points = this.pathPolyline(path, from, to);
			const into = this.layerSeam?.isLayerPath(path) ? layerSegments : segments;
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				if (a && b)
					into.push({
						id: points.length > 2 ? `${id}#${i}` : id,
						from: a,
						to: b,
					});
			}
		}
		const tint = this.skin.pathTint ?? undefined;
		const skinPath = this.skin.pathTextures;
		const ribbonKeys = skinPath
			? {
					edge: skinPath.edge.key,
					bed: skinPath.bed.key,
					cobbles: skinPath.cobbles.map((c) => c.key),
					cobbleFraction: skinPath.cobbleFraction,
				}
			: undefined;

		// A layer's paths bake on their own canvas: the base ribbon (its
		// junction plazas included) stays exactly as it is without the layer,
		// and the layer's can rise and sink with it.
		this.layerPathBake = null;
		if (layerSegments.length > 0) {
			const rt = this.availability.atmosphereArt
				? bakePathRibbons(
						this,
						this.computeWorldBounds(),
						layerSegments,
						tint,
						ribbonKeys,
					).rt
				: bakePaths(this, this.computeWorldBounds(), layerSegments, tint);
			rt.setDepth(1);
			this.layerPathBake = rt;
		}

		if (segments.length === 0) return;
		const bakeChunk = this.availability.atmosphereArt
			? ((): ((
					key: string,
					col: number,
					row: number,
				) => Phaser.GameObjects.RenderTexture | null) => {
					const chunkPlan = planPathRibbonChunks(this, segments, ribbonKeys);
					return (key, col, row) => {
						const rt = bakePathRibbonChunk(
							this,
							col,
							row,
							key,
							chunkPlan,
							tint,
						);
						return rt ? rt.setDepth(1) : null;
					};
				})()
			: ((): ((
					key: string,
					col: number,
					row: number,
				) => Phaser.GameObjects.RenderTexture | null) => {
					const { stamps, index } = planPathStamps(this, segments);
					return (key, col, row) => {
						const rt = bakePathChunk(this, col, row, key, stamps, index, tint);
						return rt ? rt.setDepth(1) : null;
					};
				})();
		this.pathStreamer = new ChunkStreamer<
			string,
			Phaser.GameObjects.RenderTexture | null
		>({
			loadRadius: this.streamLoadRadiusPx(),
			evictRadius: this.streamEvictRadiusPx(),
			budgetMs: GROUND_STREAM_BUDGET_MS,
			maxPerFrame: GROUND_STREAM_MAX_CHUNKS_PER_FRAME,
			positionOf: worldChunkPositionOf,
			bake: (key) => {
				const { col, row } = parseWorldChunkKey(key);
				return bakeChunk(key, col, row);
			},
			evict: (_key, rt) => rt?.destroy(),
		});
		this.pathStreamer.loadNowSync(
			worldChunkCandidatesNear(spawn, this.streamLoadRadiusPx()).map(
				(c) => c.key,
			),
		);
	}

	/**
	 * Border forest, meadow detail and points of interest in the space the
	 * clearings and paths leave empty (render/worldDressing.ts). Keepouts are
	 * the clearings themselves (which already contain their portal ring),
	 * the spawn point, and every path corridor.
	 */
	private drawEdgeScenery(spawn: Position): void {
		if (!this.availability.atmosphereArt) return;
		const seam = this.layerSeam;
		const isLayerCluster = (id: string) =>
			seam?.layer.clusterIds.has(id) ?? false;
		const clusterCircle = (cluster: Cluster): CircleKeepout => ({
			x: cluster.pos.x,
			y: cluster.pos.y,
			radius: this.groundReach(cluster) + EDGE_SCENERY_CLEARING_PAD,
		});
		const pathSegments = (path: WorldPath): SegmentKeepout[] => {
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) return [];
			const points = this.pathPolyline(path, from, to);
			const out: SegmentKeepout[] = [];
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				if (!a || !b) continue;
				out.push({
					ax: a.x,
					ay: a.y,
					bx: b.x,
					by: b.y,
					halfWidth: EDGE_SCENERY_PATH_HALF_WIDTH,
				});
			}
			return out;
		};
		// The base world alone decides the scenery (planLayeredEdgeScenery);
		// a layer only takes away what its content stands on and fills the
		// ground it adds.
		const base = this.baseManifest;
		const circles: CircleKeepout[] = base.clusters.map((c) =>
			clusterCircle(this.clustersById.get(c.id) ?? c),
		);
		circles.push({ x: spawn.x, y: spawn.y, radius: SPAWN_EXCLUSION_RADIUS });
		for (const portal of base.portals) {
			const pos = this.portalWorldPos.get(portal.id);
			if (pos)
				circles.push({ x: pos.x, y: pos.y, radius: PORTAL_EXCLUSION_RADIUS });
		}
		const segments = base.paths.flatMap(pathSegments);
		let layer: EdgeSceneryLayer | null = null;
		if (seam) {
			const layerCircles: CircleKeepout[] = [];
			for (const cluster of this.manifest.clusters) {
				if (!isLayerCluster(cluster.id)) continue;
				layerCircles.push(clusterCircle(cluster));
				for (const id of cluster.portalIds) {
					const pos = this.portalWorldPos.get(id);
					if (pos)
						layerCircles.push({
							x: pos.x,
							y: pos.y,
							radius: PORTAL_EXCLUSION_RADIUS,
						});
				}
			}
			layer = {
				bounds: this.computeWorldBounds(),
				circles: layerCircles,
				segments: this.manifest.paths
					.filter((p) => seam.isLayerPath(p))
					.flatMap(pathSegments),
			};
		}
		const swaps = this.skin.scenery;
		const scatterTint = this.skin.scatterTint;
		const textureFor = swaps
			? (kind: string) => swaps[kind as SkinSceneryKind]?.key
			: undefined;
		const tint = scatterTint !== null ? scatterTint : undefined;
		// planEdgeScenery's whole-bounds filler grid is gone from the hot path:
		// planLazyEdgeScenery still plans POIs and the shared keepout indexes
		// whole-world (cheap — see edgeScenery.ts's own doc comment), but
		// leaves filler unplanned until a specific chunk actually streams in.
		const plan = planLazyEdgeScenery({
			scene: this,
			bounds: this.baseWorldBounds(),
			seed: this.scenerySeed,
			circles,
			segments,
			layer,
		});
		perfMark("cabn:world:edge-scenery-planned");
		this.edgeSceneryLoadedItems.clear();
		this.edgeSceneryStreamer = new ChunkStreamer<
			string,
			Phaser.GameObjects.RenderTexture | null
		>({
			loadRadius: this.streamLoadRadiusPx(),
			evictRadius: this.streamEvictRadiusPx(),
			budgetMs: GROUND_STREAM_BUDGET_MS,
			maxPerFrame: GROUND_STREAM_MAX_CHUNKS_PER_FRAME,
			positionOf: worldChunkPositionOf,
			bake: (key) => {
				const { col, row } = parseWorldChunkKey(key);
				const { rt, items } = bakeLazyEdgeSceneryChunk(
					this,
					plan,
					key,
					col,
					row,
					{
						textureFor,
						tint,
					},
				);
				this.edgeSceneryLoadedItems.set(key, items);
				return rt;
			},
			evict: (key, rt) => {
				this.edgeSceneryLoadedItems.delete(key);
				rt?.destroy();
			},
		});
		this.edgeSceneryStreamer.loadNowSync(
			worldChunkCandidatesNear(spawn, this.streamLoadRadiusPx()).map(
				(c) => c.key,
			),
		);
		perfMark("cabn:world:edge-scenery-entry-baked");
		const extras = materializeEdgeSceneryExtras(
			this,
			plan,
			prefersReducedMotion(),
			tint,
			textureFor?.("windmill-sails"),
		);
		const loadedItems = this.edgeSceneryLoadedItems;
		this.edgeDressing = {
			lights: extras.lights,
			pointsOfInterest: plan.pointsOfInterest,
			// Every chunk currently loaded's own items, POIs included — the
			// whole-world item list planEdgeScenery used to return doesn't exist
			// any more (filler is planned lazily, per chunk); see this task's
			// own report and the updated shadow-owner e2e for why the "scenery
			// never moves" check now compares loaded chunks instead.
			get items(): readonly LayeredSceneryItem[] {
				return [...loadedItems.values()].flat();
			},
			destroy: () => {
				this.edgeSceneryStreamer?.destroyAll((_key, rt) => rt?.destroy());
				this.edgeSceneryStreamer = null;
				this.edgeSceneryLoadedItems.clear();
				extras.destroy();
			},
		};
	}

	// Same seed for every cabinet in this world (this.theme, set once in
	// create()) — a world is one converted project, so it gets one theme, not
	// one per cluster.
	private drawClusters(): void {
		for (const cluster of this.manifest.clusters) {
			const isRoot = cluster === this.rootCluster();
			let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

			const brazier = this.skin.brazier;
			if (brazier && (isRoot || this.hasBrazier(cluster))) {
				sprite = this.add
					.sprite(cluster.pos.x, cluster.pos.y, brazier.key, 0)
					.setScale(isRoot ? ROOT_BRAZIER_SCALE : 1)
					.setDepth(2)
					.play(skinAnimKey(brazier));
			} else if (isRoot) {
				sprite = this.drawBonfire(cluster.pos);
			} else if (this.availability.worldArt) {
				// Drawn unscaled (props density). The world's theme colour goes on
				// the gem overlay only (lightened, see FOUNTAIN_GEM_TINT_STRENGTH) —
				// tinting the whole sprite would muddy the stone the arches share.
				const fountain = this.add.sprite(
					cluster.pos.x,
					cluster.pos.y,
					WORLD_FOUNTAIN_KEY,
					0,
				);
				fountain.setDepth(2).play(WORLD_FOUNTAIN_IDLE_ANIM);
				if (this.skin.archTint !== null) fountain.setTint(this.skin.archTint);
				this.add
					.image(cluster.pos.x, cluster.pos.y, WORLD_FOUNTAIN_GEM_KEY)
					.setTint(this.gemTint())
					.setDepth(2.01);
				sprite = fountain;
			} else {
				sprite = this.add.image(
					cluster.pos.x,
					cluster.pos.y,
					ASSET_KEYS.cabinet,
				);
				sprite.setScale(CABINET_SCALE).setTint(this.theme.tint).setDepth(2);
			}

			this.add
				.text(
					cluster.pos.x,
					cluster.pos.y + sprite.displayHeight / 2 + 6,
					cluster.label,
					{
						fontFamily: '"Courier New", monospace',
						fontSize: "14px",
						fontStyle: "bold",
						color: toCssColor(PALETTE.cream),
						stroke: toCssColor(PALETTE.ink),
						strokeThickness: 3,
					},
				)
				.setOrigin(0.5, 0)
				.setDepth(2);
		}
	}

	// World spawn is a bonfire, not a cabin (M4 world-hierarchy redesign — a
	// cabin now represents a whole *world* on the shelf, never a place inside
	// one). Falls back to a tinted, static first frame of the portal arch
	// spritesheet when the real bonfire art hasn't landed yet.
	private drawBonfire(pos: Position): Phaser.GameObjects.Sprite {
		if (this.availability.bonfire) {
			const sprite = this.add.sprite(
				pos.x,
				pos.y,
				OPTIONAL_ASSET_KEYS.bonfireFrame(0),
			);
			sprite.setScale(BONFIRE_SCALE).setDepth(2);
			sprite.play(BONFIRE_IDLE_ANIM);
			return sprite;
		}
		const sprite = this.add.sprite(pos.x, pos.y, ASSET_KEYS.portalArchStrip, 0);
		sprite.setScale(BONFIRE_SCALE).setTint(PALETTE.gold).setDepth(2);
		return sprite;
	}

	/** A layer's own clusters get the skin's brazier in place of a fountain. */
	private hasBrazier(cluster: Cluster): boolean {
		return (
			this.skin.brazier !== null &&
			this.availability.worldArt &&
			(this.layerSeam?.layer.clusterIds.has(cluster.id) ?? false)
		);
	}

	/** The skin's night light pools along every path (lava glow), evenly spaced and capped. */
	private pathGlowLights(): LightPoolOptions[] {
		const glow = this.skin.pathGlow;
		if (!glow) return [];
		const lights: LightPoolOptions[] = [];
		for (const path of this.manifest.paths) {
			const from = this.clustersById.get(path.from);
			const to = this.clustersById.get(path.to);
			if (!from || !to) continue;
			const points = this.pathPolyline(path, from, to);
			// Skip the stretch inside each clearing, where the hub's own light is.
			const fromReach = this.groundReach(from) * 0.6;
			const toReach = this.groundReach(to) * 0.6;
			for (const p of pointsAlongPolyline(points, glow.spacingPx)) {
				if (
					Math.hypot(p.x - from.pos.x, p.y - from.pos.y) < fromReach ||
					Math.hypot(p.x - to.pos.x, p.y - to.pos.y) < toReach
				)
					continue;
				lights.push({
					x: p.x,
					y: p.y,
					radiusPx: glow.radiusPx,
					color: glow.color,
					alpha: glow.alpha,
					flicker: glow.flicker,
					dayStrength: this.skin.dayGlowStrength ?? 0,
				});
				if (lights.length >= glow.maxPools) return lights;
			}
		}
		return lights;
	}

	private gemTint(): number {
		return subtleTint(this.theme.tint, FOUNTAIN_GEM_TINT_STRENGTH);
	}

	/** Fills portalWorldPos without creating any sprites — drawGround()'s scatter exclusions need real portal positions before drawPortals() itself runs (see create()'s ordering comment). */
	private computePortalPositions(): void {
		for (const cluster of this.manifest.clusters) {
			const pathAngles: number[] = [];
			for (const path of this.ringPaths(cluster.id)) {
				if (path.from !== cluster.id && path.to !== cluster.id) continue;
				const other = this.clustersById.get(
					path.from === cluster.id ? path.to : path.from,
				);
				if (other)
					pathAngles.push(
						Math.atan2(
							other.pos.y - cluster.pos.y,
							other.pos.x - cluster.pos.x,
						),
					);
			}
			const ring = layoutPortalRing(
				cluster.portalIds.length,
				pathAngles,
				PORTAL_RING_SIZES,
			);
			this.portalRingRadii.set(cluster.id, ring.radius);
			this.clearingRadiiY.set(
				cluster.id,
				clearingRadiusYForRing(
					ring.radius,
					ring.angles,
					ring.radius + CLEARING_OUTER_MARGIN,
				),
			);
			cluster.portalIds.forEach((portalId, index) => {
				const angle = ring.angles[index] ?? 0;
				this.portalWorldPos.set(portalId, {
					x: cluster.pos.x + Math.cos(angle) * ring.radius,
					y: cluster.pos.y + Math.sin(angle) * ring.radius,
				});
			});
		}
	}

	/** Ground radius scales with the portal ring it has to contain, so busier clusters get a clearing that actually fits their arches instead of just reading as "bigger" arbitrarily. Valid once computePortalPositions() has run. */
	private groundRadius(cluster: Cluster): number {
		return (
			(this.portalRingRadii.get(cluster.id) ?? PORTAL_RING_SIZES.minRadiusPx) +
			CLEARING_OUTER_MARGIN
		);
	}

	/** Half-height of the clearing's ground ellipse: the old 0.65 of groundRadius() unless the portal ring needs more (@cabn/converter's clearingFit.ts). */
	private groundRadiusY(cluster: Cluster): number {
		return (
			this.clearingRadiiY.get(cluster.id) ??
			this.groundRadius(cluster) * GROUND_RADIUS_Y_RATIO
		);
	}

	/** Circle around the hub that contains the whole clearing, for circular keepouts. */
	private groundReach(cluster: Cluster): number {
		return Math.max(this.groundRadius(cluster), this.groundRadiusY(cluster));
	}

	private drawPortals(): void {
		this.archPreviews = new ArchPreviews(
			this,
			ARCH_OPENING,
			ARCH_PREVIEW_DEPTH,
			this.worldBase,
		);
		this.portalFx = new PortalFx(
			this,
			ARCH_OPENING,
			ARCH_FX_DEPTH,
			prefersReducedMotion(),
		);
		this.cameras.main.on(
			Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE,
			this.projectWebPortal,
		);
		for (const cluster of this.manifest.clusters) {
			cluster.portalIds.forEach((portalId) => {
				const pos = this.portalWorldPos.get(portalId);
				if (!pos) return; // computePortalPositions() populates every id from this same manifest — defensive only

				const arch = this.skin.arch;
				const sprite = this.add.sprite(
					pos.x,
					pos.y,
					arch?.strip.key ?? ASSET_KEYS.portalArchStrip,
				);
				sprite.setScale(WORLD_PORTAL_SCALE).setDepth(3);
				if (arch) {
					sprite.play(skinAnimKey(arch.strip));
					this.add
						.sprite(pos.x, pos.y, arch.overlay.key, 0)
						.setScale(WORLD_PORTAL_SCALE)
						.setDepth(ARCH_SKIN_OVERLAY_DEPTH)
						.play(skinAnimKey(arch.overlay));
				} else {
					if (this.skin.archTint !== null) sprite.setTint(this.skin.archTint);
					sprite.play(PORTAL_IDLE_ANIM);
				}
				this.portalSprites.set(portalId, sprite);
				const portal = this.portalsById.get(portalId);
				if (portal) {
					const preview = this.previewFor(portal);
					this.archPreviews?.add({ id: portalId, pos, preview });
					this.setArchVariant(portalId, portal, preview);
				}
			});
		}
	}

	/** Portal-type trim (render order: base arch 3 < overlay < preview 3.05) — the overlay never touches the opening, so previews, click targets and orbits see the same arch either way. */
	private setArchVariant(
		portalId: string,
		portal: Portal,
		preview: DisplayPreview,
	): void {
		if (!this.availability.portalVariants) return;
		const variant = archVariantFor(portal.file, preview.kind);
		this.portalVariants.set(portalId, variant);
		const frame = archVariantFrame(variant);
		const existing = this.portalVariantOverlays.get(portalId);
		if (frame === null) {
			existing?.destroy();
			this.portalVariantOverlays.delete(portalId);
			return;
		}
		if (existing) {
			existing.setFrame(frame);
			return;
		}
		const pos = this.portalWorldPos.get(portalId);
		if (!pos) return;
		const overlay = this.add
			.image(pos.x, pos.y, PORTAL_VARIANT_SHEET_KEY, frame)
			.setScale(WORLD_PORTAL_SCALE)
			.setDepth(ARCH_VARIANT_DEPTH);
		if (this.skin.archTint !== null) overlay.setTint(this.skin.archTint);
		this.portalVariantOverlays.set(portalId, overlay);
	}

	private previewFor(portal: Portal): DisplayPreview {
		return effectiveRichPreview(
			portal,
			this.save.fileOverrides[portal.id]?.content,
			this.media.get(portal.id),
			this.embeds.get(portal.id),
		);
	}

	/** Repaints an arch (and the dock, if it's the focused one) after its save state changed. */
	private refreshPortalPreview(portalId: string): void {
		const portal = this.portalsById.get(portalId);
		if (!portal) return;
		const preview = this.previewFor(portal);
		this.archPreviews?.setPreview(portalId, preview);
		this.setArchVariant(portalId, portal, preview);
		if (this.focusedPortalId === portalId) {
			this.focusedPortalId = null;
			this.setFocusedPortal(portalId);
		}
		if (this.nearWebPortalId === portalId) this.setNearWebPortal(null);
	}

	private setFocusedPortal(portalId: string | null): void {
		if (portalId === this.focusedPortalId) return;
		this.focusedPortalId = portalId;
		const portal = portalId ? this.portalsById.get(portalId) : undefined;
		this.store.getState().setFocusedPortalPreview(
			portal
				? {
						portalId: portal.id,
						fileName: portal.file.name,
						path: portal.file.path,
						preview: this.previewFor(portal),
						allowedEmbedOrigins: this.manifest.allowedEmbedOrigins,
					}
				: null,
		);
	}

	private drawEditedMarkers(): void {
		for (const portalId of Object.keys(this.save.fileOverrides)) {
			this.drawEditedMarker(portalId);
		}
	}

	// A drawn glyph rather than new art (no quill/sparkle sprite exists yet,
	// same placeholder-first approach as the tool icons) — a small pencil
	// character at the arch's upper-right reads fine at this scale.
	private drawEditedMarker(portalId: string): void {
		if (this.editedMarkers.has(portalId)) return;
		const pos = this.portalWorldPos.get(portalId);
		if (!pos) return;
		// Up on the capstone's right shoulder — the old 0.22 offset now lands
		// inside the (much larger) preview-filled opening.
		const offset = PORTAL_ARCH_DISPLAY_SIZE * 0.3;
		const marker = this.add
			.text(pos.x + offset, pos.y - offset, "✎", {
				fontFamily: '"Courier New", monospace',
				fontSize: "16px",
				color: toCssColor(PALETTE.gold),
			})
			.setOrigin(0.5)
			.setDepth(5);
		this.editedMarkers.set(portalId, marker);
	}

	private removeEditedMarker(portalId: string): void {
		this.editedMarkers.get(portalId)?.destroy();
		this.editedMarkers.delete(portalId);
	}

	// A portal monster swirls around its arch on a flattened ellipse
	// (render/monsterOrbit.ts), siblings evenly spaced in phase; a
	// cross-cluster ouroboros loops a figure-eight across the midpoint of the
	// WorldPath it's attached to — see run.ts's attachCycle for how that
	// pathId (`${from}::${to}`, parsed back out below) gets assigned. Neither
	// kind is walk-into-and-E encounterable or clickable here: the arch's own
	// hit target (clickInteractables) is the way in, so a moving sprite never
	// has to be chased with the pointer, and FileScene's portal-attached
	// monsters are the encounter (see its onMonsterEncounterKey doc comment
	// for why a world-space path monster doesn't fit that flow).
	private drawMonsters(): void {
		for (const monster of this.manifest.monsters) {
			if (this.isDefeated(monster.id)) continue;
			if (monster.portalId) this.drawPortalMonster(monster);
			else if (monster.pathId) this.drawPathMonster(monster);
		}
	}

	private addMonsterSprite(
		monster: Monster,
		x: number,
		y: number,
		fallbackPx: number,
	) {
		const drawn = renderedMonsterSpecies(this, monster.species);
		const sprite = createMonsterSprite(
			this,
			x,
			y,
			monster.species,
			worldMonsterPx(drawn, fallbackPx),
		);
		sprite.setDepth(MONSTER_DEPTH);
		this.monsterSprites.set(monster.id, sprite);
		return { sprite, drawn };
	}

	/** A url arch's siblings share one orbit sized for the largest of them — defeated ones included, so a revive never reshapes the loop. */
	private portalOrbitShape(portalId: string, pos: Position): PortalOrbitShape {
		const portal = this.portalsById.get(portalId);
		if (!portal || this.previewFor(portal).kind !== "url")
			return { kind: "arch" };
		let clearancePx = 0;
		for (const m of this.manifest.monsters) {
			if (m.portalId !== portalId) continue;
			const drawn = renderedMonsterSpecies(this, m.species);
			clearancePx = Math.max(
				clearancePx,
				monsterClearancePx(drawn, worldMonsterPx(drawn, 32)),
			);
		}
		return {
			kind: "web",
			opening: openingRect(pos, ARCH_OPENING),
			clearancePx,
		};
	}

	private drawPortalMonster(monster: Monster): void {
		const portalId = monster.portalId;
		if (!portalId) return;
		const pos = this.portalWorldPos.get(portalId);
		if (!pos) return;
		const ellipse = portalOrbitEllipseFor(
			pos,
			PORTAL_ARCH_DISPLAY_SIZE,
			this.portalOrbitShape(portalId, pos),
		);
		const { sprite, drawn } = this.addMonsterSprite(
			monster,
			ellipse.cx + ellipse.rx,
			ellipse.cy,
			32,
		);
		this.monsterOrbits?.add(monster.id, sprite, drawn, {
			kind: "portal",
			portalId,
			ellipse,
		});
	}

	private drawPathMonster(monster: Monster): void {
		const pathId = monster.pathId;
		if (!pathId) return;
		const [fromId, toId] = pathId.split("::");
		const from = fromId ? this.clustersById.get(fromId) : undefined;
		const to = toId ? this.clustersById.get(toId) : undefined;
		if (!from || !to) return;

		// On the path as drawn: a layer path's bend, not the straight chord.
		const path = this.manifest.paths.find(
			(p) => p.from === from.id && p.to === to.id,
		);
		const { center, angle } = polylineMidpoint(
			path ? this.pathPolyline(path, from, to) : [from.pos, to.pos],
		);
		const { sprite, drawn } = this.addMonsterSprite(
			monster,
			center.x,
			center.y,
			48,
		);
		this.monsterOrbits?.add(monster.id, sprite, drawn, {
			kind: "path",
			center,
			pathAngle: angle,
			halfLength: PATH_MONSTER_LOOP_PX,
		});
	}

	private removeMonsterSprite(monsterId: string): void {
		this.monsterOrbits?.remove(monsterId);
		this.monsterSprites.get(monsterId)?.destroy();
		this.monsterSprites.delete(monsterId);
	}

	// The HUD counter and FileScene's encounter banner both read monsters off
	// the store rather than holding their own copy of the manifest, same
	// reasoning as publishPortalIndex above.
	private publishMonsterIndex(): void {
		this.store.getState().setMonsters(
			this.manifest.monsters.map((m) => ({
				id: m.id,
				species: m.species,
				message: m.error.message,
				tier: m.tier,
				...(m.portalId !== undefined ? { portalId: m.portalId } : {}),
				...(m.pathId !== undefined ? { pathId: m.pathId } : {}),
			})),
		);
		this.store
			.getState()
			.setDefeatedMonsterIds([
				...this.save.defeatedMonsterIds,
				...(this.layerSeam?.defeatedMonsters() ?? []),
			]);
	}

	/**
	 * Pure computation of where the player starts — split out of
	 * createPlayer() so drawGround()'s scatter exclusions can use the same
	 * spawn point before any sprite exists (see create()'s ordering comment).
	 * A first-ever visit (no saved position) used to spawn exactly on the
	 * root cluster's own position — the bonfire's position too, since
	 * drawBonfire() draws it there — which is the M10b batch-2 review's
	 * "player spawns on top of the bonfire". Offset east of it instead, by
	 * its actual display size (computed from the same scale constants
	 * drawBonfire() uses, not read off a live sprite — the bonfire hasn't
	 * been drawn yet at this point in create()'s ordering).
	 */
	private resolveSpawnPos(): Position {
		return (
			this.initData.spawnAt ??
			(this.layerSeam
				? this.layerSeam.savedPosition()
				: this.save.playerPositions.world) ??
			this.defaultSpawnPos()
		);
	}

	/** Where a fresh save starts — also kept clear of the guide NPC, whatever the current save says. */
	private defaultSpawnPos(): Position {
		const root =
			this.manifest.clusters.find((c) => c.path === ".") ??
			this.manifest.clusters[0];
		if (!root) return { x: 0, y: 0 };
		const bonfireWidth = this.availability.bonfire
			? BONFIRE_RAW_SIZE_PX * BONFIRE_SCALE
			: PORTAL_ARCH_FRAME_SIZE * BONFIRE_SCALE;
		return {
			x: root.pos.x + bonfireWidth / 2 + BONFIRE_SPAWN_CLEARANCE,
			y: root.pos.y,
		};
	}

	private createPlayer(spawn: Position): void {
		this.playerTextures = {
			front: ASSET_KEYS.characterIdle,
			back: this.availability.characterBack
				? OPTIONAL_ASSET_KEYS.characterIdleBack
				: null,
		};
		this.player = createPlayer(this, spawn, this.playerTextures);
		this.store.getState().setPlayerPos(spawn);
	}

	private setupInput(): void {
		const kb = this.input.keyboard;
		if (!kb) throw new Error("WorldScene requires keyboard input");
		this.movementKeys = createMovementKeys(this);
		this.keys = {
			enter: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
			esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
		};
		this.walker = new ClickWalker(this, prefersReducedMotion());
		this.pointerInput = attachPointerInput(this, {
			interactables: () => this.clickInteractables(),
			enabled: () =>
				this.store.getState().mode === "world" && !this.returningToShelf,
			onClick: this.onClick,
		});
	}

	private rootCluster(): Cluster | undefined {
		return (
			this.manifest.clusters.find((c) => c.path === ".") ??
			this.manifest.clusters[0]
		);
	}

	private bonfireDisplayWidth(): number {
		return this.availability.bonfire
			? BONFIRE_RAW_SIZE_PX * BONFIRE_SCALE
			: PORTAL_ARCH_FRAME_SIZE * BONFIRE_SCALE;
	}

	/** Hit areas derive from the same size constants the arches/bonfire are drawn with, not from the sprites, so they follow any change to how a portal is drawn. Monsters and cabinets aren't interactable in the world (see drawMonsters) — clicking one just walks there, and clicking an orbiting monster over its arch hits the arch. */
	private clickInteractables(): Interactable[] {
		const targets: Interactable[] = [];
		for (const [portalId, pos] of this.portalWorldPos) {
			targets.push({
				id: portalId,
				kind: "portal",
				pos,
				hitRadius: PORTAL_ARCH_DISPLAY_SIZE / 2,
				arriveRadius: PORTAL_ENTER_RADIUS * PORTAL_ARRIVE_RATIO,
			});
		}
		const root = this.rootCluster();
		if (root && this.returnTo) {
			const half = this.bonfireDisplayWidth() / 2;
			targets.push({
				id: root.id,
				kind: "bonfire",
				pos: root.pos,
				hitRadius: half,
				arriveRadius: Math.min(
					half + BONFIRE_SPAWN_CLEARANCE,
					BONFIRE_INTERACT_RADIUS,
				),
			});
		}
		if (this.guideNpc) targets.push(this.guideNpc.interactable());
		if (this.rift) targets.push(this.rift.interactable());
		if (this.signs) targets.push(...this.signs.interactables());
		const pet = this.pet?.interactable();
		if (pet) targets.push(pet);
		return targets;
	}

	private onClick = (target: ClickTarget): void => {
		this.pendingArrival = null;
		if (this.signs?.isPlacing()) {
			this.walker.cancel();
			this.signs.placeAtPointer();
			return;
		}
		if (this.signs?.isReading()) return;
		if (this.tryOpenUrlArch(target)) {
			this.walker.cancel();
			return;
		}
		const from = { x: this.player.body.x, y: this.player.body.y };
		if (target.kind === "ground") {
			this.walker.walkTo(
				clampToBounds(target.point, physicsBounds(this), BOUNDS_INSET_PX),
				{ from, speed: DEFAULT_PLAYER_SPEED },
			);
			return;
		}
		this.walker.walkTo(target.target.pos, {
			from,
			speed: DEFAULT_PLAYER_SPEED,
			target: target.target,
		});
	};

	/** One shared bounds calc for the camera, the ground field bake, and the path bake — the three used to each compute a slightly different box, which is exactly how a field baked for one area and a camera clamped to another used to leave a sliver of void at the edge. See render/worldBounds.ts for why half the viewport, no more, is both correct and what keeps the bake itself small. */
	private computeWorldBounds(): WorldBounds {
		return sharedComputeWorldBounds(
			this.manifest.clusters.map((c) => c.pos),
			{ width: this.scale.width, height: this.scale.height },
		);
	}

	/** The same box for the base world alone: what edge scenery and the skyline are laid out from, so a layer never moves them. */
	private baseWorldBounds(): WorldBounds {
		return sharedComputeWorldBounds(
			this.baseManifest.clusters.map((c) => c.pos),
			{ width: this.scale.width, height: this.scale.height },
		);
	}

	private setupCamera(): void {
		const { minX, minY, maxX, maxY } = this.computeWorldBounds();

		if (this.availability.atmosphereArt) {
			const { camera, physics } = boundsWithSky({ minX, minY, maxX, maxY });
			this.physics.world.setBounds(
				physics.minX,
				physics.minY,
				physics.maxX - physics.minX,
				physics.maxY - physics.minY,
			);
			this.cameras.main.setBounds(
				camera.minX,
				camera.minY,
				camera.maxX - camera.minX,
				camera.maxY - camera.minY,
			);
		} else {
			this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);
			this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
		}
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.1);
	}

	update(time: number, delta: number): void {
		if (this.store.getState().mapOpen) {
			this.walker.cancel();
			this.pendingArrival = null;
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			return;
		}
		// Covers "file" and the new "editor" mode alike — both mean FileScene (or
		// its overlay) owns input right now, not just the one this scene used to
		// know about (in practice this scene is asleep whenever either is true,
		// via scene.switch, so this is defense-in-depth, not the load-bearing gate).
		if (this.store.getState().mode !== "world") {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			return;
		}
		// The dialogue box swallows its keys before Phaser sees them; this also
		// holds still a movement key that was already down when it opened.
		if (
			this.guideNpc?.isTalking() ||
			this.rift?.isOpen() ||
			this.signs?.isReading() ||
			this.pet?.isTalking()
		) {
			this.walker.cancel();
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
		} else {
			this.handleMovement(delta);
		}
		this.handleChunkLoading();
		this.streamWorldBakes();
		this.handlePortalApproach();
		const view = this.cameras.main.worldView;
		this.archPreviews?.update(
			time,
			{ x: this.player.body.x, y: this.player.body.y },
			{ x: view.x, y: view.y, w: view.width, h: view.height },
		);
		if (this.archPreviews) this.portalFx?.update(time, this.archPreviews);
		this.monsterOrbits?.update(time, delta, view);
		this.handleArrival(delta);
		this.handlePortalEnter();
		this.handleReturnToShelf();
		this.pointerInput.refreshHover();
	}

	private handleMovement(delta: number): void {
		const { pos, arrivedAt } = drivePlayer(
			this.player,
			this.movementKeys,
			this.walker,
			delta,
			this.playerTextures,
		);
		if (arrivedAt) this.pendingArrival = { target: arrivedAt, waitedMs: 0 };
		else if (this.walker.walking) this.pendingArrival = null;
		this.store.getState().setPlayerPos(pos);
	}

	/** Interacts with whatever a click-walk just arrived at — the same outcome Enter would have there. A portal whose chunk is still loading waits a moment rather than opening as "no preview". */
	private handleArrival(delta: number): void {
		const pending = this.pendingArrival;
		if (!pending) return;
		const { target } = pending;
		// Walked off (WASD) while waiting on a chunk — the arrival no longer counts.
		if (
			Phaser.Math.Distance.Between(
				this.player.body.x,
				this.player.body.y,
				target.pos.x,
				target.pos.y,
			) >
			target.arriveRadius + 2
		) {
			this.pendingArrival = null;
			return;
		}
		if (target.kind === "bonfire") {
			this.pendingArrival = null;
			this.returnToShelf();
			return;
		}
		if (target.kind === "npc") {
			this.pendingArrival = null;
			if (target.id === "pet") this.pet?.talk();
			else this.guideNpc?.talk();
			return;
		}
		if (target.kind === "sign") {
			this.pendingArrival = null;
			this.signs?.open(target.id);
			return;
		}
		if (target.kind === "rift") {
			this.pendingArrival = null;
			this.rift?.open();
			return;
		}
		if (target.kind !== "portal") {
			this.pendingArrival = null;
			return;
		}
		const portal = this.portalsById.get(target.id);
		if (
			portal &&
			!this.effectiveChunkContents.has(portal.clusterId) &&
			this.chunkFetchesInFlight.has(portal.clusterId) &&
			pending.waitedMs < ARRIVAL_CHUNK_WAIT_MS
		) {
			pending.waitedMs += delta;
			return;
		}
		this.pendingArrival = null;
		this.enterPortal(target.id);
	}

	private nearestClusterInRange(): Cluster | null {
		const pos = { x: this.player.body.x, y: this.player.body.y };
		let best: { cluster: Cluster; dist: number } | null = null;
		for (const cluster of this.manifest.clusters) {
			const dist = Phaser.Math.Distance.Between(
				pos.x,
				pos.y,
				cluster.pos.x,
				cluster.pos.y,
			);
			if (dist <= CLUSTER_LOAD_RADIUS && (!best || dist < best.dist)) {
				best = { cluster, dist };
			}
		}
		return best?.cluster ?? null;
	}

	private handleChunkLoading(): void {
		const cluster = this.nearestClusterInRange();
		const state = this.store.getState();

		if (cluster && cluster.id !== state.activeClusterId) {
			state.setActiveCluster(cluster.id);
			this.bus.emit("cluster:enter", { clusterId: cluster.id });
		} else if (!cluster && state.activeClusterId !== null) {
			state.setActiveCluster(null);
		}

		if (
			cluster &&
			!this.chunkContents.has(cluster.id) &&
			!this.chunkFetchesInFlight.has(cluster.id)
		) {
			this.loadChunk(cluster);
		}
	}

	/** One frame's worth of streaming for every chunked/per-cluster bake (see drawGround()'s doc comment) — bounded work regardless of world size, since worldChunkCandidatesNear's own scan window is capped by loadRadius, and the cluster candidate list is capped by the world's own (already-bounded) cluster count. */
	private streamWorldBakes(): void {
		if (
			!this.groundFieldStreamer &&
			!this.clusterGroundStreamer &&
			!this.edgeSceneryStreamer &&
			!this.pathStreamer
		)
			return;
		const view = this.cameras.main.worldView;
		const camera = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
		const body = this.player.body.body as Phaser.Physics.Arcade.Body;
		const velocity = { x: body.velocity.x, y: body.velocity.y };
		const chunkCandidates = worldChunkCandidatesNear(
			camera,
			this.streamLoadRadiusPx(),
		);
		this.groundFieldStreamer?.step(chunkCandidates, camera, velocity);
		this.edgeSceneryStreamer?.step(chunkCandidates, camera, velocity);
		this.pathStreamer?.step(chunkCandidates, camera, velocity);
		this.clusterGroundStreamer?.step(
			this.manifest.clusters.map((c) => ({
				key: c.id,
				x: c.pos.x,
				y: c.pos.y,
			})),
			camera,
			velocity,
		);
	}

	private loadChunk(cluster: Cluster): void {
		this.chunkFetchesInFlight.add(cluster.id);
		this.fetchChunkFiles(cluster)
			.then((files) => {
				this.chunkContents.set(cluster.id, files);
				this.refreshEffectiveChunk(cluster.id);

				const { order, evicted } = touchChunk(
					this.chunkLoadOrder,
					cluster.id,
					MAX_LOADED_CHUNKS,
				);
				this.chunkLoadOrder = order;
				for (const evictedId of evicted) {
					this.chunkContents.delete(evictedId);
					this.effectiveChunkContents.delete(evictedId);
				}
				this.store.getState().setLoadedChunks(order);
				this.bus.emit("chunk:loaded", { clusterId: cluster.id });
			})
			.catch((err) => {
				console.error(
					`cabn: failed to load chunk for cluster "${cluster.id}"`,
					err,
				);
			})
			.finally(() => {
				this.chunkFetchesInFlight.delete(cluster.id);
			});
	}

	/** Recomputes `effectiveChunkContents` for one cluster from its pristine chunk plus the current save's overrides — called after a (re)load and whenever an override is saved/reset. No-op if the chunk isn't loaded yet (the next loadChunk() will pick up the then-current save). */
	private refreshEffectiveChunk(clusterId: string): void {
		const files = this.chunkContents.get(clusterId);
		if (!files) return;
		this.effectiveChunkContents.set(
			clusterId,
			applyOverridesToChunk(
				files,
				this.portalPathById,
				this.save.fileOverrides,
			),
		);
	}

	private handlePortalApproach(): void {
		const points: PortalPoint[] = [...this.portalWorldPos.entries()].map(
			([portalId, pos]) => ({ portalId, pos }),
		);
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		const { inRange, entered } = newlyApproached(
			points,
			playerPos,
			PORTAL_APPROACH_RADIUS,
			this.portalsInRange,
		);
		this.portalsInRange = inRange;

		for (const portalId of entered) {
			this.bus.emit("portal:approach", { portalId });
		}

		// Closest in-range portal within focus radius gets the expanded dock.
		let closestId: string | null = null;
		let closestDist = PORTAL_FOCUS_RADIUS;
		for (const portalId of inRange) {
			const pos = this.portalWorldPos.get(portalId);
			if (!pos) continue;
			const dist = Phaser.Math.Distance.Between(
				playerPos.x,
				playerPos.y,
				pos.x,
				pos.y,
			);
			if (dist <= closestDist) {
				closestDist = dist;
				closestId = portalId;
			}
		}
		this.setFocusedPortal(closestId);

		const webCandidates = [];
		for (const portalId of inRange) {
			const pos = this.portalWorldPos.get(portalId);
			const portal = this.portalsById.get(portalId);
			const preview = portal ? this.previewFor(portal) : undefined;
			if (pos && preview?.kind === "url" && !preview.embedBlocked)
				webCandidates.push({ id: portalId, pos });
		}
		this.setNearWebPortal(
			pickNearWebPortal(webCandidates, playerPos, PORTAL_APPROACH_RADIUS),
		);
	}

	private setNearWebPortal(portalId: string | null): void {
		if (portalId === this.nearWebPortalId) return;
		this.nearWebPortalId = portalId;
		const portal = portalId ? this.portalsById.get(portalId) : undefined;
		const preview = portal ? this.previewFor(portal) : undefined;
		this.store.getState().setNearWebPortal(
			portal && preview?.kind === "url"
				? {
						portalId: portal.id,
						url: preview.url,
						...(preview.title !== undefined ? { title: preview.title } : {}),
						...(preview.fallbackImage !== undefined
							? { fallbackImage: preview.fallbackImage }
							: {}),
						allowedEmbedOrigins: this.manifest.allowedEmbedOrigins,
					}
				: null,
		);
	}

	/** Runs on the camera's FOLLOW_UPDATE, i.e. after this frame's follow lerp, so the DOM mini-page lands exactly where the canvas is about to draw the arch. */
	private projectWebPortal = (): void => {
		const id = this.nearWebPortalId;
		const pos = id ? this.portalWorldPos.get(id) : undefined;
		if (!id || !pos) return;
		const camera = this.cameras.main;
		const canvas = this.game.canvas;
		const world = openingRect(pos, ARCH_OPENING);
		const project = (r: Rect) =>
			projectWorldRect(
				r,
				{
					view: {
						x: camera.worldView.x,
						y: camera.worldView.y,
						w: camera.worldView.width,
						h: camera.worldView.height,
					},
					zoom: camera.zoom,
					offsetX: camera.x,
					offsetY: camera.y,
				},
				{
					left: canvas.offsetLeft,
					top: canvas.offsetTop,
					scaleX: canvas.clientWidth / this.scale.width || 1,
					scaleY: canvas.clientHeight / this.scale.height || 1,
				},
			);
		const rect = project(world);
		const half = PORTAL_ARCH_DISPLAY_SIZE / 2;
		const keepout = project(
			unionRect(
				{ x: pos.x - half, y: pos.y - half, w: half * 2, h: half * 2 },
				this.monsterOrbits?.portalReach(id) ?? null,
			),
		);
		const b = this.player.body.getBounds();
		const occluded = rectsOverlap(
			world,
			playerOccluderRect({ x: b.x, y: b.y, w: b.width, h: b.height }),
		);
		// Emitted every frame, not only on change: the React side mounts a
		// frame or two after nearWebPortal is set and would otherwise never
		// hear the rect of a camera that has already stopped moving. It skips
		// identical rects itself.
		this.bus.emit("portal:web-rect", {
			portalId: id,
			rect,
			occluded,
			keepout,
		});
	};

	/** A click on a url arch's opening while standing near it opens the page instead of walking (systems/portalFx.ts#urlArchClickAction). The live mini-page normally covers the opening and catches that click in the DOM; this is the path for when it doesn't (dimmed under the player, or still loading). */
	private tryOpenUrlArch(target: ClickTarget): boolean {
		if (target.kind !== "interactable" || target.target.kind !== "portal")
			return false;
		const portal = this.portalsById.get(target.target.id);
		const preview = portal ? this.previewFor(portal) : undefined;
		if (preview?.kind !== "url") return false;
		const pointer = this.input.activePointer;
		const click = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
		const origins = this.manifest.allowedEmbedOrigins;
		const action = urlArchClickAction(
			{ x: click.x, y: click.y },
			{ x: this.player.body.x, y: this.player.body.y },
			target.target.pos,
			openingRect(target.target.pos, ARCH_OPENING),
			PORTAL_APPROACH_RADIUS,
			canOpenPortalLink(preview.url, origins),
		);
		if (action !== "open-link") return false;
		return openPortalLink(preview.url, origins);
	}

	private handlePortalEnter(): void {
		if (!Phaser.Input.Keyboard.JustDown(this.keys.enter)) return;
		// A focused button (e.g. tabbed-to) gets this Enter natively too.
		if (activeFocusOwner() === "control") return;
		if (this.pet?.isTalking()) return;
		this.interact();
	}

	// mitt still delivers this while the scene sleeps underneath FileScene —
	// without the mode check, the hotbar's opener clicked inside a file
	// re-entered the portal the player had walked in through.
	private onOpenerUse = (): void => {
		if (this.store.getState().mode !== "world") return;
		this.interact();
	};

	/** The world's one interaction, shared by Enter and the hotbar opener (see systems/tools.ts): a sign in reach (if closer than any portal and not where the guide or bonfire keeps Enter), else the nearest portal in reach, else the guide NPC, else the bonfire, else the pet (which trails close by, so it only answers when nothing else is in reach). */
	private interact(): void {
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		// A sign stands beside its arch, so both can be in reach: the closer wins.
		const sign = this.signs?.inReach(playerPos);
		if (
			sign &&
			sign.dist < this.nearestPortalDistance(playerPos) &&
			!this.signEnterTakers().some(
				(t) =>
					Phaser.Math.Distance.Between(playerPos.x, playerPos.y, t.x, t.y) <=
					t.radius,
			)
		) {
			this.walker.cancel();
			this.signs?.open(sign.path);
			return;
		}
		if (this.enterNearestPortalInRange()) return;
		if (this.guideNpc?.inReach(playerPos)) {
			this.walker.cancel();
			this.guideNpc.talk();
			return;
		}
		if (this.rift?.inReach(playerPos)) {
			this.walker.cancel();
			this.rift.open();
			return;
		}
		const root = this.rootCluster();
		if (
			root &&
			this.returnTo &&
			Phaser.Math.Distance.Between(
				playerPos.x,
				playerPos.y,
				root.pos.x,
				root.pos.y,
			) <= BONFIRE_INTERACT_RADIUS
		) {
			this.returnToShelf();
			return;
		}
		if (this.pet?.inReach(playerPos)) {
			this.walker.cancel();
			this.pet.talk();
		}
	}

	private nearestPortalDistance(playerPos: Position): number {
		let best = Number.POSITIVE_INFINITY;
		for (const portalId of this.portalsInRange) {
			const pos = this.portalWorldPos.get(portalId);
			if (pos)
				best = Math.min(
					best,
					Phaser.Math.Distance.Between(playerPos.x, playerPos.y, pos.x, pos.y),
				);
		}
		return best;
	}

	private enterNearestPortalInRange(): boolean {
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		for (const portalId of this.portalsInRange) {
			const pos = this.portalWorldPos.get(portalId);
			if (!pos) continue;
			if (
				Phaser.Math.Distance.Between(playerPos.x, playerPos.y, pos.x, pos.y) <=
				PORTAL_ENTER_RADIUS
			) {
				this.enterPortal(portalId);
				return true;
			}
		}
		return false;
	}

	private enterPortal(target: string): void {
		const portal = this.portalsById.get(target);
		if (!portal) return;
		this.walker.cancel();
		// effectiveChunkContents (pristine + any saved override), not
		// chunkContents directly — a portal with a quill edit always opens to
		// the edited text, here and everywhere else that reads file content.
		const content =
			this.effectiveChunkContents.get(portal.clusterId)?.[portal.file.path] ??
			null;

		this.store.getState().enterPortal(target, content, this.previewFor(portal));
		this.bus.emit("portal:enter", { portalId: target });

		// Binary/unreadable files (content === null) keep the M3 fallback: mode
		// flips to "file" but WorldScene keeps running underneath FileOverlay's
		// React "no preview available" message. A real text file gets the real
		// FileScene instead, via switch() (sleep this scene, start file fresh)
		// so returning later is scene.wake(), not a full WorldScene re-init —
		// camera position and the chunk cache survive the round trip.
		if (content !== null) {
			this.persistPlayerPos();
			const monsters = this.liveMonstersFor(target);
			this.scene.switch("file", {
				portalId: target,
				file: portal.file,
				content,
				returnSceneKey: "world",
				monsters,
				worldFiles: [...this.worldFiles],
				...(this.layerSeam?.isLayerPortal(target)
					? { saveToDisk: (text: string) => this.saveLayerFile(target, text) }
					: {}),
				...(this.skin.parchmentTint !== null
					? { parchmentTint: this.skin.parchmentTint }
					: {}),
				...(this.skin.parchment
					? { parchmentTexture: this.skin.parchment.key }
					: {}),
				...(this.skin.backdrop !== null
					? { backdrop: this.skin.backdrop }
					: {}),
				...(this.skin.arch
					? {
							archStrip: {
								key: this.skin.arch.strip.key,
								anim: skinAnimKey(this.skin.arch.strip),
							},
						}
					: {}),
			});
		}
	}

	private persistPlayerPos(): void {
		const pos = { x: this.player.body.x, y: this.player.body.y };
		// A spot inside the layer must not become where a reload (which is
		// always without the layer) puts the player.
		if (this.layerSeam) {
			this.layerSeam.recordPosition(pos);
			return;
		}
		this.save = withPlayerPosition(this.save, "world", pos);
		persistSave(this.save);
	}

	// The bonfire at world spawn doubles as the way back — Esc only returns to
	// the shelf near it, not from anywhere in the world, so it reads as a
	// deliberate portal-back rather than a global hotkey that fights the file
	// overlay's own Esc-to-close. Enter (or clicking the bonfire) at the fire
	// does the same, via interact().
	private handleReturnToShelf(): void {
		if (!Phaser.Input.Keyboard.JustDown(this.keys.esc)) return;

		const spawn = this.manifest.clusters[0]?.pos ?? { x: 0, y: 0 };
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		if (
			Phaser.Math.Distance.Between(playerPos.x, playerPos.y, spawn.x, spawn.y) >
			RETURN_TO_SHELF_RADIUS
		) {
			return;
		}
		this.returnToShelf();
	}

	private returnToShelf(): void {
		if (!this.returnTo || this.returningToShelf) return;
		this.returningToShelf = true;
		this.walker.cancel();
		this.persistPlayerPos();
		const shelfUrl = this.returnTo.shelfUrl;
		this.bus.emit("world:return-to-shelf", { shelfUrl });
		// Same fade-covers-the-cut reasoning as ShelfScene.handleCabinEnter — see
		// systems/sceneTransition.ts.
		this.time.delayedCall(
			cabinTransitionDelayMs(prefersReducedMotion()),
			() => {
				this.scene.start("boot", { shelfUrl });
			},
		);
	}

	// --- World layer ---------------------------------------------------
	// Everything layer-specific lives in scenes/worldLayerSeam.ts; these are
	// the scene's hooks into it. Without a layer each one reduces to the
	// plain base-world behaviour.

	private layerPathBake: Phaser.GameObjects.RenderTexture | null = null;

	/** Phaser reuses this scene object across starts and restarts: nothing from the last world (or the last layer) may carry over. */
	private resetWorldState(): void {
		this.clustersById = new Map();
		this.portalsById = new Map();
		this.portalWorldPos = new Map();
		this.portalRingRadii = new Map();
		this.portalSprites = new Map();
		this.portalVariantOverlays = new Map();
		this.portalVariants = new Map();
		this.portalPathById = new Map();
		this.worldFiles = new Set();
		this.monstersById = new Map();
		this.portalMonsterIds = new Map();
		this.monsterSprites = new Map();
		this.overrideMonsters = new Map();
		this.chunkContents = new Map();
		this.effectiveChunkContents = new Map();
		this.chunkLoadOrder = [];
		this.editedMarkers = new Map();
		this.placedProps = [];
		this.focusedPortalId = null;
		this.nearWebPortalId = null;
		this.portalsInRange = new Set();
		this.petOpenPending = null;
		this.layerPathBake = null;
	}

	private ringPaths(clusterId: string): WorldPath[] {
		return (
			this.layerSeam?.ringPaths(clusterId) ??
			this.manifest.paths.filter(
				(p) => p.from === clusterId || p.to === clusterId,
			)
		);
	}

	private ringGeometry(clusterId: string): RingGeometry | undefined {
		const cluster = this.clustersById.get(clusterId);
		const radius = this.portalRingRadii.get(clusterId);
		if (!cluster || radius === undefined) return undefined;
		const archAngles = cluster.portalIds.flatMap((id) => {
			const pos = this.portalWorldPos.get(id);
			return pos
				? [Math.atan2(pos.y - cluster.pos.y, pos.x - cluster.pos.x)]
				: [];
		});
		return { radius, archAngles };
	}

	private pathPolyline(
		path: WorldPath,
		from: Cluster,
		to: Cluster,
	): Position[] {
		return this.layerSeam?.polyline(path, from, to) ?? [from.pos, to.pos];
	}

	/** A layer cluster's chunk comes from its provider, never from under worldBase. */
	private fetchChunkFiles(cluster: Cluster): Promise<Record<string, string>> {
		if (this.layerSeam?.layer.clusterIds.has(cluster.id))
			return this.layerSeam.fetchChunkFiles(cluster.id);
		return fetch(resolveRelativeUrl(this.worldBase, cluster.chunk))
			.then((res) => res.json())
			.then((raw) => {
				const chunk: WorldChunk = WorldChunkSchema.parse(raw);
				const files: Record<string, string> = {};
				for (const [path, file] of Object.entries(chunk.files)) {
					files[path] = file.content;
				}
				return files;
			});
	}

	/** The guide and the rift stand where they would without a layer. */
	private basePortalPositions(): Position[] {
		return this.baseManifest.portals.flatMap((p) => {
			const pos = this.portalWorldPos.get(p.id);
			return pos ? [pos] : [];
		});
	}

	/**
	 * A portal's undefeated monsters. For a file with a saved edit they're
	 * re-checked against that text, once per distinct text: the ones it fixed
	 * are defeated the way a save defeats them, the rest carry their lines in
	 * it (systems/battle.ts's relocateMonsters).
	 */
	private liveMonstersFor(portalId: string): Monster[] {
		const monsters = (this.portalMonsterIds.get(portalId) ?? [])
			.map((id) => this.monstersById.get(id))
			.filter((m): m is Monster => m !== undefined && !this.isDefeated(m.id));
		const content = this.save.fileOverrides[portalId]?.content;
		const portal = this.portalsById.get(portalId);
		if (
			content === undefined ||
			!portal ||
			monsters.length === 0 ||
			this.layerSeam?.isLayerPortal(portalId)
		)
			return monsters;
		const cached = this.overrideMonsters.get(portalId);
		if (cached?.content === content)
			return cached.monsters.filter((m) => !this.isDefeated(m.id));
		const relocated = relocateMonsters(
			monsters,
			portal.file,
			content,
			this.worldFiles,
		);
		this.overrideMonsters.set(portalId, {
			content,
			monsters: relocated.monsters,
		});
		for (const monsterId of relocated.fixedIds)
			this.onMonsterDefeated({ monsterId });
		return relocated.monsters;
	}

	private isDefeated(monsterId: string): boolean {
		return (
			this.save.defeatedMonsterIds.includes(monsterId) ||
			(this.layerSeam?.defeatedMonsters().includes(monsterId) ?? false)
		);
	}

	private publishVisitedClusters(): void {
		this.store
			.getState()
			.setVisitedClusterIds([
				...this.save.visitedClusters,
				...(this.layerSeam?.visitedClusters() ?? []),
			]);
	}

	private layerDustPoints(): Position[] {
		const seam = this.layerSeam;
		if (!seam) return [];
		const points: Position[] = [];
		for (const cluster of this.manifest.clusters) {
			if (!seam.layer.clusterIds.has(cluster.id)) continue;
			points.push(cluster.pos);
			for (const id of cluster.portalIds) {
				const pos = this.portalWorldPos.get(id);
				if (pos) points.push(pos);
			}
		}
		return points.slice(0, 32);
	}

	private layerClearings(): LayerClearing[] {
		const seam = this.layerSeam;
		if (!seam) return [];
		return this.manifest.clusters
			.filter((c) => seam.layer.clusterIds.has(c.id))
			.map((c) => ({ x: c.pos.x, y: c.pos.y, radius: this.groundReach(c) }));
	}

	/** Tells the HUD which layer shows, and raises that layer's objects out of the ground. */
	private raiseLayer(before: ReadonlySet<Phaser.GameObjects.GameObject>): void {
		const seam = this.layerSeam;
		this.store.getState().setActiveLayer(seam?.id ?? null);
		// Set regardless of whether a layer exists — bakeOneClusterGround/
		// materializeClusterProps check this to know whether seam.collect()
		// already ran (entry clusters, picked up by its own scan) or a later
		// stream-in needs an explicit addRiser() instead.
		this.layerRisersCollected = true;
		if (!seam) return;
		seam.collect(
			this,
			before,
			this.layerClearings(),
			this.layerPathBake ? [this.layerPathBake] : [],
		);
		seam.rise(
			this,
			layerRiseMs(prefersReducedMotion()),
			this.layerDustPoints(),
		);
	}

	private setupLayerListeners(): void {
		this.bus.on("layer:toggle", this.onLayerToggle);
		this.bus.on("layer:reload-file", this.onLayerReloadFile);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.bus.off("layer:toggle", this.onLayerToggle);
			this.bus.off("layer:reload-file", this.onLayerReloadFile);
			const seam = this.layerSeam;
			if (!seam) return;
			// Copies of a layer file's text leave with the layer.
			const state = this.store.getState();
			for (const slot of state.bagSlots)
				if (seam.isLayerPortal(slot.sourcePortalId))
					state.removeBagSlot(slot.id);
		});
	}

	private onLayerToggle = ({ layerId }: { layerId: string }): void => {
		const state = this.store.getState();
		if (
			this.layerSwitching ||
			this.returningToShelf ||
			state.mode !== "world" ||
			state.mapOpen ||
			state.guideOpen ||
			state.universeOpen ||
			state.petChatOpen ||
			state.openSignPath !== null ||
			state.signDraft !== null
		)
			return;
		if (this.layerSeam?.id === layerId) {
			this.layerSwitching = true;
			this.walker.cancel();
			this.switchLayer(null);
			return;
		}
		const provider = state.worldLayers.find((l) => l.id === layerId);
		if (!provider) return;
		this.layerSwitching = true;
		this.walker.cancel();
		provider
			.load()
			.then((manifest) => {
				if (!this.sys.isActive() && !this.sys.isSleeping()) return;
				const issues = worldLayerIssues(this.baseManifest, manifest);
				if (issues.length > 0) {
					this.layerSwitching = false;
					this.store.getState().setLayerSaveIssue({
						portalId: "",
						message: `That layer no longer fits this world (${issues[0]}). Reload the page to rebuild it.`,
						conflict: false,
					});
					return;
				}
				this.switchLayer({ provider, manifest });
			})
			.catch((err) => {
				this.layerSwitching = false;
				this.store.getState().setLayerSaveIssue({
					portalId: "",
					message: `The layer wouldn't open: ${err instanceof Error ? err.message : String(err)}`,
					conflict: false,
				});
			});
	};

	/** Restarts this scene with `next` shown (or none), keeping the player where they stand; the layer's objects sink first when leaving. */
	private switchLayer(next: ActiveWorldLayer | null): void {
		const reducedMotion = prefersReducedMotion();
		this.persistPlayerPos();
		const here = { x: this.player.body.x, y: this.player.body.y };
		// Leaving from inside a layer clearing, the ground there is about to
		// vanish: go back to where the layer was entered (the world's saved spot).
		const standingInLayer =
			!next &&
			this.layerSeam !== null &&
			inLayerClearing(here, this.layerClearings());
		const spawnAt = standingInLayer ? undefined : here;
		const color = (next?.provider.skin ?? this.skin).transitionColor;
		const restart = (): void => {
			const { layer: _layer, spawnAt: _spawnAt, ...rest } = this.initData;
			this.scene.restart({
				...rest,
				// Signs the owner wrote this visit live only in the store.
				signs: this.store.getState().signs.filter((s) => !isHiddenPath(s.path)),
				...(next ? { layer: next } : {}),
				...(spawnAt ? { spawnAt } : {}),
			} satisfies WorldSceneData);
		};
		const announce = (): void => {
			this.bus.emit("layer:changed", {
				layerId: next?.provider.id ?? null,
				color,
			});
			this.time.delayedCall(layerTransitionDelayMs(reducedMotion), restart);
		};
		if (!next && this.layerSeam)
			this.layerSeam.sink(
				this,
				layerRiseMs(reducedMotion),
				this.layerDustPoints(),
				announce,
			);
		else announce();
	}

	/** FileScene's saveToDisk for a layer file: resolves true once the provider has written it. */
	private async saveLayerFile(
		portalId: string,
		content: string,
	): Promise<boolean> {
		const seam = this.layerSeam;
		const portal = this.portalsById.get(portalId);
		if (!seam || !portal) return false;
		const result = await seam.saveFile(portal.file.path, content);
		if (!result.ok) {
			this.store.getState().setLayerSaveIssue({
				portalId,
				message: result.message,
				conflict: result.conflict,
			});
			return false;
		}
		if (this.layerSeam !== seam) return true;
		this.store.getState().setLayerSaveIssue(null);
		const files = this.chunkContents.get(portal.clusterId);
		if (files) {
			this.chunkContents.set(portal.clusterId, {
				...files,
				[portal.file.path]: content,
			});
			this.refreshEffectiveChunk(portal.clusterId);
		}
		const fresh = seam.portal(portalId);
		if (fresh) {
			this.portalsById.set(portalId, fresh);
			const index = this.manifest.portals.findIndex((p) => p.id === portalId);
			if (index >= 0) this.manifest.portals[index] = fresh;
		}
		this.publishPortalIndex();
		this.refreshPortalPreview(portalId);
		return true;
	}

	private onLayerReloadFile = ({ portalId }: { portalId: string }): void => {
		const seam = this.layerSeam;
		const portal = this.portalsById.get(portalId);
		if (!seam || !portal) return;
		void seam
			.refreshManifest()
			.then(() => seam.fetchChunkFiles(portal.clusterId))
			.then((files) => {
				if (this.layerSeam !== seam) return;
				this.chunkContents.set(portal.clusterId, files);
				this.refreshEffectiveChunk(portal.clusterId);
				const text = files[portal.file.path] ?? "";
				if (this.store.getState().activePortalId !== portalId) return;
				this.store.getState().setActivePortalContent(text);
				this.bus.emit("file:content-reset", { portalId, content: text });
			})
			.catch((err) => {
				this.store.getState().setLayerSaveIssue({
					portalId,
					message: `Couldn't reload ${portal.file.path}: ${err instanceof Error ? err.message : String(err)}`,
					conflict: false,
				});
			});
	};

	// --- Save persistence ---------------------------------------------
	// WorldScene owns `this.save` for the whole session (it outlives FileScene
	// switches — see the M4 scene.switch/wake comment above) so it's the
	// single place fileOverrides/visitedClusters/bagSlots get written, even
	// though the events that trigger a write (an editor save, a bag grab)
	// happen while this scene is asleep underneath FileScene. mitt listeners
	// and zustand subscriptions aren't Phaser scene lifecycle, so they still
	// fire while asleep.

	private setupSaveListeners(): void {
		this.bus.on("cluster:enter", this.onClusterEnterForSave);
		this.bus.on("editor:save", this.onEditorSave);
		this.bus.on("tool:reset-file-edits", this.onResetFileEdits);
		this.bus.on("tool:reset-world", this.onResetWorld);
		this.bus.on("monster:defeated", this.onMonsterDefeated);
		this.unsubscribeBagSlots = this.store.subscribe((state, prev) => {
			if (state.bagSlots === prev.bagSlots) return;
			// A copy of a layer file's text never reaches browser storage.
			this.save = withBagSlots(
				this.save,
				state.bagSlots.filter(
					(s) => !this.layerSeam?.isLayerPortal(s.sourcePortalId),
				),
			);
			persistSave(this.save);
		});
		this.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.teardownSaveListeners,
			this,
		);
	}

	private teardownSaveListeners(): void {
		this.bus.off("cluster:enter", this.onClusterEnterForSave);
		this.bus.off("editor:save", this.onEditorSave);
		this.bus.off("tool:reset-file-edits", this.onResetFileEdits);
		this.bus.off("tool:reset-world", this.onResetWorld);
		this.bus.off("monster:defeated", this.onMonsterDefeated);
		this.unsubscribeBagSlots?.();
		this.unsubscribeBagSlots = null;
	}

	private onClusterEnterForSave = ({
		clusterId,
	}: {
		clusterId: string;
	}): void => {
		if (this.layerSeam?.recordVisit(clusterId)) {
			this.publishVisitedClusters();
			return;
		}
		if (this.save.visitedClusters.includes(clusterId)) return;
		this.save = withVisitedCluster(this.save, clusterId);
		this.publishVisitedClusters();
		persistSave(this.save);
	};

	private onEditorSave = ({
		portalId,
		content,
	}: {
		portalId: string;
		content: string;
	}): void => {
		// A layer file is written by its provider (FileScene's saveToDisk ->
		// saveLayerFile), never into the save's overrides.
		if (editorSaveTarget(portalId, this.layerSeam?.layer ?? null) === "layer")
			return;
		this.save = withFileOverride(
			this.save,
			portalId,
			content,
			new Date().toISOString(),
		);
		persistSave(this.save);
		const portal = this.portalsById.get(portalId);
		if (portal) this.refreshEffectiveChunk(portal.clusterId);
		this.drawEditedMarker(portalId);
		this.publishPortalIndex();
		this.refreshPortalPreview(portalId);
	};

	private onResetFileEdits = ({ portalId }: { portalId: string }): void => {
		this.save = withoutFileOverride(this.save, portalId);
		this.overrideMonsters.delete(portalId);
		persistSave(this.save);
		this.removeEditedMarker(portalId);
		this.publishPortalIndex();
		this.refreshPortalPreview(portalId);

		const portal = this.portalsById.get(portalId);
		if (!portal) return;
		this.refreshEffectiveChunk(portal.clusterId);
		if (this.store.getState().activePortalId !== portalId) return;

		// That file is the one currently open (in FileScene or its editor) —
		// swap the live view back to the pristine chunk content too, not just
		// the saved state.
		const pristine =
			this.chunkContents.get(portal.clusterId)?.[portal.file.path] ?? "";
		this.store.getState().setActivePortalContent(pristine);
		this.bus.emit("file:content-reset", { portalId, content: pristine });
	};

	/** FileScene resolved a battle in this monster's favor (its originating annotator no longer flags anything with the same rule) — drop it from the save and every scene that renders it. */
	private onMonsterDefeated = ({ monsterId }: { monsterId: string }): void => {
		if (this.layerSeam?.recordDefeat(monsterId)) {
			this.removeMonsterSprite(monsterId);
			this.publishMonsterIndex();
			return;
		}
		if (this.save.defeatedMonsterIds.includes(monsterId)) return;
		this.save = withDefeatedMonster(this.save, monsterId);
		persistSave(this.save);
		this.removeMonsterSprite(monsterId);
		this.publishMonsterIndex();
	};

	private onResetWorld = (): void => {
		const resetPortalIds = Object.keys(this.save.fileOverrides);
		this.overrideMonsters.clear();
		const revivedMonsterIds = [
			...this.save.defeatedMonsterIds,
			...(this.layerSeam?.defeatedMonsters() ?? []),
		];
		this.layerSeam?.resetSlot();
		this.save = emptySaveData(this.worldId);
		this.store.getState().setVisitedClusterIds([]);
		clearSave(this.worldId);
		for (const clusterId of this.chunkContents.keys())
			this.refreshEffectiveChunk(clusterId);
		for (const portalId of resetPortalIds) {
			this.removeEditedMarker(portalId);
			this.refreshPortalPreview(portalId);
		}
		for (const monsterId of revivedMonsterIds) {
			const monster = this.monstersById.get(monsterId);
			if (!monster) continue;
			if (monster.portalId) this.drawPortalMonster(monster);
			else if (monster.pathId) this.drawPathMonster(monster);
		}
		this.publishPortalIndex();
		this.publishMonsterIndex();

		const activePortalId = this.store.getState().activePortalId;
		const portal = activePortalId
			? this.portalsById.get(activePortalId)
			: undefined;
		if (!activePortalId || !portal) return;
		const pristine =
			this.chunkContents.get(portal.clusterId)?.[portal.file.path] ?? "";
		this.store.getState().setActivePortalContent(pristine);
		this.bus.emit("file:content-reset", {
			portalId: activePortalId,
			content: pristine,
		});
	};
}
