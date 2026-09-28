import type { Monster, PortalFile } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { ASSET_KEYS, PORTAL_ARCH_FRAME_SIZE } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnMode, CabnStore } from "../bridge/store.js";
import { attachGlow } from "../fx/GlowPipeline.js";
import { PALETTE, toCssColor } from "../palette.js";
import {
	attachPointerInput,
	BOUNDS_INSET_PX,
	ClickWalker,
	drivePlayer,
	type PointerInputHandle,
	physicsBounds,
} from "../render/clickWalker.js";
import { dashedLine } from "../render/dashedLine.js";
import { addHoverBob, createMonsterSprite } from "../render/monsterSprite.js";
import {
	createMovementKeys,
	createPlayer,
	DEFAULT_PLAYER_SPEED,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
} from "../render/playerController.js";
import { MONSTER_FILE_SIZE, PORTAL_SCALE } from "../render/scale.js";
import { checkMonsterFixed } from "../systems/battle.js";
import {
	type ClickTarget,
	clampToBounds,
	type Interactable,
} from "../systems/clickWalk.js";
import {
	enchantMdLine,
	type MdSegment,
	type MdSegmentStyle,
} from "../systems/enchantMd.js";
import { getActiveExecutionProvider } from "../systems/execution/executionProvider.js";
import {
	computeLineWindow,
	type LineWindow,
	lineWindowsEqual,
} from "../systems/lineWindow.js";
import { isWithinRadius } from "../systems/portalApproach.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import {
	createIdleRunPlaybackState,
	currentStep,
	type RunPlaybackState,
	type RunSpeed,
	runPlaybackReducer,
} from "../systems/runPlayback.js";
import {
	extendSelection,
	type LineSelection,
	selectionRange,
	startSelection,
} from "../systems/selection.js";
import { activeFocusOwner } from "../systems/uiFocus.js";
import { PORTAL_IDLE_ANIM } from "./PreloadScene.js";

export interface FileSceneData {
	portalId: string;
	file: PortalFile;
	content: string;
	/** Which scene key to wake/resume once this file closes (always "world" for now, named explicitly so a future shelf-level file view isn't a hardcoded string away). */
	returnSceneKey: string;
	/** This portal's non-defeated monsters, handed down by WorldScene (which owns the save's defeatedMonsterIds) — never all of manifest.monsters, only this file's. */
	monsters: Monster[];
	/** Every file path in the world — brokenImport's re-check needs it, same as convert()-time (see annotate/types.ts's AnnotateContext). */
	worldFiles: string[];
}

// A vertical parchment scroll, not a floating text panel: the player walks
// down a path beside the line-numbered text, camera following, same feel as
// WorldScene/ShelfScene's walk-and-follow rather than a new scroll-by-keys
// mode built from scratch — see CHANGELOG for the fuller "why" (reuses
// createPlayer/updatePlayerMovement wholesale instead of a bespoke camera-pan
// input handler).
const LINE_HEIGHT = 20;
const GUTTER_RIGHT_X = 54;
const TEXT_X = 64;
const PATH_X = -60;
const SCROLL_MIN_X = -140;
const SCROLL_MAX_X = 760;
const BUFFER_LINES = 20;
const EXIT_MARGIN = 160;
const EXIT_ENTER_RADIUS = 70;
/** Click-walk stop distances — each inside its Enter radius (EXIT_ENTER_RADIUS, MONSTER_ENTER_RADIUS) so arrival lands where Enter would work. */
const EXIT_ARRIVE_RADIUS = 40;
const MONSTER_ARRIVE_RADIUS = 30;
const BASE_FONT_SIZE = 13;
const CODE_BOX_PAD_X = 3;

// A monster stands just left of the text, between the gutter and the path —
// close enough to the path that walking down it reads as "walking past" each
// one in turn.
const MONSTER_X = PATH_X + 50;
const MONSTER_APPROACH_RADIUS = 90;
const MONSTER_ENTER_RADIUS = 42;
const ENCOUNTER_BANNER_MS = 1400;

// The run "spark" travels the same path the player normally walks, one line
// at a time — sharing PATH_X reads as "the same road", not a separate lane.
const RUN_SPARK_X = PATH_X;
const RUN_SPARK_RADIUS = 6;

function headingFontSize(level: number): number {
	if (level <= 1) return 20;
	if (level === 2) return 17;
	return 15;
}

function segmentTextStyle(
	style: MdSegmentStyle,
): Phaser.Types.GameObjects.Text.TextStyle {
	const base = {
		fontFamily: '"Courier New", monospace',
		fontSize: `${BASE_FONT_SIZE}px`,
	};
	switch (style) {
		case "heading1":
		case "heading2":
		case "heading3": {
			const level = style === "heading1" ? 1 : style === "heading2" ? 2 : 3;
			return {
				...base,
				fontSize: `${headingFontSize(level)}px`,
				fontStyle: "bold",
				color: toCssColor(PALETTE.gold),
			};
		}
		case "bold":
			return { ...base, fontStyle: "bold", color: toCssColor(PALETTE.ink) };
		case "italic":
			return { ...base, fontStyle: "italic", color: toCssColor(PALETTE.ink) };
		case "boldItalic":
			return {
				...base,
				fontStyle: "bold italic",
				color: toCssColor(PALETTE.ink),
			};
		case "link":
			return { ...base, color: toCssColor(PALETTE.paleGhostBlue) };
		case "code":
			return { ...base, color: toCssColor(PALETTE.ink) };
		default:
			return { ...base, color: toCssColor(PALETTE.ink) };
	}
}

