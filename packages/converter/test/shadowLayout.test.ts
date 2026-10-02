import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorldLayerDelta, WorldManifest } from "@cabn/world-schema";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import {
	CLEARING_GAP_PX,
	estimatedClearingRadius,
	portalRingBaseRadius,
} from "../src/layout.js";
import { convertShadow } from "../src/shadow.js";
import { DirSource } from "../src/sources/dir.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function fixture(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "cabn-shadow-layout-"));
	dirs.push(dir);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	return dir;
}

async function world(dir: string) {
	const bundle = await convert(new DirSource(dir), {
		name: "w",
		source: "w",
		now: FIXED_NOW,
	});
	const raw = bundle.get("world.json") as string;
	const base = JSON.parse(raw) as WorldManifest;
	const delta = await convertShadow(new DirSource(dir), base, {
		now: FIXED_NOW,
	});
	return { raw, base, delta };
}

const VISIBLE: Record<string, string> = {
	"README.md": "# hi\n",
	"src/a.ts": "export const a = 1;\n",
	"src/b.ts": "export const b = 1;\n",
	"src/lib/c.ts": "export const c = 1;\n",
	"docs/guide.md": "# guide\n",
	"tests/a.test.ts": "export {};\n",
};
const HIDDEN: Record<string, string> = {
	".env": "A=1\n",
	".gitignore": "dist\n",
	".github/CODEOWNERS": "* @me\n",
	".github/workflows/ci.yml": "on: push\n",
	".vscode/settings.json": "{}\n",
	"src/.eslintrc.json": "{}\n",
	"src/lib/.cache/x.json": "{}\n",
	".husky/pre-commit": "#!/bin/sh\n",
};

function degrees(paths: readonly { from: string; to: string }[]) {
	const d = new Map<string, number>();
	for (const p of paths) {
		d.set(p.from, (d.get(p.from) ?? 0) + 1);
		d.set(p.to, (d.get(p.to) ?? 0) + 1);
	}
	return d;
}

function portalRingData(base: WorldManifest) {
	const d = degrees(base.paths);
	return base.clusters.map((c) => ({
		id: c.id,
		pos: c.pos,
		portals: c.portalIds.length,
		degree: d.get(c.id) ?? 0,
		ring: portalRingBaseRadius(c.portalIds.length, d.get(c.id) ?? 0),
	}));
}

/** Every clearing (base sized with its extra shadow paths) clears every other, and every shadow path clears every clearing but its own two ends. */
function assertNoOverlaps(
	base: WorldManifest,
	delta: WorldLayerDelta,
	opts: { pathsClear: boolean },
) {
	const all = degrees([...base.paths, ...delta.paths]);
	const circles = [...base.clusters, ...delta.clusters].map((c) => ({
		id: c.id,
		x: c.pos.x,
		y: c.pos.y,
		r: estimatedClearingRadius(c.portalIds.length, all.get(c.id) ?? 0),
	}));
	const shadowIds = new Set(delta.clusters.map((c) => c.id));
	for (let i = 0; i < circles.length; i++) {
		for (let k = i + 1; k < circles.length; k++) {
			const a = circles[i];
			const b = circles[k];
			if (!a || !b) continue;
			if (!shadowIds.has(a.id) && !shadowIds.has(b.id)) continue;
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			expect(dist, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(
				a.r + b.r + CLEARING_GAP_PX - 1e-6,
			);
		}
	}
	if (!opts.pathsClear) return;
	const byId = new Map(circles.map((c) => [c.id, c]));
	for (const p of delta.paths) {
		const a = byId.get(p.from);
		const b = byId.get(p.to);
		if (!a || !b) throw new Error("dangling path");
		for (const q of circles) {
			if (q.id === a.id || q.id === b.id) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const t = Math.max(
				0,
				Math.min(
					1,
					((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy),
				),
			);
			const dist = Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
			expect(
				dist,
				`path ${p.from}->${p.to} crosses ${q.id}`,
			).toBeGreaterThanOrEqual(q.r - 1e-6);
		}
	}
}

describe("shadow layout", () => {
	test("base positions and portal-ring data are byte-identical with and without hidden files", async () => {
		const plain = await world(await fixture(VISIBLE));
		const withHidden = await world(await fixture({ ...VISIBLE, ...HIDDEN }));
		expect(withHidden.raw).toBe(plain.raw);
		expect(portalRingData(withHidden.base)).toEqual(portalRingData(plain.base));
		expect(withHidden.delta.clusters.length).toBeGreaterThan(0);
	});

	test("no shadow clearing overlaps another, and shadow paths stay clear", async () => {
		const { base, delta } = await world(
			await fixture({ ...VISIBLE, ...HIDDEN }),
		);
		assertNoOverlaps(base, delta, { pathsClear: true });
	});

	test("deterministic: same input, same placement (snapshot)", async () => {
		const a = await world(await fixture({ ...VISIBLE, ...HIDDEN }));
		const b = await world(await fixture({ ...VISIBLE, ...HIDDEN }));
		const placement = (d: WorldLayerDelta) =>
			d.clusters.map((c) => ({ id: c.id, pos: c.pos }));
		expect(placement(b.delta)).toEqual(placement(a.delta));
		expect({
			clusters: placement(a.delta),
			paths: a.delta.paths,
		}).toMatchSnapshot();
	});

	test("stress: 30 hidden folders at the root all fit without moving the base", async () => {
		const hidden: Record<string, string> = {};
		for (let i = 0; i < 30; i++)
			hidden[`.tool${String(i).padStart(2, "0")}/config.json`] = "{}\n";
		const plain = await world(await fixture(VISIBLE));
		const crowded = await world(await fixture({ ...VISIBLE, ...hidden }));
		expect(crowded.raw).toBe(plain.raw);
		expect(crowded.delta.clusters).toHaveLength(30);
		// 30 paths out of one clearing can't all find a ray that misses every
		// other clearing; the clearings themselves must still never overlap.
		assertNoOverlaps(crowded.base, crowded.delta, { pathsClear: false });
	});
});
