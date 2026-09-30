import { type ChildProcess, spawn } from "node:child_process";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { CabnStore } from "../../../packages/engine/src/bridge/store.js";

// The shadow realm (M2) end to end against a real `cabn serve --owner` of a
// temp copy of the CLI's serve fixture plus hidden files written here (so no
// dotfile fixture is ever committed): the toolkit's Sudo entry (O) raises the hidden
// clusters without moving anything visible, hidden files open and save to
// disk, a hidden-folder sign lands on disk, pets never see any of it, and a
// reload starts with the realm off. Since M3 it also checks the nether skin
// is drawn and that the base world's scenery (edge forest, ponds, windmill,
// skyline) stands exactly where it did. Since 2026-09-29 it checks the realm
// has no night (the Night setting shows its day look; off, night returns) and
// that every placed piece wears nether art; since the second polish pass that
// the monsters (world and file view) wear nether recolours, the windmill's
// sails hold still and the HUD icons lose their green. Since the 2026-09-29
// decision "nether regions should ONLY show . files" the realm hides every
// normal arch, monster and sign, and search and the pet find no normal file,
// while the clearings and paths stay put; off, all of it comes back
// unchanged. CABN_REVIEW_SHOTS=1
// writes the review screenshots to assets/generated/review/shadow-m3/.

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const CLI = join(REPO, "packages", "cli", "dist", "main.js");
const FIXTURE = join(
	REPO,
	"packages",
	"cli",
	"tests",
	"fixtures",
	"serve-project",
);
const SHOTS_DIR = join(REPO, "assets", "generated", "review", "shadow-m3");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PORT = Number(process.env.CABN_SHADOW_E2E_PORT ?? 5043);

const HIDDEN_FILES: Record<string, string> = {
	".env": "SHADOW_E2E_ENV=canary\n",
	".github/ci.yml": "name: ci\non: push\n# shadowgithubcanary\n",
	".vscode/settings.json": '{\n\t"editor.tabSize": 2\n}\n',
	// Unbalanced on purpose, so the realm has a monster of its own to wear nether art.
	".github/check.py": "def check(:\n    return [1, 2\n",
};

// A normal folder with no hidden file anywhere under it: in the realm its
// clearing stands empty.
const NORMAL_FILES: Record<string, string> = {
	"docs/notes.md": "# Notes\n\nnormalcanary lives here.\n",
};

let root: string;
let dir: string;
let serve: ChildProcess | undefined;
let url: string;
// Captured for the whole process lifetime (not just the URL-wait above) so a
// flake in any test can print what the server was doing at the time — see
// the afterEach below. `signal` matters more than `code` here: a 144 exit is
// SIGURG (128+16), the signature under investigation for M10's serve-kills bug.
let serveOutput = "";
let serveExit:
	| { code: number | null; signal: NodeJS.Signals | null }
	| undefined;

test.beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "cabn-shadow-e2e-"));
	// A fixed folder name: the scenery is seeded from it (plus the file tree),
	// so the windmill and ponds land the same way on every run.
	dir = join(root, "serve-project");
	await cp(FIXTURE, dir, { recursive: true });
	for (const [path, content] of Object.entries({
		...HIDDEN_FILES,
		...NORMAL_FILES,
	})) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	await chmod(join(dir, ".vscode/settings.json"), 0o600);
	serve = spawn(
		process.execPath,
		[CLI, "serve", dir, "--port", String(PORT), "--offline", "--owner"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	serve.stdout?.on("data", (chunk: Buffer) => {
		serveOutput += chunk.toString();
	});
	serve.stderr?.on("data", (chunk: Buffer) => {
		serveOutput += chunk.toString();
	});
	serve.once("exit", (code, signal) => {
		serveExit = { code, signal };
	});
	url = await new Promise<string>((resolveUrl, rejectUrl) => {
		const timer = setTimeout(
			() =>
				rejectUrl(
					new Error(`cabn serve never printed its url: ${serveOutput}`),
				),
			30_000,
		);
		serve?.stdout?.on("data", () => {
			const m =
				/cabn serve: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(
					serveOutput,
				);
			if (m?.[1]) {
				clearTimeout(timer);
				resolveUrl(m[1]);
			}
		});
		serve?.once("exit", (code) =>
			rejectUrl(new Error(`cabn serve exited (${code}): ${serveOutput}`)),
		);
	});
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright parses this signature itself and requires a literal object pattern, even unused, to know this hook takes no fixtures.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) {
		console.log(
			`[shadow-owner] cabn serve output so far:\n${serveOutput}\n` +
				`[shadow-owner] cabn serve exit: ${serveExit ? `code=${serveExit.code} signal=${serveExit.signal}` : "still running"}`,
		);
	}
});

test.afterAll(async () => {
	serve?.kill("SIGINT");
	await new Promise((r) => setTimeout(r, 300));
	if (serve && serve.exitCode === null) serve.kill("SIGKILL");
	await rm(root, { recursive: true, force: true });
});

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

const isHidden = (path: string) =>
	path.split("/").some((s) => s.startsWith("."));