export class FileScene extends Phaser.Scene {
	private portalId = "";
	private file!: PortalFile;
	private lines: string[] = [];
	private returnSceneKey = "world";
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private player!: PlayerHandle;
	private movementKeys!: MovementKeys;
	private playerTextures!: PlayerTextures;
	private exitPortalPos = { x: PATH_X, y: -EXIT_MARGIN };

	private activeLines = new Map<number, Phaser.GameObjects.Container>();
	private currentWindow: LineWindow = { start: 0, end: 0 };

	private selection: LineSelection | null = null;
	private highlightGraphic: Phaser.GameObjects.Graphics | null = null;
	private unsubscribeMode: (() => void) | null = null;

	/** Non-null only while a run is in progress — this scene owns the actual state machine (see runPlayback.ts); the store only ever gets a read-only snapshot (RunOverlayState) republished from it. */
	private runState: RunPlaybackState | null = null;
	private runSpark: Phaser.GameObjects.Arc | null = null;
	private runHighlight: Phaser.GameObjects.Graphics | null = null;
	/** Lines already checked for a blocking monster this run — BLOCK is a one-shot trigger per arrival at a line, not something that re-fires every tick while paused there. */
	private runBlockedAtLine: number | null = null;
	/** Bumped on every wand press and on stop — a provider's `run()` promise resolving with a stale id (superseded, or the run was already stopped) is ignored instead of unexpectedly starting/restarting playback. */
	private runRequestId = 0;

	private monsters: Monster[] = [];
	private worldFiles = new Set<string>();
	private monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
	private monsterBobTweens = new Map<string, Phaser.Tweens.Tween>();
	private monstersInRange = new Set<string>();
	/** The monster the currently-open encounter banner/quill session is about, if any — set by walking into a monster and pressing E, cleared once the encounter resolves (fixed or cancelled). */
	private encounterMonsterId: string | null = null;
	private monsterTooltip!: Phaser.GameObjects.Container;
	private monsterTooltipText!: Phaser.GameObjects.Text;

	private keys!: {
		enter: Phaser.Input.Keyboard.Key;
		esc: Phaser.Input.Keyboard.Key;
		shift: Phaser.Input.Keyboard.Key;
	};
	private walker!: ClickWalker;
	private pointerInput!: PointerInputHandle;
	/** Set once exitToWorld() runs — see its comment. */
	private exiting = false;
	private runKeys!: {
		space: Phaser.Input.Keyboard.Key;
		n: Phaser.Input.Keyboard.Key;
		one: Phaser.Input.Keyboard.Key;
		two: Phaser.Input.Keyboard.Key;
		four: Phaser.Input.Keyboard.Key;
	};

	constructor() {
		super({ key: "file", active: false });
	}

	init(data: FileSceneData): void {
		this.portalId = data.portalId;
		this.file = data.file;
		this.lines = data.content.split("\n");
		this.returnSceneKey = data.returnSceneKey;
		this.store = this.registry.get("store");
		this.bus = this.registry.get("bus");
		this.activeLines = new Map();
		this.currentWindow = { start: 0, end: 0 };
		this.selection = null;
		this.highlightGraphic = null;
		this.monsters = [...data.monsters];
		this.worldFiles = new Set(data.worldFiles);
		this.monsterSprites = new Map();
		this.monsterBobTweens = new Map();
		this.monstersInRange = new Set();
		this.encounterMonsterId = null;
		this.exiting = false;
	}

	create(): void {
		this.drawParchmentBacking();
		this.drawPath();
		this.drawExitPortal();
		this.buildMonsterSprites();
		this.createMonsterTooltip();
		this.createPlayer();
		this.setupInput();
		this.setupCamera();
		attachGlow(this);
		// mitt's on/off take no context arg — the on*/handler fields below are
		// arrow class fields (auto-bound, stable reference) specifically for this.
		this.bus.on("tool:jump-to-line", this.onJumpToLine);
		this.bus.on("tool:bag-use", this.onBagUse);
		this.bus.on("tool:quill-use", this.onQuillUse);
		this.bus.on("tool:wand-use", this.onWandUse);
		this.bus.on("run:play", this.onRunPlay);
		this.bus.on("run:pause", this.onRunPause);
		this.bus.on("run:step", this.onRunStep);
		this.bus.on("run:stop", this.onRunStop);
		this.bus.on("run:set-speed", this.onRunSetSpeed);
		this.bus.on("editor:save", this.onEditorSave);
		this.bus.on("file:content-reset", this.onFileContentReset);
		this.bus.on("tool:opener-use", this.onOpenerUse);
		// Not a bus event: closing the editor is a store.closeEditor() call from
		// EditorOverlay, which only touches `mode` — a subscription is the one
		// thing that reacts uniformly no matter which code path changed it.
		this.unsubscribeMode = this.store.subscribe((state, prev) => {
			if (state.mode !== prev.mode) this.syncKeyboardForMode(state.mode);
			// The player can leave "editor"/"encounter" without a fix (Esc,
			// discard) — either way, once we're back in plain "file" mode no
			// encounter session is in progress anymore.
			if (state.mode === "file" && prev.mode !== "file") {
				this.encounterMonsterId = null;
			}
		});
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
	}

