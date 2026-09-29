import type { Monster, PortalFile } from "@cabn/world-schema";
import {
	indentLess,
	insertNewlineAndIndent,
	insertTab,
	redo,
	undo,
} from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	type StateCommand,
	Text,
	Transaction,
	type TransactionSpec,
} from "@codemirror/state";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { ASSET_KEYS, PORTAL_ARCH_FRAME_SIZE } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnMode, CabnStore } from "../bridge/store.js";
import { attachGlow } from "../fx/GlowPipeline.js";
import { PALETTE, toCssColor } from "../palette.js";
import {
	attachPointerInput,
	type PointerInputHandle,
} from "../render/clickWalker.js";
import { dashedLine } from "../render/dashedLine.js";
import {
	addHoverBob,
	createMonsterSprite,
	playMonsterDefeat,
	playMonsterHit,
} from "../render/monsterSprite.js";
import { MONSTER_FILE_SIZE, PORTAL_SCALE } from "../render/scale.js";
import { checkMonsterFixed } from "../systems/battle.js";
import {
	type CaretLayout,
	type CaretMotion,
	columnFromPaintedSpans,
	type DeleteMotion,
	deletionRange,
	displayColumn,
	moveCaret,
	type PaintedSpan,
	pointFromPos,
	posFromPoint,
	wordRangeAt,
} from "../systems/caretMotion.js";
import type { ClickTarget, Interactable } from "../systems/clickWalk.js";
import {
	enchantMdLine,
	type MdSegment,
	type MdSegmentStyle,
} from "../systems/enchantMd.js";
import { getActiveExecutionProvider } from "../systems/execution/executionProvider.js";
import { isActiveFileDirty, saveActiveFile } from "../systems/fileBuffer.js";
import {
	type FileCaretAction,
	fileCaretAction,
} from "../systems/fileCaretKeys.js";
import {
	anchoredLine,
	monsterAnchors,
	setMonsterAnchors,
} from "../systems/lineAnchors.js";
import {
	computeLineWindow,
	type LineWindow,
	lineWindowsEqual,
} from "../systems/lineWindow.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import {
	createIdleRunPlaybackState,
	currentStep,
	type RunPlaybackState,
	type RunSpeed,
	runPlaybackReducer,
} from "../systems/runPlayback.js";
import { detectMac } from "../systems/spellbookTools.js";
import { createDefaultToolRegistry } from "../systems/tools.js";
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

// A vertical parchment scroll beside a line-numbered page of the file's
// text. Since 2026-09-28 the page is written on directly: a real text caret
// (clicked into place, moved by arrow keys) edits the store's shared buffer
// — see systems/fileBuffer.ts — and the camera follows the caret.
const LINE_HEIGHT = 20;
const GUTTER_RIGHT_X = 54;
const TEXT_X = 64;
const PATH_X = -60;
const SCROLL_MIN_X = -140;
const SCROLL_MAX_X = 760;
const BUFFER_LINES = 20;
const EXIT_MARGIN = 160;
const BASE_FONT_SIZE = 13;
const MONO_FONT = '"Courier New", monospace';
const CODE_BOX_PAD_X = 3;
const CARET_BLINK_MS = 530;
const DOUBLE_CLICK_MS = 400;
/** Right of here (the gutter and the text) the pointer is an I-beam; the path lane keeps the default cursor. */
const TEXT_CURSOR_MIN_X = GUTTER_RIGHT_X - 36;

// A monster stands just left of the text, between the gutter and the path —
// close enough to the path that walking down it reads as "walking past" each
// one in turn.
const MONSTER_X = PATH_X + 50;
const MONSTER_APPROACH_RADIUS = 90;
/** Alt+Enter (or the hotbar's Use) fights the nearest monster within this many lines of the caret. */
const MONSTER_REACH_LINES = 2;
const ENCOUNTER_BANNER_MS = 1400;

// The run "spark" travels the same path lane, one line at a time — sharing
// PATH_X reads as "the same road", not a separate lane.
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
		fontFamily: MONO_FONT,
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

interface RenderedLine {
	container: Phaser.GameObjects.Container;
	/** Raw/enchanted flag + caret-line flag + text — rebuilt only when this changes. */
	key: string;
	/** Enchanted lines only: where each run of source text was painted, for placing the caret from a click. */
	spans?: PaintedSpan[];
}

export class FileScene extends Phaser.Scene {
	private portalId = "";
	private file!: PortalFile;
	private returnSceneKey = "world";
	private store!: StoreApi<CabnStore>;
	private bus!: CabnBus;

	private exitPortalPos = { x: PATH_X, y: -EXIT_MARGIN };

	private activeLines = new Map<number, RenderedLine>();
	private currentWindow: LineWindow = { start: 0, end: 0 };
	private linesDirty = true;
	private caretDirty = true;

	private backingGraphic!: Phaser.GameObjects.Graphics;
	private pathGraphic!: Phaser.GameObjects.Graphics;
	/** Line count and page width the backing/path/camera bounds were last sized for — both grow live as the buffer does. */
	private extentLines = 0;
	private pageRight = SCROLL_MAX_X;

	/** The camera's follow target, kept on the caret. */
	private caretTarget!: Phaser.GameObjects.Zone;
	private caretGraphic!: Phaser.GameObjects.Graphics;
	private selectionGraphic!: Phaser.GameObjects.Graphics;
	private charWidth = 8;
	/** Display column a run of Up/Down presses holds; cleared by any other caret change. */
	private goalColumn: number | undefined;
	/** False after a wheel scroll unhooks the camera; the next caret change re-hooks it. */
	private followingCaret = true;
	private blinkEpoch = 0;
	private reducedMotion = false;
	private isMac = false;
	/**
	 * The caret's keyboard: an invisible textarea kept focused while the page
	 * is being written on. A focused text field is what keyboardFocusGate
	 * already treats as "every key belongs to the page" — it switches
	 * Phaser's keyboard manager off, so no world/file hotkey double-fires,
	 * and IME composition, dead keys and clipboard events work natively.
	 */
	private caretInput: HTMLTextAreaElement | null = null;
	private caretInputPos = { left: -1, top: -1 };
	private dragAnchor: number | null = null;
	private lastClick = { time: 0, pos: -1 };
	private readonly toolRegistry = createDefaultToolRegistry();