interface Snapshot {
	mode: string;
	activeLayerId: string | null;
	portals: { id: string; clusterId: string; layer?: boolean }[];
	clusters: { id: string; x: number; y: number; layer?: boolean }[];
	mapPortals: { id: string; x: number; y: number }[];
	loadedChunks: string[];
	signs: string[];
	activePortalId: string | null;
	content: string | null;
	focused: string | null;
	dirty: boolean;
	theme: string | null;
	monsters: string[];
	mapMonsters: string[];
}

async function snap(page: Page): Promise<Snapshot> {
	return page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		const root = document.querySelector(".cabn-pixel-root");
		return {
			mode: s.mode,
			activeLayerId: s.activeLayerId,
			portals: s.portals.map((p) => ({
				id: p.id,
				clusterId: p.clusterId,
				...(p.layer ? { layer: true } : {}),
			})),
			clusters: (s.worldMap?.clusters ?? []).map((c) => ({
				id: c.id,
				x: c.pos.x,
				y: c.pos.y,
				...(c.layer ? { layer: true } : {}),
			})),
			mapPortals: (s.worldMap?.portals ?? []).map((p) => ({
				id: p.id,
				x: p.pos.x,
				y: p.pos.y,
			})),
			loadedChunks: s.loadedChunks,
			signs: s.signs.map((x) => x.path),
			activePortalId: s.activePortalId,
			content: s.activePortalContent,
			focused: s.focusedPortalPreview?.portalId ?? null,
			dirty:
				s.activeFileState !== null &&
				s.activeFileSavedDoc !== null &&
				!s.activeFileState.doc.eq(s.activeFileSavedDoc),
			theme: root?.getAttribute("data-layer") ?? null,
			monsters: s.monsters.map((m) => m.id),
			mapMonsters: (s.worldMap?.monsters ?? []).map((m) => m.id),
		};
	});
}

/** Where every drawn arch sprite actually stands right now (WorldScene's own sprites, not the store's copy). */
async function archSprites(
	page: Page,
): Promise<Record<string, [number, number]>> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: { scene: { getScene(k: string): unknown } };
			}
		).__cabnGame;
		const world = game.scene.getScene("world") as {
			portalSprites: Map<string, { x: number; y: number }>;
		};
		const out: Record<string, [number, number]> = {};
		for (const [id, s] of world.portalSprites) out[id] = [s.x, s.y];
		return out;
	});
}

interface Drawn {
	/** Every laid-out arch spot, drawn or not. */
	spots: Record<string, [number, number]>;
	monsterSprites: string[];
	editedMarkers: string[];
	signs: string[];
	/** Each clearing's drawn ground radii, by cluster id (a hidden annex shares its folder's label). */
	ground: Record<string, [number, number]>;
}

/** What WorldScene itself has drawn, beyond the arches. */
async function drawn(page: Page): Promise<Drawn> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: { scene: { getScene(k: string): unknown } };
			}
		).__cabnGame;
		const world = game.scene.getScene("world") as {
			portalWorldPos: Map<string, { x: number; y: number }>;
			monsterSprites: Map<string, { active: boolean }>;
			editedMarkers: Map<string, unknown>;
			signs: { placed: Map<string, unknown> } | null;
			drawnGroundRadii: Map<string, { x: number; y: number }>;
		};
		const ground: Record<string, [number, number]> = {};
		for (const [id, r] of world.drawnGroundRadii) ground[id] = [r.x, r.y];
		const spots: Record<string, [number, number]> = {};
		for (const [id, p] of world.portalWorldPos) spots[id] = [p.x, p.y];
		return {
			spots,
			monsterSprites: [...world.monsterSprites]
				.filter(([, m]) => m.active)
				.map(([id]) => id),
			editedMarkers: [...world.editedMarkers.keys()],
			signs: [...(world.signs?.placed.keys() ?? [])],
			ground,
		};
	});
}

/** Clicks the arch's middle on screen (the click walks there and enters it). */
async function clickArch(page: Page, portalId: string) {
	const at = await page.evaluate((id) => {
		const game = (
			window as unknown as {
				__cabnGame: {
					canvas: HTMLCanvasElement;
					scene: { getScene(k: string): unknown };
				};
			}
		).__cabnGame;
		const world = game.scene.getScene("world") as {
			portalSprites: Map<string, { x: number; y: number }>;
			cameras: {
				main: { worldView: { x: number; y: number }; zoom: number };
			};
		};
		const sprite = world.portalSprites.get(id);
		if (!sprite) return null;
		const cam = world.cameras.main;
		const rect = game.canvas.getBoundingClientRect();
		const scale = rect.width / game.canvas.width;
		return {
			x: rect.left + (sprite.x - cam.worldView.x) * cam.zoom * scale,
			y: rect.top + (sprite.y - cam.worldView.y) * cam.zoom * scale,
		};
	}, portalId);
	if (!at) throw new Error(`no arch drawn for ${portalId}`);
	await page.mouse.click(at.x, at.y);
}

interface SceneryView {
	items: string[];
	baseItems: string[];
	pois: string[];
	skyline: string[];
	archTextures: string[];
	textures: Record<string, boolean>;
	fieldTexture: string | null;
}