	private teardown(): void {
		this.bus.off("tool:jump-to-line", this.onJumpToLine);
		this.bus.off("tool:bag-use", this.onBagUse);
		this.bus.off("tool:quill-use", this.onQuillUse);
		this.bus.off("tool:wand-use", this.onWandUse);
		this.bus.off("run:play", this.onRunPlay);
		this.bus.off("run:pause", this.onRunPause);
		this.bus.off("run:step", this.onRunStep);
		this.bus.off("run:stop", this.onRunStop);
		this.bus.off("run:set-speed", this.onRunSetSpeed);
		this.bus.off("editor:save", this.onEditorSave);
		this.bus.off("file:content-reset", this.onFileContentReset);
		this.bus.off("tool:opener-use", this.onOpenerUse);
		this.unsubscribeMode?.();
		this.unsubscribeMode = null;
		// A run in progress at shutdown: drop the state and any run-only game
		// objects, but don't touch camera follow — the scene (and its camera)
		// are being torn down regardless. Bumping runRequestId means a
		// still-in-flight ExecutionProvider.run() resolving after this point is
		// a no-op (see onWandUse) instead of touching a destroyed scene.
		this.runRequestId++;
		this.runSpark?.destroy();
		this.runSpark = null;
		this.runHighlight?.destroy();
		this.runHighlight = null;
		this.runState = null;
		// Editor could still be "open" (mode === "editor") at shutdown if the
		// player left mid-edit some other way than Esc — make sure the keyboard
		// plugin doesn't stay disabled for whatever scene starts next.
		this.syncKeyboardForMode("world");
	}

	/**
	 * The classic Phaser-steals-focus-from-a-DOM-input bug, handled at its
	 * root: while the editor overlay is open, this scene's keyboard plugin is
	 * disabled outright (not just "movement ignores mode") so WASD/E/Esc/Shift
	 * never reach FileScene while the player is typing in CodeMirror, and
	 * CodeMirror's own keydown handling is never fought for the same keys.
	 * `resetKeys()` on disable matters because Phaser's global keyboard queue
	 * is drained once per step regardless of whether a disabled plugin
	 * consumed it — without it, a WASD key already held when the editor opens
	 * never sees its matching keyup and reads as stuck-down once re-enabled.
	 */
	private syncKeyboardForMode(mode: CabnMode): void {
		const kb = this.input.keyboard;
		if (!kb) return;
		const shouldBeEnabled = mode !== "editor";
		if (kb.enabled === shouldBeEnabled) return;
		kb.enabled = shouldBeEnabled;
		if (!shouldBeEnabled) kb.resetKeys();
	}

	private totalHeight(): number {
		return Math.max(this.lines.length, 1) * LINE_HEIGHT;
	}

	private drawParchmentBacking(): void {
		const height = this.totalHeight();
		const g = this.add.graphics().setDepth(0);
		g.fillStyle(PALETTE.parchment, 1);
		g.fillRect(
			SCROLL_MIN_X,
			-EXIT_MARGIN,
			SCROLL_MAX_X - SCROLL_MIN_X,
			height + EXIT_MARGIN + 200,
		);
		// Faint seams every ~20 lines read as "tiled parchment" without tiling an
		// actual texture — cheap (one Graphics object) regardless of file length.
		g.lineStyle(1, PALETTE.trail, 0.08);
		for (let y = 0; y < height; y += LINE_HEIGHT * 20) {
			g.lineBetween(SCROLL_MIN_X, y, SCROLL_MAX_X, y);
		}
	}

	private drawPath(): void {
		const g = this.add.graphics().setDepth(1);
		g.lineStyle(2, PALETTE.trail, 0.6);
		dashedLine(g, { x: PATH_X, y: 0 }, { x: PATH_X, y: this.totalHeight() });
	}

	private drawExitPortal(): void {
		const sprite = this.add.sprite(
			this.exitPortalPos.x,
			this.exitPortalPos.y,
			ASSET_KEYS.portalArchStrip,
		);
		sprite.setScale(PORTAL_SCALE).setDepth(3);
		sprite.play(PORTAL_IDLE_ANIM);
	}

	/**
	 * Round-2 playtest (2026-09-28): the character only belongs in the open
	 * world. The physics body stays as an invisible reading cursor — camera
	 * follow, WASD/click scrolling, nearestLineToPlayer and the monster/exit
	 * proximity checks all still key off it — with a small gold caret in the
	 * path lane standing in for the sprite so Enter-near-a-monster and the
	 * exit arch still have a visible "you are here".
	 */
	private createPlayer(): void {
		this.playerTextures = { front: ASSET_KEYS.characterIdle, back: null };
		this.player = createPlayer(this, { x: PATH_X, y: 0 }, this.playerTextures);
		this.player.sprite.setVisible(false);
		const caret = this.add.graphics();
		caret.fillStyle(PALETTE.gold, 1);
		caret.lineStyle(2, PALETTE.ink, 1);
		caret.beginPath();
		caret.moveTo(-7, -7);
		caret.lineTo(7, 0);
		caret.lineTo(-7, 7);
		caret.closePath();
		caret.fillPath();
		caret.strokePath();
		this.player.body.add(caret);
	}

	// --- Monsters / battle loop -----------------------------------------

	private monsterPos(monster: Monster): { x: number; y: number } {
		return { x: MONSTER_X, y: (monster.error.loc?.line ?? 0) * LINE_HEIGHT };
	}

	private buildMonsterSprites(): void {
		for (const monster of this.monsters) {
			const pos = this.monsterPos(monster);
			const sprite = createMonsterSprite(
				this,
				pos.x,
				pos.y,
				monster.species,
				MONSTER_FILE_SIZE[monster.species] ?? 20,
			);
			sprite.setDepth(4);
			// Wisps are cosmetic (see onEditorSave/onBagUse-adjacent doc below) —
			// faint like their WorldScene counterpart, never part of an encounter.
			if (monster.species === "will-o-wisp") sprite.setAlpha(0.7);
			this.monsterSprites.set(monster.id, sprite);
			this.monsterBobTweens.set(
				monster.id,
				addHoverBob(this, sprite, monster.species === "will-o-wisp" ? 6 : 3),
			);
		}
	}