	private highlightGraphic: Phaser.GameObjects.Graphics | null = null;
	private unsubscribeStore: (() => void) | null = null;

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
	private monsterBaseY = new Map<string, number>();
	private monstersInRange = new Set<string>();
	/** The monster the currently-open encounter banner/quill session is about, if any — set by clicking a monster or Alt+Enter beside one, cleared once the encounter resolves (fixed or cancelled). */
	private encounterMonsterId: string | null = null;
	private monsterTooltip!: Phaser.GameObjects.Container;
	private monsterTooltipText!: Phaser.GameObjects.Text;

	private keys!: {
		esc: Phaser.Input.Keyboard.Key;
	};
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
		this.returnSceneKey = data.returnSceneKey;
		this.store = this.registry.get("store");
		this.bus = this.registry.get("bus");
		this.activeLines = new Map();
		this.currentWindow = { start: 0, end: 0 };
		this.linesDirty = true;
		this.caretDirty = true;
		this.extentLines = 0;
		this.pageRight = SCROLL_MAX_X;
		this.goalColumn = undefined;
		this.followingCaret = true;
		this.dragAnchor = null;
		this.lastClick = { time: 0, pos: -1 };
		this.caretInputPos = { left: -1, top: -1 };
		this.highlightGraphic = null;
		this.monsters = [...data.monsters];
		this.worldFiles = new Set(data.worldFiles);
		this.monsterSprites = new Map();
		this.monsterBobTweens = new Map();
		this.monsterBaseY = new Map();
		this.monstersInRange = new Set();
		this.encounterMonsterId = null;
		this.exiting = false;
	}

	create(): void {
		this.reducedMotion = prefersReducedMotion();
		this.isMac = detectMac(
			typeof navigator === "undefined" ? "" : navigator.platform,
		);
		this.measureCharWidth();
		this.backingGraphic = this.add.graphics().setDepth(0);
		this.pathGraphic = this.add.graphics().setDepth(1);
		this.selectionGraphic = this.add.graphics().setDepth(1.4);
		this.caretGraphic = this.add.graphics().setDepth(2.6);
		this.syncExtent();
		this.drawExitPortal();
		this.anchorMonsters();
		this.buildMonsterSprites();
		this.createMonsterTooltip();
		this.setupInput();
		this.setupCamera();
		this.createCaretInput();
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
		this.bus.on("tool:opener-use", this.onOpenerUse);
		this.bus.on("file:leave", this.onFileLeave);
		this.unsubscribeStore = this.store.subscribe((state, prev) => {
			if (state.mode !== prev.mode) {
				// Not a bus event: closing the editor is a store.closeEditor() call
				// from EditorOverlay, which only touches `mode` — a subscription is
				// the one thing that reacts uniformly no matter which code path
				// changed it.
				this.syncKeyboardForMode(state.mode);
				if (state.mode === "file") this.goalColumn = undefined;
			}
			// The player can leave "editor"/"encounter" without a fix (Esc,
			// discard) — either way, once we're back in plain "file" mode no
			// encounter session is in progress anymore.
			if (state.mode === "file" && prev.mode !== "file") {
				this.encounterMonsterId = null;
			}
			if (state.activeFileState !== prev.activeFileState) {
				this.onBufferChanged(prev.activeFileState, state.activeFileState);
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
		this.bus.off("tool:opener-use", this.onOpenerUse);
		this.bus.off("file:leave", this.onFileLeave);
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		this.destroyCaretInput();
		this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
		this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
		this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp);
		this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel);
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
	 * disabled outright (not just "movement ignores mode") so Esc and the run
	 * keys never reach FileScene while the player is typing in CodeMirror, and
	 * CodeMirror's own keydown handling is never fought for the same keys.
	 * `resetKeys()` on disable matters because Phaser's global keyboard queue
	 * is drained once per step regardless of whether a disabled plugin
	 * consumed it — without it, a key already held when the editor opens
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

	// --- Buffer access ---------------------------------------------------

	private get buffer(): EditorState | null {
		return this.store.getState().activeFileState;
	}

	private get doc(): Text {
		return this.buffer?.doc ?? Text.empty;
	}

	private get layout(): CaretLayout {
		return {
			lineHeight: LINE_HEIGHT,
			textX: TEXT_X,
			charWidth: this.charWidth,
		};
	}

	private commit(...specs: TransactionSpec[]): void {
		const state = this.buffer;
		if (!state) return;
		this.store.getState().setActiveFileState(state.update(...specs).state);
	}

	private runCommand(command: StateCommand): void {
		const state = this.buffer;
		if (!state) return;
		command({
			state,
			dispatch: (tr) => this.store.getState().setActiveFileState(tr.state),
		});
	}

	private caretLine(): number {
		const state = this.buffer;
		if (!state) return 0;
		return state.doc.lineAt(state.selection.main.head).number - 1;
	}

	private onBufferChanged(
		prev: EditorState | null,
		next: EditorState | null,
	): void {
		this.linesDirty = true;
		this.caretDirty = true;
		this.blinkEpoch = this.time.now;
		if (!next || this.exiting) return;
		if (!prev || prev.doc !== next.doc) {
			this.syncExtent();
			this.syncMonsterSprites();
		}
		const caret = pointFromPos(next.doc, next.selection.main.head, this.layout);
		this.caretTarget?.setPosition(caret.x, caret.y);
		this.followCaret();
	}

	private measureCharWidth(): void {
		const sample = "M".repeat(40);
		const probe = this.add.text(0, 0, sample, {
			fontFamily: MONO_FONT,
			fontSize: `${BASE_FONT_SIZE}px`,
		});
		this.charWidth = probe.width / sample.length || 8;
		probe.destroy();
	}

	private totalHeight(): number {
		return Math.max(this.doc.lines, 1) * LINE_HEIGHT;
	}

	/**
	 * Resizes the parchment, path and camera bounds to the buffer: grows the
	 * page to the widest line (never shrinks it mid-visit — a page snapping
	 * narrower under the caret reads as a glitch) and tracks the line count
	 * both ways.
	 */
	private syncExtent(): void {
		const doc = this.doc;
		let widest = 0;
		for (let i = 1; i <= doc.lines; i++) {
			const text = doc.line(i).text;
			if (text.length * 4 * this.charWidth + TEXT_X < this.pageRight) continue;
			widest = Math.max(widest, displayColumn(text, text.length));
		}
		const right = Math.max(
			this.pageRight,
			TEXT_X + widest * this.charWidth + 80,
		);
		if (doc.lines === this.extentLines && right === this.pageRight) return;
		this.extentLines = doc.lines;
		this.pageRight = right;
		this.drawParchmentBacking();
		this.drawPath();
		this.applyCameraBounds();
	}

	private drawParchmentBacking(): void {
		const height = this.totalHeight();
		const g = this.backingGraphic;
		g.clear();
		g.fillStyle(PALETTE.parchment, 1);
		g.fillRect(
			SCROLL_MIN_X,
			-EXIT_MARGIN,
			this.pageRight - SCROLL_MIN_X,
			height + EXIT_MARGIN + 200,
		);
		// Faint seams every ~20 lines read as "tiled parchment" without tiling an
		// actual texture — cheap (one Graphics object) regardless of file length.
		g.lineStyle(1, PALETTE.trail, 0.08);
		for (let y = 0; y < height; y += LINE_HEIGHT * 20) {
			g.lineBetween(SCROLL_MIN_X, y, this.pageRight, y);
		}
	}

	private drawPath(): void {
		const g = this.pathGraphic;
		g.clear();
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

	// --- Monsters / battle loop -----------------------------------------

	/** Hands the monsters' annotated lines to the buffer, which maps them through every edit from here on (systems/lineAnchors.ts) — kept out of undo history so Cmd/Ctrl+Z never "undoes" the visit's setup. */
	private anchorMonsters(): void {
		if (!this.buffer || this.monsters.length === 0) return;
		this.commit({
			effects: setMonsterAnchors.of(
				this.monsters.map((m) => ({ id: m.id, line: m.error.loc?.line ?? 0 })),
			),
			annotations: Transaction.addToHistory.of(false),
		});
	}

	/** The monster's line in the buffer as it is now, not as it was annotated — edits above it move it. */
	private monsterLine(monster: Monster): number {
		const state = this.buffer;
		const line = state
			? anchoredLine(state.field(monsterAnchors, false), state.doc, monster.id)
			: undefined;
		return line ?? monster.error.loc?.line ?? 0;
	}

	private monsterPos(monster: Monster): { x: number; y: number } {
		return { x: MONSTER_X, y: this.monsterLine(monster) * LINE_HEIGHT };
	}

	/** Moves each sprite to its monster's current line; the hover bob tweens an absolute y, so it's restarted around the new one. */
	private syncMonsterSprites(): void {
		for (const monster of this.monsters) {
			const sprite = this.monsterSprites.get(monster.id);
			const bob = this.monsterBobTweens.get(monster.id);
			if (!sprite || !bob) continue;
			const y = this.monsterPos(monster).y;
			const baseY = this.monsterBaseY.get(monster.id);
			if (baseY === y) continue;
			bob.stop();
			sprite.setY(y);
			this.monsterBaseY.set(monster.id, y);
			this.monsterBobTweens.set(
				monster.id,
				addHoverBob(this, sprite, monster.species === "will-o-wisp" ? 6 : 3),
			);
		}
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
			this.monsterBaseY.set(monster.id, pos.y);
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
			fontFamily: MONO_FONT,
			fontSize: "10px",
			color: toCssColor(PALETTE.ink),
			wordWrap: { width: width - 16 },
		});
		this.monsterTooltip = this.add
			.container(0, 0, [bg, this.monsterTooltipText])
			.setDepth(6)
			.setVisible(false);
	}

	/** A speech-bubble tooltip near the closest monster to the caret's line, same "closest one wins" rule as WorldScene's arch preview. Not an encounter — moving the caret away just hides it again. */
	private handleMonsterApproach(): void {
		const caretPos = { x: MONSTER_X, y: this.caretLine() * LINE_HEIGHT };
		let closest: { monster: Monster; dist: number } | null = null;
		this.monstersInRange = new Set();

		for (const monster of this.monsters) {
			const pos = this.monsterPos(monster);
			const dist = Phaser.Math.Distance.Between(
				caretPos.x,
				caretPos.y,
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
		// Out in the page's right margin on the monster's row: beside the
		// monster it sat right over the error line the caret is there to fix.
		this.monsterTooltip.setPosition(
			Math.max(TEXT_X + 380, this.pageRight - 236),
			pos.y - 23,
		);
		this.monsterTooltip.setVisible(true);
	}

	/**
	 * Alt+Enter / the hotbar's Use: fight the nearest monster within
	 * MONSTER_REACH_LINES of the caret. Plain Enter can't do this anymore — it
	 * inserts a newline now that the page is written on directly. Wisps are
	 * excluded outright — they're cosmetic, never encounterable.
	 */
	private interactAtCaret(): void {
		const caretLine = this.caretLine();
		let nearest: { monster: Monster; lines: number } | null = null;
		for (const monster of this.monsters) {
			if (monster.species === "will-o-wisp") continue; // cosmetic, never encounterable
			const lines = Math.abs(this.monsterLine(monster) - caretLine);
			if (lines <= MONSTER_REACH_LINES && (!nearest || lines < nearest.lines)) {
				nearest = { monster, lines };
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
				initialLine: this.monsterLine(monster),
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
			this.shrugMonster(stillEncountered, true);
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
			if (!playMonsterDefeat(this, sprite)) {
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
				fontFamily: MONO_FONT,
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

	/** `hit`: a save that didn't fix it still landed a blow, so the hit frame flashes; a run the monster blocks only gets the shrug. */
	private shrugMonster(monster: Monster, hit = false): void {
		const sprite = this.monsterSprites.get(monster.id);
		if (!sprite) return;
		if (hit) playMonsterHit(this, sprite);
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

	// --- Input -----------------------------------------------------------

	private setupInput(): void {
		const kb = this.input.keyboard;
		if (!kb) throw new Error("FileScene requires keyboard input");
		// Only read while the caret isn't writing (an encounter banner, a run):
		// the rest of the time keyboardFocusGate has Phaser's keyboard off.
		this.keys = {
			esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
		};
		this.runKeys = {
			space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
			n: kb.addKey(Phaser.Input.Keyboard.KeyCodes.N),
			one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
			two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
			four: kb.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
		};
		this.pointerInput = attachPointerInput(this, {
			interactables: () => this.clickInteractables(),
			enabled: () =>
				this.store.getState().mode === "file" &&
				!this.store.getState().fileLeavePrompt,
			onClick: this.onClick,
			groundCursor: (point) =>
				point.x >= TEXT_CURSOR_MIN_X && point.y >= -LINE_HEIGHT / 2
					? "text"
					: "",
		});
		this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
		this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
		this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp);
		this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel);
	}

	private clickInteractables(): Interactable[] {
		const targets: Interactable[] = [
			{
				id: "exit",
				kind: "exit",
				pos: this.exitPortalPos,
				hitRadius: (PORTAL_ARCH_FRAME_SIZE * PORTAL_SCALE) / 2,
				arriveRadius: 0,
			},
		];
		for (const monster of this.monsters) {
			if (monster.species === "will-o-wisp") continue; // cosmetic, never encounterable
			targets.push({
				id: monster.id,
				kind: "monster",
				pos: this.monsterPos(monster),
				hitRadius: (MONSTER_FILE_SIZE[monster.species] ?? 20) / 2 + 8,
				arriveRadius: 0,
				// A monster's click area overlaps the text it stands beside; it
				// wins that overlap, and there are no other interactables near it.
				priority: 1,
			});
		}
		return targets;
	}

	/** Clicks no longer walk anywhere: the arch and monsters act at once, anything else places the caret (Shift extends, a double click selects a word). */
	private onClick = (target: ClickTarget): void => {
		if (target.kind === "interactable") {
			if (target.target.kind === "exit") {
				this.requestExit();
				return;
			}
			const monster = this.monsters.find((m) => m.id === target.target.id);
			if (monster) this.startEncounterFor(monster);
			return;
		}
		const state = this.buffer;
		if (!state) return;
		const pos = this.posAtPoint(state.doc, target.point);
		const now = this.time.now;
		const isDouble =
			now - this.lastClick.time < DOUBLE_CLICK_MS && this.lastClick.pos === pos;
		this.lastClick = { time: now, pos };
		this.goalColumn = undefined;
		if (isDouble) {
			const word = wordRangeAt(state.doc, pos);
			this.dragAnchor = null;
			this.commit({ selection: EditorSelection.single(word.from, word.to) });
			return;
		}
		const shift = (this.input.activePointer.event as MouseEvent | undefined)
			?.shiftKey;
		const anchor = shift ? state.selection.main.anchor : pos;
		this.dragAnchor = anchor;
		this.commit({
			selection: EditorSelection.single(anchor, pos),
			userEvent: "select.pointer",
		});
	};

	private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
		if (this.dragAnchor === null || !pointer.isDown) return;
		const state = this.buffer;
		if (!state) return;
		const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
		const pos = this.posAtPoint(state.doc, world);
		if (pos === state.selection.main.head) return;
		this.commit({
			selection: EditorSelection.single(this.dragAnchor, pos),
			userEvent: "select.pointer",
		});
	};

	/**
	 * A click on an enchanted markdown line reads the column off what was
	 * painted there (systems/caretMotion.ts's columnFromPaintedSpans): the raw
	 * monospace grid posFromPoint uses doesn't match its wider headings or
	 * its hidden markup, and the line switches to raw source the moment the
	 * caret lands on it — so the grid put the caret columns away from the
	 * glyph that was clicked.
	 */
	private posAtPoint(doc: Text, point: { x: number; y: number }): number {
		const pos = posFromPoint(doc, point, this.layout);
		const row = Math.floor((point.y + LINE_HEIGHT / 2) / LINE_HEIGHT);
		if (row < 0 || row >= doc.lines) return pos;
		const spans = this.activeLines.get(row)?.spans;
		if (!spans) return pos;
		const line = doc.line(row + 1);
		return (
			line.from + columnFromPaintedSpans(spans, point.x, TEXT_X, line.length)
		);
	}

	private onPointerUp = (): void => {
		this.dragAnchor = null;
	};

	private onWheel = (
		_pointer: Phaser.Input.Pointer,
		_over: unknown,
		_dx: number,
		dy: number,
	): void => {
		if (this.store.getState().mode !== "file") return;
		const cam = this.cameras.main;
		cam.stopFollow();
		this.followingCaret = false;
		cam.scrollY += dy;
	};

	private followCaret(): void {
		if (this.followingCaret || this.runState) return;
		this.followingCaret = true;
		this.cameras.main.startFollow(this.caretTarget, true, 0.2, 0.2);
	}

	private createCaretInput(): void {
		const parent = this.game.canvas.parentElement;
		if (!parent || typeof document === "undefined") return;
		const el = document.createElement("textarea");
		el.setAttribute("aria-label", `Edit ${this.file.path}`);
		el.setAttribute("data-testid", "cabn-file-caret-input");
		el.setAttribute("autocomplete", "off");
		el.setAttribute("autocorrect", "off");
		el.setAttribute("autocapitalize", "off");
		el.setAttribute("wrap", "off");
		el.spellcheck = false;
		Object.assign(el.style, {
			position: "absolute",
			left: "0px",
			top: "0px",
			width: "2px",
			height: `${LINE_HEIGHT}px`,
			padding: "0",
			margin: "0",
			border: "0",
			outline: "none",
			resize: "none",
			overflow: "hidden",
			opacity: "0",
			caretColor: "transparent",
			pointerEvents: "none",
			whiteSpace: "pre",
			fontSize: `${BASE_FONT_SIZE}px`,
			zIndex: "1",
		});
		el.addEventListener("keydown", this.onCaretKeyDown);
		el.addEventListener("input", this.onCaretInput);
		el.addEventListener("compositionend", this.onCaretCompositionEnd);
		el.addEventListener("copy", this.onCaretCopy);
		el.addEventListener("cut", this.onCaretCut);
		el.addEventListener("paste", this.onCaretPaste);
		parent.appendChild(el);
		this.caretInput = el;
	}

	private destroyCaretInput(): void {
		const el = this.caretInput;
		if (!el) return;
		el.removeEventListener("keydown", this.onCaretKeyDown);
		el.removeEventListener("input", this.onCaretInput);
		el.removeEventListener("compositionend", this.onCaretCompositionEnd);
		el.removeEventListener("copy", this.onCaretCopy);
		el.removeEventListener("cut", this.onCaretCut);
		el.removeEventListener("paste", this.onCaretPaste);
		el.blur();
		el.remove();
		this.caretInput = null;
	}

	/**
	 * The caret writes whenever the page is the thing in front of the
	 * player: plain file mode with no panel, prompt or other text field
	 * taking the keyboard. Otherwise the textarea lets go, which also hands
	 * Phaser's keys back for the encounter banner's Esc and the run keys.
	 * Re-grabbing on every frame covers focus falling to <body> after a
	 * canvas click or a hotbar button blurring itself.
	 */
	private syncCaretFocus(mode: CabnMode): void {
		const input = this.caretInput;
		if (!input || typeof document === "undefined") return;
		const s = this.store.getState();
		const writing =
			mode === "file" &&
			!this.exiting &&
			!s.fileLeavePrompt &&
			!s.searchOpen &&
			!s.spyglassOpen &&
			!s.bagOpen &&
			s.pensievePortalId === null &&
			s.activeFileState !== null;
		const focused = document.activeElement === input;
		if (writing && !focused && activeFocusOwner() !== "text") {
			input.focus({ preventScroll: true });
		} else if (!writing && focused) {
			input.blur();
		}
	}

	private onCaretKeyDown = (event: KeyboardEvent): void => {
		// A panel's capture-phase Esc (spyglass/orb/bag) already handled it.
		if (event.defaultPrevented) return;
		if (this.store.getState().mode !== "file" || this.exiting) return;
		const action = fileCaretAction(event, this.isMac);
		if (action.kind === "passthrough") return;
		event.preventDefault();
		this.applyCaretAction(action);
	};

	private applyCaretAction(action: FileCaretAction): void {
		if (action.kind !== "move") this.goalColumn = undefined;
		switch (action.kind) {
			case "move":
				this.moveCaretBy(action.motion, action.extend);
				return;
			case "insert":
				this.insertText(action.text, "input.type");
				return;
			case "newline":
				this.runCommand(insertNewlineAndIndent);
				return;
			case "indent":
				this.runCommand(insertTab);
				return;
			case "dedent":
				this.runCommand(indentLess);
				return;
			case "delete":
				this.deleteBy(action.motion);
				return;
			case "undo":
				this.runCommand(undo);
				return;
			case "redo":
				this.runCommand(redo);
				return;
			case "save":
				saveActiveFile(this.store, this.bus);
				return;
			case "selectAll":
				this.commit({
					selection: EditorSelection.single(0, this.doc.length),
				});
				return;
			case "escape": {
				const main = this.buffer?.selection.main;
				if (main && !main.empty) {
					this.commit({ selection: EditorSelection.cursor(main.head) });
					return;
				}
				this.requestExit();
				return;
			}
			case "interact":
				this.interactAtCaret();
				return;
			case "tool":
				this.toolRegistry.dispatch(action.toolId, {
					store: this.store,
					bus: this.bus,
				});
				return;
			case "pasteSlot": {
				const slot = this.store.getState().bagSlots[action.index];
				if (slot) this.insertText(slot.text, "input.paste");
				return;
			}
			case "passthrough":
				return;
		}
	}

	private moveCaretBy(motion: CaretMotion, extend: boolean): void {
		const state = this.buffer;
		if (!state) return;
		const main = state.selection.main;
		const result = moveCaret(
			state.doc,
			{ anchor: main.anchor, head: main.head },
			motion,
			{
				extend,
				goalColumn: this.goalColumn,
				pageLines: Math.max(
					1,
					Math.floor(this.cameras.main.height / LINE_HEIGHT) - 2,
				),
			},
		);
		this.commit({
			selection: EditorSelection.single(result.range.anchor, result.range.head),
			userEvent: "select",
		});
		this.goalColumn = result.goalColumn;
	}

	private insertText(text: string, userEvent: string): void {
		const state = this.buffer;
		if (!state || text === "") return;
		this.commit(state.replaceSelection(text.replace(/\r\n?/g, "\n")), {
			userEvent,
		});
	}

	private deleteBy(motion: DeleteMotion): void {
		const state = this.buffer;
		if (!state) return;
		const main = state.selection.main;
		const range = deletionRange(
			state.doc,
			{ anchor: main.anchor, head: main.head },
			motion,
		);
		if (!range) return;
		const backward =
			motion === "charLeft" || motion === "wordLeft" || motion === "lineStart";
		this.commit({
			changes: range,
			selection: EditorSelection.cursor(range.from),
			userEvent: backward ? "delete.backward" : "delete.forward",
		});
	}

	private selectedText(): string {
		const state = this.buffer;
		if (!state) return "";
		const { from, to } = state.selection.main;
		return state.doc.sliceString(from, to);
	}

	/** IME output, dead-key accents and the emoji picker land here — plain typing is handled on keydown and never reaches the textarea's value. */
	private onCaretInput = (event: Event): void => {
		const input = this.caretInput;
		if (!input || (event as InputEvent).isComposing) return;
		const value = input.value;
		input.value = "";
		if (value) this.insertText(value, "input.type");
	};

	private onCaretCompositionEnd = (event: CompositionEvent): void => {
		if (this.caretInput) this.caretInput.value = "";
		if (event.data) this.insertText(event.data, "input.type.compose");
	};

	private onCaretCopy = (event: ClipboardEvent): void => {
		const text = this.selectedText();
		if (!text || !event.clipboardData) return;
		event.clipboardData.setData("text/plain", text);
		event.preventDefault();
	};

	private onCaretCut = (event: ClipboardEvent): void => {
		const text = this.selectedText();
		if (!text || !event.clipboardData) return;
		event.clipboardData.setData("text/plain", text);
		event.preventDefault();
		this.deleteBy("charLeft");
	};

	private onCaretPaste = (event: ClipboardEvent): void => {
		const text = event.clipboardData?.getData("text/plain") ?? "";
		event.preventDefault();
		this.insertText(text, "input.paste");
	};

	/** Hotbar opener (Use) — same as Alt+Enter here: fight the monster beside the caret. */
	private onOpenerUse = (): void => {
		if (this.store.getState().mode !== "file") return;
		this.interactAtCaret();
	};

	private setupCamera(): void {
		const cam = this.cameras.main;
		this.applyCameraBounds();
		this.caretTarget = this.add.zone(TEXT_X, 0, 1, 1);
		cam.startFollow(this.caretTarget, true, 0.2, 0.2);
		this.applyCaretDeadzone();
	}

	/** Editor-style scrolling: the camera only moves once the caret nears an edge, instead of re-centring on every arrow press. */
	private applyCaretDeadzone(): void {
		const cam = this.cameras.main;
		cam.setDeadzone(cam.width * 0.7, cam.height * 0.55);
	}

	private applyCameraBounds(): void {
		if (!this.cameras?.main) return;
		const minY = -EXIT_MARGIN - 100;
		const maxY = this.totalHeight() + 200;
		this.cameras.main.setBounds(
			SCROLL_MIN_X,
			minY,
			this.pageRight - SCROLL_MIN_X,
			maxY - minY,
		);
	}

	update(_time: number, delta: number): void {
		const mode = this.store.getState().mode;
		this.syncCaretFocus(mode);
		if (this.exiting) return;
		this.renderVisibleWindow();
		if (mode === "editor") return;
		if (mode === "encounter") {
			// The only input the banner listens for — everything else stays
			// inert until it resolves into either the editor or back to plain
			// "file" mode.
			if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
				this.store.getState().endEncounter();
			}
			return;
		}
		if (mode === "run") {
			this.updateRun(delta);
			return;
		}
		this.handleMonsterApproach();
		this.positionCaretInput();
		this.pointerInput.refreshHover();
	}

	/** Keeps the (invisible) textarea over the painted caret so an IME's candidate window opens beside it. */
	private positionCaretInput(): void {
		const input = this.caretInput;
		const state = this.buffer;
		if (!input || !state) return;
		const cam = this.cameras.main;
		const canvas = this.game.canvas;
		const scale = canvas.width > 0 ? canvas.clientWidth / canvas.width : 1;
		const caret = pointFromPos(
			state.doc,
			state.selection.main.head,
			this.layout,
		);
		const left = Math.round(
			canvas.offsetLeft + (caret.x - cam.worldView.x) * cam.zoom * scale,
		);
		const top = Math.round(
			canvas.offsetTop +
				(caret.y - LINE_HEIGHT / 2 - cam.worldView.y) * cam.zoom * scale,
		);
		if (left === this.caretInputPos.left && top === this.caretInputPos.top)
			return;
		this.caretInputPos = { left, top };
		input.style.left = `${left}px`;
		input.style.top = `${top}px`;
	}

	/** Bag hotkey (Alt+B while writing): the selection, or the caret's whole line, goes into a bag slot. */
	private onBagUse = (): void => {
		const state = this.buffer;
		if (!state) return;
		const { doc } = state;
		const { from, to } = state.selection.main;
		const startLine = doc.lineAt(from).number - 1;
		const endLine = doc.lineAt(to).number - 1;
		const text =
			from === to ? doc.lineAt(from).text : doc.sliceString(from, to);
		this.store.getState().addBagSlot({
			id: `${this.portalId}:${startLine}-${endLine}:${Date.now()}`,
			text,
			sourcePortalId: this.portalId,
			startLine,
			endLine,
		});
	};

	/** Quill hotkey: open the spellbook on the same buffer, at the same caret. */
	private onQuillUse = (): void => {
		if (this.store.getState().mode !== "file") return;
		this.store.getState().openEditor({ language: this.file.language });
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
	 * systems/execution/) for the buffer's steps — unsaved edits included,
	 * same as the spellbook's own Run — then starts a run. A no-op if there's
	 * nothing to trace (e.g. an empty file). `requestId` guards against a real
	 * run's network round trip resolving after the player has already stopped
	 * it (or left the file) — a stale response must never silently restart
	 * playback.
	 */
	private onWandUse = (): void => {
		if (this.store.getState().mode !== "file") return;
		const requestId = ++this.runRequestId;
		getActiveExecutionProvider()
			.run({
				content: this.doc.toString(),
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
		const cam = this.cameras.main;
		cam.stopFollow();
		cam.setDeadzone();
		cam.startFollow(this.runSpark, true, 0.08, 0.12);
	}

	private teardownRunVisuals(): void {
		this.runSpark?.destroy();
		this.runSpark = null;
		this.runHighlight?.destroy();
		this.runHighlight = null;
		const cam = this.cameras.main;
		cam.stopFollow();
		cam.startFollow(this.caretTarget, true, 0.2, 0.2);
		this.applyCaretDeadzone();
		this.followingCaret = true;
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
			this.pageRight - SCROLL_MIN_X,
			LINE_HEIGHT,
		);

		if (this.runBlockedAtLine === line) return;
		const blocker = this.monsters.find((m) => this.monsterLine(m) === line);
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
		this.runState = null;
		this.teardownRunVisuals();
		this.runBlockedAtLine = null;
		this.store.getState().stopRun();
	};

	/**
	 * Either view's save (the file view's Cmd/Ctrl+S, the spellbook's) —
	 * `setActivePortalContent` marks the shared buffer saved; WorldScene
	 * separately persists the override and redraws the arch marker in its
	 * own bus listener.
	 */
	private onEditorSave = ({
		portalId,
		content,
	}: {
		portalId: string;
		content: string;
	}): void => {
		if (portalId !== this.portalId) return;
		this.store.getState().setActivePortalContent(content);
		this.resolveMonstersAfterSave(content);
	};

	private onFileLeave = ({ save }: { save: boolean }): void => {
		this.store.getState().setFileLeavePrompt(false);
		if (save) saveActiveFile(this.store, this.bus);
		this.exitToWorld();
	};

	private static readonly HIGHLIGHT_MS = 1500;

	private onJumpToLine = ({ line }: { line: number }): void => {
		const doc = this.doc;
		const clamped = Phaser.Math.Clamp(line, 0, Math.max(doc.lines - 1, 0));
		this.goalColumn = undefined;
		this.commit({
			selection: EditorSelection.cursor(doc.line(clamped + 1).from),
		});

		this.highlightGraphic?.destroy();
		const bg = this.add.graphics().setDepth(1.5);
		bg.fillStyle(PALETTE.gold, 0.25);
		bg.fillRect(
			SCROLL_MIN_X,
			clamped * LINE_HEIGHT - LINE_HEIGHT / 2,
			this.pageRight - SCROLL_MIN_X,
			LINE_HEIGHT,
		);
		this.highlightGraphic = bg;
		this.time.delayedCall(FileScene.HIGHLIGHT_MS, () => {
			if (this.highlightGraphic === bg) this.highlightGraphic = null;
			bg.destroy();
		});
	};

	/** Esc or a click on the arch: unsaved changes get the Save / Discard / Keep writing prompt (FileStatusLine) first, the same question the spellbook used to ask on close. */
	private requestExit(): void {
		if (this.exiting) return;
		if (isActiveFileDirty(this.store.getState())) {
			this.store.getState().setFileLeavePrompt(true);
			return;
		}
		this.exitToWorld();
	}

	private exitToWorld(): void {
		// scene.stop() is queued until the end of this step, so two exit
		// requests in the same frame (an Esc and an arch click) would otherwise
		// exit (and wake the world) twice.
		if (this.exiting) return;
		this.exiting = true;
		this.caretInput?.blur();
		this.store.getState().exitPortal();
		this.scene.stop();
		this.scene.wake(this.returnSceneKey);
	}

	// --- Page rendering --------------------------------------------------

	private renderVisibleWindow(): void {
		const view = this.cameras.main.worldView;
		const nextWindow = computeLineWindow(
			view.y,
			view.height,
			LINE_HEIGHT,
			this.doc.lines,
			BUFFER_LINES,
		);
		if (!lineWindowsEqual(nextWindow, this.currentWindow) || this.linesDirty) {
			this.syncWindow(nextWindow);
			this.currentWindow = nextWindow;
			this.linesDirty = false;
			this.caretDirty = true;
		}
		if (this.caretDirty) {
			this.drawCaretAndSelection();
			this.caretDirty = false;
		}
		this.updateCaretBlink();
	}

	/**
	 * Markdown lines render enchanted except where the caret or selection
	 * is, which shows raw source — the same "live preview" trade Obsidian
	 * makes, and what keeps click/caret columns exact: every line the caret
	 * can be on is plain monospace.
	 */
	private syncWindow(next: LineWindow): void {
		const state = this.buffer;
		const doc = this.doc;
		const main = state?.selection.main;
		const caretLine = main ? doc.lineAt(main.head).number - 1 : 0;
		const rawFrom = main ? doc.lineAt(main.from).number - 1 : 0;
		const rawTo = main ? doc.lineAt(main.to).number - 1 : 0;
		for (const [index, rendered] of this.activeLines) {
			if (index < next.start || index >= next.end) {
				rendered.container.destroy();
				this.activeLines.delete(index);
			}
		}
		for (let index = next.start; index < next.end; index++) {
			const text = doc.line(index + 1).text;
			const raw =
				this.file.kind !== "markdown" || (index >= rawFrom && index <= rawTo);
			const current = index === caretLine;
			const key = `${raw ? "r" : "m"}${current ? "*" : " "}${text}`;
			const existing = this.activeLines.get(index);
			if (existing?.key === key) continue;
			existing?.container.destroy();
			const spans: PaintedSpan[] | undefined = raw ? undefined : [];
			this.activeLines.set(index, {
				container: this.buildLine(index, text, current, spans),
				key,
				spans,
			});
		}
	}

	private drawCaretAndSelection(): void {
		const sel = this.selectionGraphic;
		const caret = this.caretGraphic;
		sel.clear();
		caret.clear();
		const state = this.buffer;
		if (!state) return;
		const { doc } = state;
		const main = state.selection.main;
		const layout = this.layout;
		const head = pointFromPos(doc, main.head, layout);

		if (main.empty) {
			sel.fillStyle(PALETTE.gold, 0.12);
			sel.fillRect(
				SCROLL_MIN_X,
				head.y - LINE_HEIGHT / 2,
				this.pageRight - SCROLL_MIN_X,
				LINE_HEIGHT,
			);
		} else {
			sel.fillStyle(PALETTE.gold, 0.38);
			const fromLine = doc.lineAt(main.from).number - 1;
			const toLine = doc.lineAt(main.to).number - 1;
			const first = Math.max(fromLine, this.currentWindow.start);
			const last = Math.min(toLine, this.currentWindow.end - 1);
			for (let i = first; i <= last; i++) {
				const line = doc.line(i + 1);
				const x1 =
					i === fromLine ? pointFromPos(doc, main.from, layout).x : TEXT_X;
				// Past the last character, half a cell stands in for the newline
				// the selection carries on to the next line.
				const x2 =
					i === toLine
						? pointFromPos(doc, main.to, layout).x
						: TEXT_X +
							displayColumn(line.text, line.length) * this.charWidth +
							this.charWidth / 2;
				sel.fillRect(
					x1,
					i * LINE_HEIGHT - LINE_HEIGHT / 2,
					Math.max(x2 - x1, 1),
					LINE_HEIGHT,
				);
			}
		}

		// The old gold path-lane marker, now an I-beam at the exact character:
		// ink outline so it reads on the parchment, gold stem and serifs.
		const top = head.y - LINE_HEIGHT / 2 + 1;
		const height = LINE_HEIGHT - 2;
		caret.fillStyle(PALETTE.ink, 1);
		caret.fillRect(head.x - 2, top, 4, height);
		caret.fillRect(head.x - 4, top, 8, 3);
		caret.fillRect(head.x - 4, top + height - 3, 8, 3);
		caret.fillStyle(PALETTE.gold, 1);
		caret.fillRect(head.x - 1, top + 1, 2, height - 2);
		caret.fillRect(head.x - 3, top + 1, 6, 1);
		caret.fillRect(head.x - 3, top + height - 2, 6, 1);
	}

	/** Solid while typing or moving, blinking once idle; dimmed while something else holds the keyboard (a panel, the spellbook). */
	private updateCaretBlink(): void {
		const writing =
			typeof document !== "undefined" &&
			this.caretInput !== null &&
			document.activeElement === this.caretInput;
		if (!writing) {
			this.caretGraphic.setAlpha(0.45);
			return;
		}
		if (this.reducedMotion) {
			this.caretGraphic.setAlpha(1);
			return;
		}
		const phase = Math.floor(
			(this.time.now - this.blinkEpoch) / CARET_BLINK_MS,
		);
		this.caretGraphic.setAlpha(phase % 2 === 0 ? 1 : 0.2);
	}

	/** `spans` present means draw the line enchanted, recording what went where into it. */
	private buildLine(
		index: number,
		line: string,
		current: boolean,
		spans: PaintedSpan[] | undefined,
	): Phaser.GameObjects.Container {
		const y = index * LINE_HEIGHT - LINE_HEIGHT / 2;
		const objects: Phaser.GameObjects.GameObject[] = [];

		const gutter = this.add
			.text(GUTTER_RIGHT_X, 0, String(index + 1), {
				fontFamily: MONO_FONT,
				fontSize: "11px",
				fontStyle: current ? "bold" : "normal",
				color: toCssColor(current ? PALETTE.gold : PALETTE.trail),
			})
			.setOrigin(1, 0);
		objects.push(gutter);

		if (spans) {
			objects.push(...this.buildMarkdownSegments(line, spans));
		} else {
			objects.push(
				this.add.text(TEXT_X, 0, line.replace(/\t/g, "    "), {
					fontFamily: MONO_FONT,
					fontSize: `${BASE_FONT_SIZE}px`,
					color: toCssColor(PALETTE.ink),
				}),
			);
		}

		const container = this.add.container(0, y, objects).setDepth(2);
		return container;
	}

	private buildMarkdownSegments(
		line: string,
		spans: PaintedSpan[],
	): Phaser.GameObjects.GameObject[] {
		const enchanted = enchantMdLine(line);
		const objects: Phaser.GameObjects.GameObject[] = [];
		let x = TEXT_X;

		if (enchanted.isListItem) {
			const dot = this.add.circle(x + 4, 6, 3, PALETTE.biome.grove);
			objects.push(dot);
			x += 14;
		}

		for (const segment of enchanted.segments) {
			const next = this.appendSegment(objects, segment, x);
			if (segment.text !== "") {
				spans.push({ x, width: next - x, from: segment.from, to: segment.to });
			}
			x = next;
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