/** WorldScene's own scenery plan and a few texture facts, straight off the scene. */
async function scenery(page: Page): Promise<SceneryView> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: {
					scene: { getScene(k: string): unknown };
					textures: { exists(k: string): boolean };
				};
			}
		).__cabnGame;
		type Item = { kind: string; x: number; y: number; layer?: boolean };
		const world = game.scene.getScene("world") as {
			edgeDressing: {
				items: Item[];
				pointsOfInterest: { kind: string; x: number; y: number }[];
			} | null;
			sky: {
				skyline: {
					elements: { piece: string; layer: string; u: number }[];
				};
			} | null;
			portalSprites: Map<string, { texture: { key: string } }>;
			skin: { fieldTiles: { key: string } | null };
		};
		const key = (i: { kind: string; x: number; y: number }) =>
			`${i.kind}@${i.x.toFixed(2)},${i.y.toFixed(2)}`;
		const items = world.edgeDressing?.items ?? [];
		return {
			items: items.map(key),
			baseItems: items.filter((i) => !i.layer).map(key),
			pois: (world.edgeDressing?.pointsOfInterest ?? []).map(key),
			skyline: (world.sky?.skyline.elements ?? []).map(
				(e) => `${e.piece}/${e.layer}@${e.u.toFixed(2)}`,
			),
			archTextures: [
				...new Set([...world.portalSprites.values()].map((s) => s.texture.key)),
			],
			textures: Object.fromEntries(
				[
					"shadow-netherrack-tiles",
					"shadow-portal-arch",
					"shadow-brazier",
					"shadow-sky-ember",
					"shadow-path-lava-bed",
				].map((k) => [k, game.textures.exists(k)]),
			),
			fieldTexture: world.skin.fieldTiles?.key ?? null,
		};
	});
}

interface Look {
	timeOfDay: string;
	override: string;
	/** The atmosphere's eased day (0) .. night (1) blend, which drives the grade, moon and stars. */
	blend: number;
	theme: string | null;
	propTextures: string[];
	/** Edge scenery kinds (baked into chunks) and whether the skin redraws each with a nether texture. */
	unswappedScenery: string[];
	/** Normal-world prop, sails and day-skyline textures still on a live sprite. */
	normalArt: string[];
}

const NORMAL_ART_KEYS = new Set([
	...[
		"fence",
		"hedge",
		"lamp-post",
		"tree-small",
		"tree-large",
		"bush",
		"well",
		"signpost",
		"flower-pot",
		"stone-wall",
		"cottage",
		"flower-bed",
		"bench",
	].map((n) => `prop-${n}`),
	"scenery-windmill-sails",
	...["castle", "watchtower", "village", "hill", "treeline"].map(
		(p) => `skyline-${p}-day`,
	),
]);

