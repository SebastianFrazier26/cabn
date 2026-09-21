import type { PortalFile } from "@cabn/world-schema";
import Phaser from "phaser";
import type { StoreApi } from "zustand/vanilla";
import { ASSET_KEYS } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { dashedLine } from "../render/dashedLine.js";
import {
	createMovementKeys,
	createPlayer,
	type MovementKeys,
	type PlayerHandle,
	type PlayerTextures,
	updatePlayerMovement,
} from "../render/playerController.js";
import { PORTAL_SCALE } from "../render/scale.js";
import {
	enchantMdLine,
	type MdSegment,
	type MdSegmentStyle,
} from "../systems/enchantMd.js";
import {
	computeLineWindow,
	type LineWindow,
	lineWindowsEqual,
} from "../systems/lineWindow.js";
import { isWithinRadius } from "../systems/portalApproach.js";
import {
	extendSelection,
	type LineSelection,
	selectionRange,
	startSelection,
} from "../systems/selection.js";
import { PORTAL_IDLE_ANIM } from "./PreloadScene.js";

export interface FileSceneData {
	portalId: string;
	file: PortalFile;
	content: string;
	/** Which scene key to wake/resume once this file closes (always "world" for now, named explicitly so a future shelf-level file view isn't a hardcoded string away). */
	returnSceneKey: string;
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
const BASE_FONT_SIZE = 13;
const CODE_BOX_PAD_X = 3;

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

	private keys!: {
		enter: Phaser.Input.Keyboard.Key;
		e: Phaser.Input.Keyboard.Key;
		esc: Phaser.Input.Keyboard.Key;
		shift: Phaser.Input.Keyboard.Key;
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
	}

	create(): void {
		this.drawParchmentBacking();
		this.drawPath();
		this.drawExitPortal();
		this.createPlayer();
		this.setupInput();
		this.setupCamera();
		// mitt's on/off take no context arg — onJumpToLine/onBagUse are arrow
		// class fields (auto-bound, stable reference) specifically for this.
		this.bus.on("tool:jump-to-line", this.onJumpToLine);
		this.bus.on("tool:bag-use", this.onBagUse);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
	}

	private teardown(): void {
		this.bus.off("tool:jump-to-line", this.onJumpToLine);
		this.bus.off("tool:bag-use", this.onBagUse);
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

	private createPlayer(): void {
		this.playerTextures = { front: ASSET_KEYS.characterIdle, back: null };
		this.player = createPlayer(this, { x: PATH_X, y: 0 }, this.playerTextures);
	}

	private setupInput(): void {
		const kb = this.input.keyboard;
		if (!kb) throw new Error("FileScene requires keyboard input");
		this.movementKeys = createMovementKeys(this);
		this.keys = {
			enter: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
			e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
			esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
			shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
		};
	}

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
		if (this.selection === null) {
			updatePlayerMovement(
				this.player,
				this.movementKeys,
				delta,
				this.playerTextures,
			);
		} else {
			(this.player.body.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
			this.handleSelectionExtend();
		}
		this.handleExit();
		this.renderVisibleWindow();
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

	private static readonly HIGHLIGHT_MS = 1500;

	private onJumpToLine = ({ line }: { line: number }): void => {
		const clamped = Phaser.Math.Clamp(
			line,
			0,
			Math.max(this.lines.length - 1, 0),
		);
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

	private handleExit(): void {
		if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
			if (this.selection !== null) {
				this.selection = null;
				return;
			}
			this.exitToWorld();
			return;
		}

		const pressed =
			Phaser.Input.Keyboard.JustDown(this.keys.enter) ||
			Phaser.Input.Keyboard.JustDown(this.keys.e);
		if (!pressed) return;
		const pos = { x: this.player.body.x, y: this.player.body.y };
		if (isWithinRadius(pos, this.exitPortalPos, EXIT_ENTER_RADIUS))
			this.exitToWorld();
	}

	private exitToWorld(): void {
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
