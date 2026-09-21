import type { Position } from "@cabn/world-schema";
import Phaser from "phaser";

/** Shared by WorldScene's cluster paths and ShelfScene's tower-to-cabin paths. */
export function dashedLine(
	graphics: Phaser.GameObjects.Graphics,
	from: Position,
	to: Position,
	dash = 14,
	gap = 10,
): void {
	const total = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
	const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
	const step = dash + gap;
	for (let d = 0; d < total; d += step) {
		const segEnd = Math.min(d + dash, total);
		const x1 = from.x + Math.cos(angle) * d;
		const y1 = from.y + Math.sin(angle) * d;
		const x2 = from.x + Math.cos(angle) * segEnd;
		const y2 = from.y + Math.sin(angle) * segEnd;
		graphics.lineBetween(x1, y1, x2, y2);
	}
}