	private createMonsterTooltip(): void {
		const width = 220;
		const height = 46;
		const bg = this.add.graphics();
		bg.fillStyle(PALETTE.parchment, 0.96);
		bg.lineStyle(1.5, PALETTE.ink, 0.8);
		bg.fillRoundedRect(0, 0, width, height, 6);
		bg.strokeRoundedRect(0, 0, width, height, 6);
		this.monsterTooltipText = this.add.text(8, 6, "", {
			fontFamily: '"Courier New", monospace',
			fontSize: "10px",
			color: toCssColor(PALETTE.ink),
			wordWrap: { width: width - 16 },
		});
		this.monsterTooltip = this.add
			.container(0, 0, [bg, this.monsterTooltipText])
			.setDepth(6)
			.setVisible(false);
	}

	/** A speech-bubble tooltip near the closest in-range monster, same "closest one wins" rule as WorldScene's arch preview. Not an encounter — walking away just hides it again. */
	private handleMonsterApproach(): void {
		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		let closest: { monster: Monster; dist: number } | null = null;
		this.monstersInRange = new Set();

		for (const monster of this.monsters) {
			const pos = this.monsterPos(monster);
			const dist = Phaser.Math.Distance.Between(
				playerPos.x,
				playerPos.y,
				pos.x,
				pos.y,
			);
			if (dist > MONSTER_APPROACH_RADIUS) continue;
			this.monstersInRange.add(monster.id);
			if (!closest || dist < closest.dist) closest = { monster, dist };
		}

		if (!closest) {
			this.monsterTooltip.setVisible(false);
			return;
		}
		const pos = this.monsterPos(closest.monster);
		this.monsterTooltipText.setText(closest.monster.error.message);
		this.monsterTooltip.setPosition(pos.x + 14, pos.y - 30);
		this.monsterTooltip.setVisible(true);
	}

	/** Enter near a monster (not while selecting bag text) starts an encounter: a short banner, then the quill opens at the monster's loc. Wisps are excluded outright — they're cosmetic, never encounterable (see class doc above the field). */
	private handleMonsterEncounterKey(activationPressed: boolean): void {
		if (!activationPressed) return;
		if (this.selection !== null) return;

		const playerPos = { x: this.player.body.x, y: this.player.body.y };
		let nearest: { monster: Monster; dist: number } | null = null;
		for (const monster of this.monsters) {
			if (monster.species === "will-o-wisp") continue; // cosmetic, never encounterable
			const pos = this.monsterPos(monster);
			const dist = Phaser.Math.Distance.Between(
				playerPos.x,
				playerPos.y,
				pos.x,
				pos.y,
			);
			if (dist <= MONSTER_ENTER_RADIUS && (!nearest || dist < nearest.dist)) {
				nearest = { monster, dist };
			}
		}
		if (nearest) this.startEncounterFor(nearest.monster);
	}

	private startEncounterFor(monster: Monster): void {
		this.encounterMonsterId = monster.id;
		this.store.getState().startEncounter(monster.id);
		this.time.delayedCall(ENCOUNTER_BANNER_MS, () => {
			const state = this.store.getState();
			if (state.mode !== "encounter" || state.activeMonsterId !== monster.id) {
				return; // the player already cancelled (Esc) — see update()'s encounter-mode branch
			}
			state.openEditor({
				initialLine: monster.error.loc?.line ?? this.nearestLineToPlayer(),
				language: this.file.language,
			});
		});
	}

	/**
	 * Every monster currently shown in this file gets re-checked against the
	 * saved content, not just the one being fought — "the engine re-runs [the
	 * annotators] after edits" (see the M6 CHANGELOG) applies to the whole
	 * file, which is also how a wisp quietly vanishes on save even though it
	 * was never encountered (see todoMarker.ts/annotate's WispNote — always
	 * tier 0, cosmetic).
	 */
	private resolveMonstersAfterSave(content: string): void {
		const stillPresent: Monster[] = [];
		let encounterFixed = false;

		for (const monster of this.monsters) {
			const fixed = checkMonsterFixed(
				{ code: monster.error.code, rule: monster.error.rule },
				this.file,
				content,
				this.worldFiles,
			);
			if (fixed) {
				this.defeatMonster(monster);
				if (monster.id === this.encounterMonsterId) encounterFixed = true;
			} else {
				stillPresent.push(monster);
			}
		}
		this.monsters = stillPresent;

		if (!this.encounterMonsterId) return;
		if (encounterFixed) {
			this.store.getState().endEncounter();
			this.encounterMonsterId = null;
			return;
		}
		const stillEncountered = stillPresent.find(
			(m) => m.id === this.encounterMonsterId,
		);
		if (stillEncountered) {
			this.shrugMonster(stillEncountered);
			this.bus.emit("battle:hint", {
				message: "Still something wrong here — check the error and try again.",
			});
		}
	}

	private defeatMonster(monster: Monster): void {
		const sprite = this.monsterSprites.get(monster.id);
		this.monsterBobTweens.get(monster.id)?.stop();
		this.monsterBobTweens.delete(monster.id);
		this.monstersInRange.delete(monster.id);
		this.monsterSprites.delete(monster.id);

		if (sprite) {
			const isActiveEncounter = monster.id === this.encounterMonsterId;
			this.spawnVictorySparkles(sprite.x, sprite.y);
			if (isActiveEncounter) this.showVictoryText(sprite.x, sprite.y);
			this.tweens.add({
				targets: sprite,
				alpha: 0,
				scaleX: sprite.scaleX * 1.5,
				scaleY: sprite.scaleY * 1.5,
				duration: 500,
				ease: "Cubic.easeOut",
				onComplete: () => sprite.destroy(),
			});
		}
		this.bus.emit("monster:defeated", { monsterId: monster.id });
	}