/** Time of day as the store and the scene's atmosphere see it, and which art is on screen. */
async function look(page: Page): Promise<Look> {
	return page.evaluate(
		(normalKeys) => {
			const game = (
				window as unknown as {
					__cabnGame: { scene: { getScene(k: string): unknown } };
				}
			).__cabnGame;
			const s = (
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore.getState();
			const world = game.scene.getScene("world") as {
				atmosphere: { blend(): number } | null;
				placedProps: { sprite: { texture: { key: string } } }[];
				edgeDressing: { items: { kind: string }[] } | null;
				skin: { scenery: Record<string, { key: string }> | null };
				children: { list: { texture?: { key: string }; active: boolean }[] };
			};
			const normal = new Set(normalKeys);
			return {
				timeOfDay: s.timeOfDay,
				override: s.timeOfDayOverride,
				blend: world.atmosphere?.blend() ?? -1,
				theme:
					document
						.querySelector(".cabn-pixel-root")
						?.getAttribute("data-theme") ?? null,
				propTextures: world.placedProps.map((p) => p.sprite.texture.key),
				unswappedScenery: [
					...new Set(
						(world.edgeDressing?.items ?? [])
							.map((i) => i.kind)
							.filter(
								(k) => !world.skin.scenery?.[k]?.key.startsWith("shadow-"),
							),
					),
				],
				normalArt: [
					...new Set(
						world.children.list
							.map((o) => o.texture?.key ?? "")
							.filter((k) => normal.has(k)),
					),
				],
			};
		},
		[...NORMAL_ART_KEYS],
	);
}

interface Creatures {
	/** Texture keys of every live world monster sprite. */
	monsters: string[];
	/** Every windmill's sails: texture and current angle. */
	sails: { key: string; angle: number }[];
}

async function creatures(page: Page): Promise<Creatures> {
	return page.evaluate(() => {
		const game = (
			window as unknown as {
				__cabnGame: { scene: { getScene(k: string): unknown } };
			}
		).__cabnGame;
		type Obj = { texture?: { key: string }; angle?: number; active: boolean };
		const world = game.scene.getScene("world") as {
			monsterSprites: Map<string, Obj>;
			children: { list: Obj[] };
		};
		return {
			monsters: [...world.monsterSprites.values()]
				.filter((m) => m.active)
				.map((m) => m.texture?.key ?? ""),
			sails: world.children.list
				.filter((o) => o.active && o.texture?.key.includes("windmill-sails"))
				.map((o) => ({ key: o.texture?.key ?? "", angle: o.angle ?? 0 })),
		};
	});
}

/** The sails' angles a moment apart. */
async function sailTurn(page: Page): Promise<[number[], number[]]> {
	const a = (await creatures(page)).sails.map((s) => s.angle);
	await page.waitForTimeout(700);
	const b = (await creatures(page)).sails.map((s) => s.angle);
	return [a, b];
}

async function expectDayLook(page: Page) {
	await expect.poll(async () => (await look(page)).blend).toBe(0);
	const now = await look(page);
	expect(now.timeOfDay).toBe("day");
	expect(now.theme).toBe("day");
}

async function waitForWorld(page: Page) {
	await expect
		.poll(async () => (await snap(page)).mapPortals.length, { timeout: 30_000 })
		.toBeGreaterThan(0);
}

async function walkToAndOpen(page: Page, portalId: string) {
	await page.evaluate((id) => {
		(
			window as unknown as {
				__cabnBus: { emit(e: string, p: unknown): void };
			}
		).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, portalId);
	await expect
		.poll(async () => (await snap(page)).focused, { timeout: 20_000 })
		.toBe(portalId);
	const clusterId = (await snap(page)).portals.find(
		(p) => p.id === portalId,
	)?.clusterId;
	await expect
		.poll(async () => (await snap(page)).loadedChunks, { timeout: 10_000 })
		.toContain(clusterId);
	let last = { x: Number.NaN, y: 0 };
	for (let i = 0; i < 40; i++) {
		const now = await page.evaluate(
			() =>
				(
					window as unknown as { __cabnStore: { getState(): CabnStore } }
				).__cabnStore.getState().playerPos,
		);
		if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) break;
		last = now;
		await page.waitForTimeout(150);
	}
	// Held across a frame, not press(): see smoke.spec.ts — Phaser's
	// JustDown can miss a CDP down+up that lands inside one tick.
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect
		.poll(async () => (await snap(page)).activePortalId, { timeout: 10_000 })
		.toBe(portalId);
}

/** Toggles the realm through the owner's toolkit, by keyboard (O, its number, Enter) or by mouse. */
async function sudo(page: Page, via: "keys" | "mouse") {
	const toolkit = page.getByTestId("owner-toolkit");
	if (via === "keys") {
		await page.keyboard.press("o");
		await expect(toolkit).toBeVisible();
		await page.keyboard.press("2");
		await expect(toolkit.locator('[data-entry="shadow:sudo"]')).toHaveAttribute(
			"data-picked",
			"true",
		);
		await page.keyboard.press("Enter");
	} else {
		await page.locator('[data-tool="owner"]').click();
		await toolkit.locator('[data-entry="shadow:sudo"]').click();
	}
	await expect(toolkit).toHaveCount(0);
}

async function hold(page: Page, key: string) {
	await page.keyboard.down(key);
	await page.waitForTimeout(150);
	await page.keyboard.up(key);
}

async function storageText(page: Page): Promise<string> {
	return page.evaluate(() => {
		const dump = (s: Storage) =>
			Array.from({ length: s.length }, (_, i) => {
				const k = s.key(i) ?? "";
				return `${k}=${s.getItem(k)}`;
			}).join("\n");
		return `${dump(localStorage)}\n${dump(sessionStorage)}`;
	});
}

test("owner: the toolkit's sudo entry raises the shadow realm, hidden files read and save to disk, and nothing leaks", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	const requests: { url: string; token: string | undefined }[] = [];
	page.on("request", (req) => {
		requests.push({
			url: req.url(),
			token: req.headers()["x-cabn-owner-token"],
		});
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${url}&e2e=1`);
	await waitForWorld(page);
	await page.evaluate(() =>
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.setTimeOfDayOverride("day"),
	);
	const token = await page.evaluate(
		() =>
			(window as unknown as { __CABN_OWNER_TOKEN__: string })
				.__CABN_OWNER_TOKEN__,
	);
	await expect(page.locator('[data-tool="owner"]')).toBeVisible({
		timeout: 20_000,
	});
	await page.waitForTimeout(1500);

	// The normal world has no hidden paths at all.
	const before = await snap(page);
	expect(before.activeLayerId).toBeNull();
	expect(before.portals.filter((p) => isHidden(p.id))).toEqual([]);
	expect(before.mapPortals.filter((p) => isHidden(p.id))).toEqual([]);
	expect(before.clusters.some((c) => c.layer)).toBe(false);
	const beforeSprites = await archSprites(page);
	expect(Object.keys(beforeSprites).length).toBeGreaterThan(0);
	const beforeDrawn = await drawn(page);
	expect(before.portals.length).toBeGreaterThan(0);
	expect(before.monsters.length).toBeGreaterThan(0);
	expect(beforeDrawn.monsterSprites.length).toBeGreaterThan(0);
	const docsId = await page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore
				.getState()
				.worldMap?.clusters.find((c) => c.label === "docs")?.id ?? "",
	);
	const rootId = await page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore
				.getState()
				.worldMap?.clusters.find((c) => c.label === "root")?.id ?? "",
	);
	expect(beforeDrawn.ground[docsId]?.[0]).toBeGreaterThan(150);
	const beforeScenery = await scenery(page);
	expect(beforeScenery.items.length).toBeGreaterThan(20);
	expect(beforeScenery.archTextures).toEqual(["portal-arch-strip"]);
	expect(beforeScenery.fieldTexture).toBeNull();
	// The normal world draws the normal art (so the realm's check below means something).
	const normalLook = await look(page);
	expect(normalLook.normalArt.length).toBeGreaterThan(0);
	expect(normalLook.propTextures.every((k) => k.startsWith("prop-"))).toBe(
		true,
	);
	// The normal world never even loads the nether art.
	expect(Object.values(beforeScenery.textures)).toEqual([
		false,
		false,
		false,
		false,
		false,
	]);
	await shoot(page, "day-normal");
	const normalCreatures = await creatures(page);
	expect(
		normalCreatures.monsters.filter((k) => k.startsWith("shadow-")),
	).toEqual([]);
	// The seeded scenery gives this fixture one windmill on every run.
	expect(normalCreatures.sails.length).toBe(1);
	const [a, b] = await sailTurn(page);
	expect(b, "normal sails turn").not.toEqual(a);

	// Sudo sinks the normal arches and raises the hidden clusters in their
	// place: only hidden files show, and nothing that stays moves.
	await sudo(page, "keys");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBe("shadow");
	await page.waitForTimeout(200);
	await shoot(page, "toggle-mid-rise");
	const midSprites = await archSprites(page);
	expect(Object.keys(midSprites).filter((id) => !isHidden(id))).toEqual([]);
	const hiddenMid = Object.keys(midSprites).filter(isHidden);
	expect(hiddenMid.length).toBeGreaterThan(0);
	await page.waitForTimeout(1200);
	const shadow = await snap(page);
	const afterSprites = await archSprites(page);
	expect(Object.keys(afterSprites).filter((id) => !isHidden(id))).toEqual([]);
	for (const c of before.clusters)
		expect(shadow.clusters.find((x) => x.id === c.id)).toEqual(c);
	// No normal file anywhere: arches, the portal index (spyglass), the map,
	// monsters (world, HUD counter, map), signs or edited marks.
	expect(shadow.portals.filter((p) => !isHidden(p.id))).toEqual([]);
	expect(shadow.mapPortals.filter((p) => !isHidden(p.id))).toEqual([]);
	for (const id of before.monsters) {
		expect(shadow.monsters, id).not.toContain(id);
		expect(shadow.mapMonsters, id).not.toContain(id);
	}
	const realmDrawn = await drawn(page);
	for (const id of beforeDrawn.monsterSprites)
		expect(realmDrawn.monsterSprites, id).not.toContain(id);
	expect(
		realmDrawn.monsterSprites.filter((id) => !shadow.monsters.includes(id)),
	).toEqual([]);
	expect(realmDrawn.signs.filter((p) => !isHidden(p))).toEqual([]);
	expect(realmDrawn.editedMarkers.filter((p) => !isHidden(p))).toEqual([]);
	// docs, with nothing hidden under it, draws only a small patch; root,
	// which a layer path still leaves, keeps its full clearing.
	expect(realmDrawn.ground[docsId]?.[0]).toBeLessThanOrEqual(110);
	expect(realmDrawn.ground[docsId]?.[1]).toBeLessThanOrEqual(80);
	expect(realmDrawn.ground[rootId]).toEqual(beforeDrawn.ground[rootId]);
	// The normal arch spots keep their places in the layout, undrawn.
	for (const [id, pos] of Object.entries(beforeDrawn.spots))
		expect(realmDrawn.spots[id], id).toEqual(pos);
	// The HUD counts only the realm's own monsters.
	const realmMonsters = shadow.monsters.length;
	expect(realmMonsters).toBeGreaterThan(0);
	await expect(page.getByText(/bugs? remains? in this world/)).toHaveText(
		`${realmMonsters} bug${realmMonsters === 1 ? "" : "s"} remain in this world`,
	);
	const hiddenIds = shadow.portals
		.filter((p) => isHidden(p.id))
		.map((p) => p.id);
	expect(hiddenIds.sort()).toEqual(Object.keys(HIDDEN_FILES).sort());
	expect(
		shadow.portals
			.filter((p) => p.layer)
			.map((p) => p.id)
			.sort(),
	).toEqual(hiddenIds.sort());
	expect(shadow.clusters.some((c) => c.layer)).toBe(true);
	expect(shadow.theme).toBe("shadow");
	// The nether skin is drawn: its textures loaded and in use.
	const shadowScenery = await scenery(page);
	expect(Object.values(shadowScenery.textures)).toEqual([
		true,
		true,
		true,
		true,
		true,
	]);
	expect(shadowScenery.archTextures).toEqual(["shadow-portal-arch"]);
	expect(shadowScenery.fieldTexture).toBe("shadow-netherrack-tiles");
	// Scenery stays put: every base piece still standing is where it was
	// (only pieces the hidden clusters and paths stand on go), the skyline
	// keeps every base piece (ponds and the windmill are items too).
	const beforeSet = new Set(beforeScenery.items);
	expect(shadowScenery.baseItems.filter((i) => !beforeSet.has(i))).toEqual([]);
	expect(shadowScenery.baseItems.length).toBeGreaterThan(
		beforeScenery.items.length * 0.5,
	);
	expect(shadowScenery.skyline.slice(0, beforeScenery.skyline.length)).toEqual(
		beforeScenery.skyline,
	);
	// Every placed piece wears a nether texture, none the tinted green art.
	const realmLook = await look(page);
	expect(realmLook.propTextures.length).toBeGreaterThan(0);
	expect(
		realmLook.propTextures.filter((k) => !k.startsWith("shadow-prop-")),
	).toEqual([]);
	expect(realmLook.unswappedScenery).toEqual([]);
	expect(realmLook.normalArt).toEqual([]);
	// The realm's monsters wear nether art; the dead mill's sails hang still.
	// A hidden cluster can stand where the windmill was, which removes it.
	const realmMills = shadowScenery.pois.filter((p) =>
		p.startsWith("windmill@"),
	).length;
	await expect
		.poll(async () => (await creatures(page)).sails.length, {
			timeout: 10_000,
		})
		.toBe(realmMills);
	const realmCreatures = await creatures(page);
	expect(realmCreatures.monsters.length).toBeGreaterThan(0);
	expect(
		realmCreatures.monsters.filter((k) => !k.startsWith("shadow-monster-")),
	).toEqual([]);
	if (realmMills > 0) {
		expect(
			realmCreatures.sails.filter(
				(s) => s.key !== "shadow-scenery-windmill-sails",
			),
		).toEqual([]);
		const [a, b] = await sailTurn(page);
		expect(b, "realm sails hold still").toEqual(a);
	}
	await expect(page.locator('[data-tool="spyglass"] img')).toHaveAttribute(
		"src",
		"/assets/shadow/ui_icon_spyglass_nether_soft.png",
	);
	await shoot(page, "day-shadow");

	// .env opens and reads.
	await walkToAndOpen(page, ".env");
	const envView = await snap(page);
	expect(envView.mode).toBe("file");
	expect(envView.content).toBe(HIDDEN_FILES[".env"]);
	await page.waitForTimeout(800);
	await shoot(page, "file-view-shadow");
	// The spellbook goes crimson too, and its icons lose their green.
	await page.locator('[data-tool="quill"]').click();
	await expect(page.locator(".cabn-spellbook-frame")).toBeVisible();
	await expect(page.locator('[data-tool="replace"] img')).toHaveAttribute(
		"src",
		"/assets/shadow/ui_tool_replace_nether_soft.png",
	);
	await expect(page.locator('[data-tool="goto"] img')).toHaveAttribute(
		"src",
		"/assets/shadow/ui_tool_goto_nether_soft.png",
	);
	await expect(page.locator('[data-tool="find"] img')).toHaveAttribute(
		"src",
		"/assets/placeholders/ui_tool_find_soft.png",
	);
	// Every icon image actually loaded (none fell back or broke).
	expect(
		await page.evaluate(() =>
			[...document.querySelectorAll<HTMLImageElement>(".cabn-pixel-root img")]
				.filter((img) => img.complete && img.naturalWidth === 0)
				.map((img) => img.getAttribute("src")),
		),
	).toEqual([]);
	await page.waitForTimeout(700);
	await shoot(page, "spellbook-shadow");
	await page.keyboard.press("Escape");
	await expect(page.locator(".cabn-spellbook-frame")).toBeHidden();
	await hold(page, "Escape");
	await expect
		.poll(async () => (await snap(page)).mode, { timeout: 10_000 })
		.toBe("world");

	// The realm's own monster, met in its file, is the nether gremlin, with nether battle frames.
	await walkToAndOpen(page, ".github/check.py");
	await expect
		.poll(async () => (await snap(page)).mode, { timeout: 10_000 })
		.toBe("file");
	await expect
		.poll(() =>
			page.evaluate(() => {
				const game = (
					window as unknown as {
						__cabnGame: {
							scene: { getScene(k: string): unknown };
							anims: { exists(k: string): boolean };
						};
					}
				).__cabnGame;
				const file = game.scene.getScene("file") as {
					monsterSprites: Map<string, { texture: { key: string } }>;
				};
				return {
					sprites: [...file.monsterSprites.values()].map((m) => m.texture.key),
					battle: [
						"shadow-monster-gremlin-hit:hit",
						"shadow-monster-gremlin-0:defeat",
					].map((k) => game.anims.exists(k)),
				};
			}),
		)
		.toEqual({
			sprites: expect.arrayContaining([
				expect.stringMatching(/^shadow-monster-gremlin-[01]$/),
			]),
			battle: [true, true],
		});
	await page.waitForTimeout(600);
	await shoot(page, "file-view-monster-shadow");
	await hold(page, "Escape");
	await expect
		.poll(async () => (await snap(page)).mode, { timeout: 10_000 })
		.toBe("world");

	// Editing .vscode/settings.json lands on disk with its mode kept, never in storage.
	await walkToAndOpen(page, ".vscode/settings.json");
	await page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		const state = s.activeFileState;
		if (!state) throw new Error("no buffer");
		const doc = state.doc.toString();
		const at = doc.indexOf("2");
		s.setActiveFileState(
			state.update({ changes: { from: at, to: at + 1, insert: "4" } }).state,
		);
	});
	await page.keyboard.press("ControlOrMeta+s");
	const settings = join(dir, ".vscode/settings.json");
	await expect
		.poll(() => readFile(settings, "utf8"), { timeout: 10_000 })
		.toBe('{\n\t"editor.tabSize": 4\n}\n');
	expect((await stat(settings)).mode & 0o777).toBe(0o600);
	await expect
		.poll(async () => (await snap(page)).dirty, { timeout: 10_000 })
		.toBe(false);
	await hold(page, "Escape");
	await expect
		.poll(async () => (await snap(page)).mode, { timeout: 10_000 })
		.toBe("world");
	const stored = await storageText(page);
	expect(stored).not.toContain("tabSize");
	expect(stored).not.toContain("SHADOW_E2E_ENV");
	expect(stored).not.toContain("shadowgithubcanary");

	// The orb finds hidden files with a badge while the realm shows.
	await page.waitForTimeout(800);
	await page.locator('[data-tool="orb"]').click();
	const input = page.getByPlaceholder("search the world...");
	await expect(input).toBeFocused();
	await input.fill("shadowgithubcanary");
	const content = page.locator(".cabn-crystal-ball-content");
	await expect(content.locator("li").first()).toContainText(".github/ci.yml", {
		timeout: 10_000,
	});
	await expect(content.getByTestId("layer-badge").first()).toBeVisible();
	await page.waitForTimeout(700);
	await shoot(page, "orb-shadow");
	// ...and no normal file, by its text or its name.
	for (const query of ["normalcanary", "greet", "hello"]) {
		await input.fill(query);
		await expect(content).toContainText("no matches", { timeout: 10_000 });
		await expect(content.locator("li")).toHaveCount(0);
	}
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	// A hidden arch is reached by clicking it, too.
	await clickArch(page, ".github/ci.yml");
	await expect
		.poll(async () => (await snap(page)).activePortalId, { timeout: 20_000 })
		.toBe(".github/ci.yml");
	expect((await snap(page)).content).toBe(HIDDEN_FILES[".github/ci.yml"]);
	await hold(page, "Escape");
	await expect
		.poll(async () => (await snap(page)).mode, { timeout: 10_000 })
		.toBe("world");

	// A sign in .github lands on disk (realm shadow).
	await page.evaluate(() => {
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.setSignDraft({
				path: null,
				near: { kind: "folder", path: ".github" },
				offset: null,
				body: "# Hidden note\n\nOnly the owner sees this.",
				suggestedPath: ".github/github.seyn",
			});
	});
	await expect(page.getByTestId("sign-editor")).toBeVisible();
	await page.getByTestId("sign-editor-save").click();
	await expect(page.getByTestId("sign-editor")).toBeHidden({ timeout: 10_000 });
	await expect
		.poll(
			async () =>
				(
					await stat(join(dir, ".github/github.seyn")).catch(() => null)
				)?.isFile() ?? false,
		)
		.toBe(true);
	expect(
		JSON.stringify(
			await (await fetch(`${new URL(url).origin}/world/signs.json`)).text(),
		),
	).not.toContain("github.seyn");

	// A direct request at .git/ is refused.
	const gitWrite = await page.evaluate(async (t) => {
		const res = await fetch("/owner/shadow/save", {
			method: "POST",
			headers: { "content-type": "application/json", "x-cabn-owner-token": t },
			body: JSON.stringify({
				path: ".git/config",
				content: "x",
				baseSha256: "0".repeat(64),
			}),
		});
		return res.status;
	}, token);
	expect(gitWrite).toBe(403);

	// The pet sees none of it, and while the realm shows no normal file either.
	const pet = await page.evaluate(async () => {
		const s = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		const world = s.petWorld;
		if (!world) return null;
		return {
			files: world.files().map((f) => f.path),
			search: (
				await world.search("canary shadowgithubcanary settings env", 50)
			).map((r) => r.path),
			env: await world.readText(".env"),
		};
	});
	expect(pet).not.toBeNull();
	expect(pet?.files).toEqual([]);
	expect(pet?.search).toEqual([]);
	expect(pet?.env).toBeNull();

	// For review: a normal folder with no hidden file under it keeps a small
	// patch of its clearing in the realm.
	if (TAKE_SHOTS) {
		const docs = await page.evaluate(() => {
			const s = (
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore.getState();
			return s.worldMap?.clusters.find((c) => c.label === "docs")?.pos ?? null;
		});
		expect(docs).not.toBeNull();
		await page.evaluate(
			(to) => {
				const game = (
					window as unknown as {
						__cabnGame: { scene: { getScene(k: string): unknown } };
					}
				).__cabnGame;
				const world = game.scene.getScene("world") as {
					player: { body: { x: number; y: number } };
					walker: {
						walkTo(
							p: { x: number; y: number },
							o: { from: { x: number; y: number }; speed: number },
						): void;
					};
				};
				world.walker.walkTo(
					{ x: to.x + 60, y: to.y + 40 },
					{
						from: { x: world.player.body.x, y: world.player.body.y },
						speed: 600,
					},
				);
			},
			docs as { x: number; y: number },
		);
		await page.waitForTimeout(4000);
		await shoot(page, "empty-clearing-shadow");
	}

	// The realm has no night: choosing Night while it shows changes nothing.
	await page.evaluate(() =>
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.setTimeOfDayOverride("night"),
	);
	await page.waitForTimeout(900);
	await expectDayLook(page);
	expect((await look(page)).override).toBe("night");
	await shoot(page, "night-shadow");

	// Toggling off takes everything hidden away again.
	await sudo(page, "mouse");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBeNull();
	await page.waitForTimeout(1200);
	const off = await snap(page);
	expect(off.portals.filter((p) => isHidden(p.id))).toEqual([]);
	expect(off.mapPortals.filter((p) => isHidden(p.id))).toEqual([]);
	expect(off.signs.filter(isHidden)).toEqual([]);
	expect(off.theme).toBeNull();
	for (const c of before.clusters)
		expect(off.clusters.find((x) => x.id === c.id)).toEqual(c);
	const offSprites = await archSprites(page);
	expect(offSprites).toEqual(beforeSprites);
	// Every normal file, monster and sign is back, the same ones in the same places.
	expect(off.portals).toEqual(before.portals);
	expect(off.mapPortals).toEqual(before.mapPortals);
	expect(off.monsters).toEqual(before.monsters);
	expect(off.mapMonsters).toEqual(before.mapMonsters);
	expect(off.signs).toEqual(before.signs);
	const offDrawn = await drawn(page);
	expect(offDrawn.monsterSprites.sort()).toEqual(
		[...beforeDrawn.monsterSprites].sort(),
	);
	expect(offDrawn.spots).toEqual(beforeDrawn.spots);
	expect(offDrawn.ground).toEqual(beforeDrawn.ground);
	expect(offDrawn.signs.sort()).toEqual([...beforeDrawn.signs].sort());
	await expect(page.getByText(/bugs? remains? in this world/)).toHaveText(
		`${before.monsters.length} bug${before.monsters.length === 1 ? "" : "s"} remain in this world`,
	);
	const petOff = await page.evaluate(async () => {
		const world = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState().petWorld;
		return world
			? {
					files: world.files().map((f) => f.path),
					search: (await world.search("normalcanary", 10)).map((r) => r.path),
				}
			: null;
	});
	expect(petOff?.files.length).toBe(before.portals.length);
	expect(petOff?.files.filter(isHidden)).toEqual([]);
	expect(petOff?.search).toEqual(["docs/notes.md"]);
	await page.locator('[data-tool="orb"]').click();
	await page.getByPlaceholder("search the world...").fill("normalcanary");
	await expect(
		page.locator(".cabn-crystal-ball-content li").first(),
	).toContainText("docs/notes.md", { timeout: 10_000 });
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	const offScenery = await scenery(page);
	expect(offScenery.items).toEqual(beforeScenery.items);
	expect(offScenery.pois).toEqual(beforeScenery.pois);
	expect(offScenery.skyline).toEqual(beforeScenery.skyline);
	expect(offScenery.archTextures).toEqual(["portal-arch-strip"]);
	// Off again, the normal world follows the Night setting.
	await expect.poll(async () => (await look(page)).blend).toBe(1);
	expect((await look(page)).timeOfDay).toBe("night");
	expect((await look(page)).theme).toBe("night");
	await shoot(page, "night-normal");

	// With the setting on Night, sudo shows the realm's day look; off, night is back.
	await sudo(page, "keys");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBe("shadow");
	await expectDayLook(page);
	await page.waitForTimeout(1200);
	await shoot(page, "sudo-at-night-setting");
	await sudo(page, "mouse");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBeNull();
	await expect.poll(async () => (await look(page)).blend).toBe(1);
	expect((await look(page)).timeOfDay).toBe("night");
	await page.waitForTimeout(1200);

	// A reload always starts with the realm off.
	await sudo(page, "mouse");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBe("shadow");
	await page.reload();
	await waitForWorld(page);
	await page.waitForTimeout(1000);
	const reloaded = await snap(page);
	expect(reloaded.activeLayerId).toBeNull();
	expect(reloaded.portals.filter((p) => isHidden(p.id))).toEqual([]);

	// Every shadow request went to /owner/shadow/* with the owner token, and no
	// hidden cluster was ever fetched from the world bundle.
	const shadowRequests = requests.filter((r) =>
		new URL(r.url).pathname.startsWith("/owner/shadow/"),
	);
	expect(shadowRequests.length).toBeGreaterThan(2);
	for (const r of shadowRequests) expect(r.token, r.url).toBe(token);
	const worldRequests = requests
		.map((r) => decodeURIComponent(new URL(r.url).pathname))
		.filter((p) => p.startsWith("/world/"));
	expect(worldRequests.filter((p) => /#shadow|\/\.[a-z]/i.test(p))).toEqual([]);
	expect(pageErrors).toEqual([]);
});
