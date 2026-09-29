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
// dotfile fixture is ever committed): the sudo item (H) raises the hidden
// clusters without moving anything visible, hidden files open and save to
// disk, a hidden-folder sign lands on disk, pets never see any of it, and a
// reload starts with the realm off. CABN_REVIEW_SHOTS=1 writes the review
// screenshots to assets/generated/review/shadow/.

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
const SHOTS_DIR = join(REPO, "assets", "generated", "review", "shadow");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PORT = Number(process.env.CABN_SHADOW_E2E_PORT ?? 5043);

const HIDDEN_FILES: Record<string, string> = {
	".env": "SHADOW_E2E_ENV=canary\n",
	".github/ci.yml": "name: ci\non: push\n# shadowgithubcanary\n",
	".vscode/settings.json": '{\n\t"editor.tabSize": 2\n}\n',
};

let dir: string;
let serve: ChildProcess | undefined;
let url: string;

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-shadow-e2e-"));
	await cp(FIXTURE, dir, { recursive: true });
	for (const [path, content] of Object.entries(HIDDEN_FILES)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	await chmod(join(dir, ".vscode/settings.json"), 0o600);
	serve = spawn(
		process.execPath,
		[CLI, "serve", dir, "--port", String(PORT), "--offline", "--owner"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	url = await new Promise<string>((resolveUrl, rejectUrl) => {
		let out = "";
		const timer = setTimeout(
			() => rejectUrl(new Error(`cabn serve never printed its url: ${out}`)),
			30_000,
		);
		serve?.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			const m =
				/cabn serve: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(out);
			if (m?.[1]) {
				clearTimeout(timer);
				resolveUrl(m[1]);
			}
		});
		serve?.stderr?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		serve?.once("exit", (code) =>
			rejectUrl(new Error(`cabn serve exited (${code}): ${out}`)),
		);
	});
});

test.afterAll(async () => {
	serve?.kill("SIGINT");
	await new Promise((r) => setTimeout(r, 300));
	if (serve && serve.exitCode === null) serve.kill("SIGKILL");
	await rm(dir, { recursive: true, force: true });
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

test("owner: the sudo item raises the shadow realm, hidden files read and save to disk, and nothing leaks", async ({
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
	await expect(page.locator('[data-tool="sudo"]')).toBeVisible({
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
	await shoot(page, "day-normal");

	// H raises the hidden clusters; nothing visible moves, even mid-rise.
	await page.keyboard.press("h");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBe("shadow");
	await page.waitForTimeout(200);
	await shoot(page, "toggle-mid-rise");
	const midSprites = await archSprites(page);
	for (const [id, pos] of Object.entries(beforeSprites))
		expect(midSprites[id], id).toEqual(pos);
	const hiddenMid = Object.keys(midSprites).filter(isHidden);
	expect(hiddenMid.length).toBeGreaterThan(0);
	await page.waitForTimeout(1200);
	const shadow = await snap(page);
	const afterSprites = await archSprites(page);
	for (const [id, pos] of Object.entries(beforeSprites))
		expect(afterSprites[id], id).toEqual(pos);
	for (const c of before.clusters)
		expect(shadow.clusters.find((x) => x.id === c.id)).toEqual(c);
	for (const p of before.mapPortals)
		expect(shadow.mapPortals.find((x) => x.id === p.id)).toEqual(p);
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
	await shoot(page, "day-shadow");

	// .env opens and reads.
	await walkToAndOpen(page, ".env");
	const envView = await snap(page);
	expect(envView.mode).toBe("file");
	expect(envView.content).toBe(HIDDEN_FILES[".env"]);
	await page.waitForTimeout(800);
	await shoot(page, "file-view-shadow");
	// The spellbook goes crimson too.
	await page.locator('[data-tool="quill"]').click();
	await expect(page.locator(".cabn-spellbook-frame")).toBeVisible();
	await page.waitForTimeout(700);
	await shoot(page, "spellbook-shadow");
	await page.keyboard.press("Escape");
	await expect(page.locator(".cabn-spellbook-frame")).toBeHidden();
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
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

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

	// The pet sees none of it.
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
	expect(pet?.files.length).toBeGreaterThan(0);
	expect(pet?.files.filter(isHidden)).toEqual([]);
	expect(pet?.search.filter(isHidden)).toEqual([]);
	expect(pet?.env).toBeNull();

	// Night shots of both realms.
	await page.evaluate(() =>
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.setTimeOfDayOverride("night"),
	);
	await page.waitForTimeout(900);
	await shoot(page, "night-shadow");

	// Toggling off takes everything hidden away again.
	await page.keyboard.press("h");
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
	expect(Object.keys(offSprites).filter(isHidden)).toEqual([]);
	for (const [id, pos] of Object.entries(beforeSprites))
		expect(offSprites[id], id).toEqual(pos);
	await shoot(page, "night-normal");

	// A reload always starts with the realm off.
	await page.keyboard.press("h");
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