	private spawnVictorySparkles(x: number, y: number): void {
		for (let i = 0; i < 6; i++) {
			const angle = (Phaser.Math.PI2 * i) / 6;
			const spark = this.add.circle(x, y, 2, PALETTE.gold).setDepth(7);
			this.tweens.add({
				targets: spark,
				x: x + Math.cos(angle) * 22,
				y: y + Math.sin(angle) * 22,
				alpha: 0,
				duration: 450,
				ease: "Cubic.easeOut",
				onComplete: () => spark.destroy(),
			});
		}
	}

	private showVictoryText(x: number, y: number): void {
		const text = this.add
			.text(x, y, "Fixed!", {
				fontFamily: '"Courier New", monospace',
				fontSize: "14px",
				fontStyle: "bold",
				color: toCssColor(PALETTE.gold),
				stroke: toCssColor(PALETTE.ink),
				strokeThickness: 3,
			})
			.setOrigin(0.5)
			.setDepth(7);
		this.tweens.add({
			targets: text,
			y: y - 30,
			alpha: 0,
			duration: 1100,
			ease: "Cubic.easeOut",
			onComplete: () => text.destroy(),
		});
	}

	private shrugMonster(monster: Monster): void {
		const sprite = this.monsterSprites.get(monster.id);
		if (!sprite) return;
		const baseX = sprite.x;
		this.tweens.add({
			targets: sprite,
			x: baseX + 6,
			duration: 55,
			yoyo: true,
			repeat: 5,
			onComplete: () => sprite.setX(baseX),
		});
	}

	private setupInput(): void {
		const kb = this.input.keyboard;
		if (!kb) throw new Error("FileScene requires keyboard input");
		this.movementKeys = createMovementKeys(this);
		this.keys = {
			enter: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
			esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
			shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
		};
		this.runKeys = {
			space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
			n: kb.addKey(Phaser.Input.Keyboard.KeyCodes.N),
			one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
			two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
			four: kb.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
		};
		this.walker = new ClickWalker(this, prefersReducedMotion());
		this.pointerInput = attachPointerInput(this, {
			interactables: () => this.clickInteractables(),
			enabled: () =>
				this.store.getState().mode === "file" && this.selection === null,
			onClick: this.onClick,
		});
	}

	private clickInteractables(): Interactable[] {
		const targets: Interactable[] = [
			{
				id: "exit",
				kind: "exit",
				pos: this.exitPortalPos,
				hitRadius: (PORTAL_ARCH_FRAME_SIZE * PORTAL_SCALE) / 2,
				arriveRadius: EXIT_ARRIVE_RADIUS,
			},
		];
		for (const monster of this.monsters) {
			if (monster.species === "will-o-wisp") continue; // cosmetic, never encounterable
			targets.push({
				id: monster.id,
				kind: "monster",
				pos: this.monsterPos(monster),
				hitRadius: (MONSTER_FILE_SIZE[monster.species] ?? 20) / 2 + 8,
				arriveRadius: MONSTER_ARRIVE_RADIUS,
				// A monster's click area overlaps the text it stands beside; it
				// wins that overlap, and there are no other interactables near it.
				priority: 1,
			});
		}
		return targets;
	}

	private onClick = (target: ClickTarget): void => {
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

	private onArrive(target: Interactable): void {
		if (target.kind === "exit") {
			this.exitToWorld();
			return;
		}
		if (target.kind !== "monster" || this.selection !== null) return;
		const monster = this.monsters.find((m) => m.id === target.id);
		if (monster) this.startEncounterFor(monster);
	}

	/** Hotbar opener — only while this file is the one being walked (mode "file"); same as pressing Enter here. */
	private onOpenerUse = (): void => {
		if (this.store.getState().mode !== "file") return;
		this.handleExit(true);
		if (!this.exiting) this.handleMonsterEncounterKey(true);
	};

	private setupCamera(): void {
		const minY = -EXIT_MARGIN - 100;
		const maxY = this.totalHeight() + 200;
		this.physics.world.setBounds(
			SCROLL_MIN_X,
			minY,
			SCROLL_MAX_X - SCROLL_MIN_X,
			maxY - minY,
		);
		this.cameras.main.setBounds(
			SCROLL_MIN_X,
			minY,
			SCROLL_MAX_X - SCROLL_MIN_X,
			maxY - minY,
		);
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.15);
	}

	update(_time: number, delta: number): void {
		const mode = this.store.getState().mode;
		if (mode !== "file") this.walker.cancel();
		if (mode === "editor") {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			return;
		}
		if (mode === "encounter") {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			// The only input the banner listens for — everything else (WASD,
			// bag/quill hotkeys) stays inert until it resolves into either the
			// editor or back to plain "file" mode.
			if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
				this.store.getState().endEncounter();
			}
			return;
		}
		if (mode === "run") {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			this.updateRun(delta);
			return;
		}
		let arrivedAt: Interactable | null = null;
		if (this.selection === null) {
			({ arrivedAt } = drivePlayer(
				this.player,
				this.movementKeys,
				this.walker,
				delta,
				this.playerTextures,
			));
		} else {
			this.walker.cancel();
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			this.handleSelectionExtend();
		}
		// A focused button (e.g. tabbed-to) gets this Enter natively too.
		const activationPressed =
			Phaser.Input.Keyboard.JustDown(this.keys.enter) &&
			activeFocusOwner() !== "control";
		this.handleExit(activationPressed);
		if (this.exiting) return;
		this.handleMonsterApproach();
		this.handleMonsterEncounterKey(activationPressed);
		if (arrivedAt) this.onArrive(arrivedAt);
		if (this.exiting) return;
		this.renderVisibleWindow();
		this.pointerInput.refreshHover();
	}

	private nearestLineToPlayer(): number {
		const raw = Math.round(this.player.body.y / LINE_HEIGHT);
		return Phaser.Math.Clamp(raw, 0, Math.max(this.lines.length - 1, 0));
	}

	private handleSelectionExtend(): void {
		if (!this.selection) return;
		const shiftDown = this.keys.shift.isDown;
		if (!shiftDown) return;
		let delta = 0;
		if (
			Phaser.Input.Keyboard.JustDown(
				this.movementKeys.cursors.up ?? this.movementKeys.w,
			)
		)
			delta = -1;
		if (
			Phaser.Input.Keyboard.JustDown(
				this.movementKeys.cursors.down ?? this.movementKeys.s,
			)
		)
			delta = 1;
		if (delta !== 0) {
			this.selection = extendSelection(
				this.selection,
				delta,
				this.lines.length,
			);
		}
	}

	/** Bag hotkey: start a selection at the player's current line, or confirm one already open. */
	private onBagUse = (): void => {
		if (this.selection === null) {
			this.selection = startSelection(this.nearestLineToPlayer());
			return;
		}
		const { start, end } = selectionRange(this.selection);
		const text = this.lines.slice(start, end + 1).join("\n");
		this.store.getState().addBagSlot({
			id: `${this.portalId}:${start}-${end}:${Date.now()}`,
			text,
			sourcePortalId: this.portalId,
			startLine: start,
			endLine: end,
		});
		this.selection = null;
	};

	/** Quill hotkey: open the editor overlay, caret starting at the player's current line. Ignored mid-selection so B and Q don't fight over the same moment. */
	private onQuillUse = (): void => {
		if (this.selection !== null) return;
		this.store.getState().openEditor({
			initialLine: this.nearestLineToPlayer(),
			language: this.file.language,
		});
	};

	// --- Run / parchment playback ----------------------------------------
	//
	// TraceProvider (the default, and the only provider a hosted build ever
	// includes — see systems/trace/) is called directly here rather than
	// through a provider interface: LocalRunProvider is a separate,
	// build-time-gated code path (cabn serve's own engine wiring), not a
	// runtime strategy this scene picks between. Wiring both through one
	// interface would mean the dead-code-eliminated branch still had to be
	// *referenced* from code every hosted build ships.

	/**
	 * Wand hotkey: asks the active ExecutionProvider (TraceProvider unless a
	 * `cabn serve --allow-exec` host page installed LocalRunProvider — see
	 * systems/execution/) for this file's steps, then starts a run. A no-op
	 * mid-selection (same guard as quill) or if there's nothing to trace (e.g.
	 * an empty file). `requestId` guards against a real run's network round
	 * trip resolving after the player has already stopped it (or left the
	 * file) — a stale response must never silently restart playback.
	 */
	private onWandUse = (): void => {
		if (this.selection !== null) return;
		if (this.store.getState().mode !== "file") return;
		const requestId = ++this.runRequestId;
		getActiveExecutionProvider()
			.run({
				content: this.lines.join("\n"),
				language: this.file.language,
				filePath: this.file.path,
			})
			.then((steps) => {
				if (requestId !== this.runRequestId) return; // superseded/stopped
				if (steps.length === 0) return;
				this.runState = runPlaybackReducer(createIdleRunPlaybackState(), {
					type: "START",
					steps,
				});
				this.runBlockedAtLine = null;
				this.createRunVisuals();
				this.store.getState().startRun(this.buildRunSnapshot());
				const step = currentStep(this.runState);
				if (step) this.onRunLineArrived(step.line);
			})
			.catch((err: unknown) => {
				console.error("cabn: run failed", err);
			});
	};

	private createRunVisuals(): void {
		this.runSpark = this.add
			.circle(RUN_SPARK_X, 0, RUN_SPARK_RADIUS, PALETTE.gold)
			.setDepth(5);
		this.tweens.add({
			targets: this.runSpark,
			alpha: 0.5,
			duration: 400,
			yoyo: true,
			repeat: -1,
		});
		this.runHighlight = this.add.graphics().setDepth(1.5);
		this.cameras.main.stopFollow();
		this.cameras.main.startFollow(this.runSpark, true, 0.08, 0.12);
	}

	private teardownRunVisuals(): void {
		this.runSpark?.destroy();
		this.runSpark = null;
		this.runHighlight?.destroy();
		this.runHighlight = null;
		this.cameras.main.stopFollow();
		this.cameras.main.startFollow(this.player.body, true, 0.1, 0.15);
	}

	private buildRunSnapshot() {
		const state = this.runState;
		const step = state ? currentStep(state) : undefined;
		return {
			totalSteps: state?.steps.length ?? 0,
			index: state?.index ?? 0,
			currentLine: step?.line ?? 0,
			status: state?.status ?? ("done" as const),
			speed: state?.speed ?? (1 as const),
			log: state?.log ?? [],
			blockedMessage: state?.blockedMessage,
			approximateLines: false,
		};
	}

	/** Moves the spark + highlight band to `line` (the camera eases there for free — it's following the spark with a lerp) and pauses the run in place if a monster is standing on it. One-shot per line via runBlockedAtLine, so pressing on past a block doesn't immediately re-trigger it. */
	private onRunLineArrived(line: number): void {
		const y = line * LINE_HEIGHT;
		this.runSpark?.setPosition(RUN_SPARK_X, y);
		this.runHighlight?.clear();
		this.runHighlight?.fillStyle(PALETTE.gold, 0.22);
		this.runHighlight?.fillRect(
			SCROLL_MIN_X,
			y - LINE_HEIGHT / 2,
			SCROLL_MAX_X - SCROLL_MIN_X,
			LINE_HEIGHT,
		);

		if (this.runBlockedAtLine === line) return;
		const blocker = this.monsters.find((m) => m.error.loc?.line === line);
		if (!blocker || !this.runState || this.runState.status === "done") return;
		this.runBlockedAtLine = line;
		this.runState = runPlaybackReducer(this.runState, {
			type: "BLOCK",
			message: `A ${blocker.species} blocks the way!`,
		});
		this.shrugMonster(blocker);
	}

	private updateRun(delta: number): void {
		if (!this.runState) return;
		const before = currentStep(this.runState)?.line;
		this.runState = runPlaybackReducer(this.runState, {
			type: "TICK",
			deltaMs: delta,
		});
		const after = currentStep(this.runState);
		if (after && after.line !== before) this.onRunLineArrived(after.line);

		if (Phaser.Input.Keyboard.JustDown(this.runKeys.space)) {
			this.runState = runPlaybackReducer(this.runState, {
				type: this.runState.status === "playing" ? "PAUSE" : "PLAY",
			});
		}
		if (Phaser.Input.Keyboard.JustDown(this.runKeys.n)) this.dispatchRunStep();
		if (Phaser.Input.Keyboard.JustDown(this.runKeys.one))
			this.dispatchRunSpeed(1);
		if (Phaser.Input.Keyboard.JustDown(this.runKeys.two))
			this.dispatchRunSpeed(2);
		if (Phaser.Input.Keyboard.JustDown(this.runKeys.four))
			this.dispatchRunSpeed(4);
		if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) this.onRunStop();

		this.store.getState().setRun(this.buildRunSnapshot());
	}

	private dispatchRunStep(): void {
		if (!this.runState) return;
		const before = currentStep(this.runState)?.line;
		this.runState = runPlaybackReducer(this.runState, { type: "STEP" });
		const after = currentStep(this.runState);
		if (after && after.line !== before) this.onRunLineArrived(after.line);
	}

	private dispatchRunSpeed(speed: RunSpeed): void {
		if (!this.runState) return;
		this.runState = runPlaybackReducer(this.runState, {
			type: "SET_SPEED",
			speed,
		});
	}

	/** RunOverlay's own buttons dispatch these same bus events the keyboard shortcuts do — one code path either way. */
	private onRunPlay = (): void => {
		if (!this.runState) return;
		this.runState = runPlaybackReducer(this.runState, { type: "PLAY" });
		this.store.getState().setRun(this.buildRunSnapshot());
	};

	private onRunPause = (): void => {
		if (!this.runState) return;
		this.runState = runPlaybackReducer(this.runState, { type: "PAUSE" });
		this.store.getState().setRun(this.buildRunSnapshot());
	};

	private onRunStep = (): void => {
		this.dispatchRunStep();
		this.store.getState().setRun(this.buildRunSnapshot());
	};

	private onRunSetSpeed = ({ speed }: { speed: RunSpeed }): void => {
		this.dispatchRunSpeed(speed);
		this.store.getState().setRun(this.buildRunSnapshot());
	};

	private onRunStop = (): void => {
		this.runRequestId++;
		this.teardownRunVisuals();
		this.runState = null;
		this.runBlockedAtLine = null;
		this.store.getState().stopRun();
	};

	/** EditorOverlay's Ctrl/Cmd-S — this scene's own lines/store copy is the source of truth for "what the file currently says", so both get updated here (WorldScene separately persists the override and redraws the arch marker in its own bus listener). */
	private onEditorSave = ({
		portalId,
		content,
	}: {
		portalId: string;
		content: string;
	}): void => {
		if (portalId !== this.portalId) return;
		this.applyLiveContent(content);
		this.store.getState().setActivePortalContent(content);
		this.resolveMonstersAfterSave(content);
	};

	/** WorldScene answering a "reset this file's edits" request for the file we're currently showing — swap back to the pristine content it hands us. */
	private onFileContentReset = ({
		portalId,
		content,
	}: {
		portalId: string;
		content: string;
	}): void => {
		if (portalId !== this.portalId) return;
		this.applyLiveContent(content);
	};

	/**
	 * Re-splits `this.lines` and invalidates the virtualized line cache so
	 * `renderVisibleWindow()` rebuilds every visible line from the new text
	 * next frame. Deliberately does not resize the parchment backing, path,
	 * or camera bounds (all sized off the *original* line count in create())
	 * — an edit that changes the line count keeps the old scroll extent until
	 * the file is re-entered. A live-resizing scroll world was out of scope
	 * for this pass; the content itself (and everywhere else that reads it)
	 * is always correct either way.
	 */
	private applyLiveContent(content: string): void {
		this.lines = content.split("\n");
		for (const container of this.activeLines.values()) container.destroy();
		this.activeLines.clear();
		this.currentWindow = { start: 0, end: 0 };
	}

	private static readonly HIGHLIGHT_MS = 1500;

	private onJumpToLine = ({ line }: { line: number }): void => {
		const clamped = Phaser.Math.Clamp(
			line,
			0,
			Math.max(this.lines.length - 1, 0),
		);
		this.walker.cancel();
		this.player.body.setPosition(PATH_X, clamped * LINE_HEIGHT);

		this.highlightGraphic?.destroy();
		const bg = this.add.graphics().setDepth(1.5);
		bg.fillStyle(PALETTE.gold, 0.25);
		bg.fillRect(
			SCROLL_MIN_X,
			clamped * LINE_HEIGHT - LINE_HEIGHT / 2,
			SCROLL_MAX_X - SCROLL_MIN_X,
			LINE_HEIGHT,
		);
		this.highlightGraphic = bg;
		this.time.delayedCall(FileScene.HIGHLIGHT_MS, () => {
			if (this.highlightGraphic === bg) this.highlightGraphic = null;
			bg.destroy();
		});
	};

	/**
	 * `activationPressed` (Enter) is read once in update() and threaded
	 * through here and handleMonsterEncounterKey() rather than each calling
	 * `Phaser.Input.Keyboard.JustDown` again — JustDown() clears the key's
	 * internal "just pressed" flag on the first read each frame, so a second
	 * independent read later in the same frame would always see it as false.
	 */
	private handleExit(activationPressed: boolean): void {
		if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
			if (this.selection !== null) {
				this.selection = null;
				return;
			}
			this.exitToWorld();
			return;
		}

		if (!activationPressed) return;
		const pos = { x: this.player.body.x, y: this.player.body.y };
		if (isWithinRadius(pos, this.exitPortalPos, EXIT_ENTER_RADIUS))
			this.exitToWorld();
	}

	private exitToWorld(): void {
		// scene.stop() is queued until the end of this step, so a click-walk
		// arriving at the arch in the same frame as an Enter press would
		// otherwise exit (and wake the world) twice.
		if (this.exiting) return;
		this.exiting = true;
		this.walker.cancel();
		this.store.getState().exitPortal();
		this.scene.stop();
		this.scene.wake(this.returnSceneKey);
	}

	private renderVisibleWindow(): void {
		const view = this.cameras.main.worldView;
		const nextWindow = computeLineWindow(
			view.y,
			view.height,
			LINE_HEIGHT,
			this.lines.length,
			BUFFER_LINES,
		);
		if (lineWindowsEqual(nextWindow, this.currentWindow)) return;
		this.syncWindow(nextWindow);
		this.currentWindow = nextWindow;
	}

	private syncWindow(next: LineWindow): void {
		for (const [index, container] of this.activeLines) {
			if (index < next.start || index >= next.end) {
				container.destroy();
				this.activeLines.delete(index);
			}
		}
		for (let index = next.start; index < next.end; index++) {
			if (!this.activeLines.has(index)) {
				this.activeLines.set(index, this.buildLine(index));
			}
		}
	}

	private buildLine(index: number): Phaser.GameObjects.Container {
		const y = index * LINE_HEIGHT - LINE_HEIGHT / 2;
		const objects: Phaser.GameObjects.GameObject[] = [];

		const gutter = this.add
			.text(GUTTER_RIGHT_X, 0, String(index + 1), {
				fontFamily: '"Courier New", monospace',
				fontSize: "11px",
				color: toCssColor(PALETTE.trail),
			})
			.setOrigin(1, 0);
		objects.push(gutter);

		const line = this.lines[index] ?? "";
		if (this.file.kind === "markdown") {
			objects.push(...this.buildMarkdownSegments(line));
		} else {
			objects.push(
				this.add.text(TEXT_X, 0, line.replace(/\t/g, "    "), {
					fontFamily: '"Courier New", monospace',
					fontSize: `${BASE_FONT_SIZE}px`,
					color: toCssColor(PALETTE.ink),
				}),
			);
		}

		const container = this.add.container(0, y, objects).setDepth(2);
		return container;
	}

	private buildMarkdownSegments(line: string): Phaser.GameObjects.GameObject[] {
		const enchanted = enchantMdLine(line);
		const objects: Phaser.GameObjects.GameObject[] = [];
		let x = TEXT_X;

		if (enchanted.isListItem) {
			const dot = this.add.circle(x + 4, 6, 3, PALETTE.biome.grove);
			objects.push(dot);
			x += 14;
		}

		for (const segment of enchanted.segments) {
			x = this.appendSegment(objects, segment, x);
		}
		return objects;
	}

	private appendSegment(
		objects: Phaser.GameObjects.GameObject[],
		segment: MdSegment,
		x: number,
	): number {
		if (segment.text === "") return x;

		const style = segmentTextStyle(segment.style);
		const text = this.add.text(x, 0, segment.text, style);

		if (segment.style === "code") {
			const box = this.add.graphics();
			box.fillStyle(PALETTE.parchmentDark, 1);
			box.fillRect(
				x - CODE_BOX_PAD_X,
				-1,
				text.width + CODE_BOX_PAD_X * 2,
				LINE_HEIGHT - 4,
			);
			box.setDepth(1);
			objects.push(box);
		}

		if (segment.style.startsWith("heading")) {
			text.setShadow(0, 0, toCssColor(PALETTE.gold), 5, false, true);
		}

		if (segment.style === "link") {
			const underline = this.add.graphics();
			underline.lineStyle(1, PALETTE.paleGhostBlue, 0.9);
			underline.lineBetween(
				x,
				LINE_HEIGHT / 2 - 6,
				x + text.width,
				LINE_HEIGHT / 2 - 6,
			);
			objects.push(underline);
		}

		objects.push(text);
		return x + text.width;
	}
}
