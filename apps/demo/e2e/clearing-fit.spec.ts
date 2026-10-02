import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./cspGuard";

// 2026-09-29: each clearing's ground ellipse grows in height until its
// portal ring's arches fit (@cabn/converter's clearingFit.ts).
// CABN_REVIEW_SHOTS=1 writes shots to assets/generated/review/clearing-fit/,
// prefixed with CABN_REVIEW_PREFIX (default "after").

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"clearing-fit",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PREFIX = process.env.CABN_REVIEW_PREFIX ?? "after";

interface Snapshot {
	activeWorldBase: string | null;
	playerPos: { x: number; y: number };
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: { getState(): Snapshot };
			}
		).__cabnStore;
		const s = store?.getState();
		return s
			? { activeWorldBase: s.activeWorldBase, playerPos: s.playerPos }
			: undefined;
	});
}

async function holdKeys(page: Page, keys: string[], ms: number) {
	for (const k of keys) await page.keyboard.down(k);
	await page.waitForTimeout(ms);
	for (const k of keys) await page.keyboard.up(k);
}

async function walkToward(
	page: Page,
	target: { x: number; y: number },
	within: number,
) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		await holdKeys(page, keys, 150);
	}
	throw new Error("walkToward timed out");
}

async function enterSampleWorld(page: Page) {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKeys(page, ["Enter"], 150);
	await expect
		.poll(async () => (await state(page))?.activeWorldBase, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(1500);
}

interface ArchFit {
	cluster: string;
	portal: string;
	/** Ellipse value ((x/rx)^2 + (y/ry)^2) at the arch's roof and base, relative to its clearing; <= 1 is on the ground. */
	roof: number;
	base: number;
}

/** Every arch sprite's top and bottom edge (its displayed size, not a constant) against its clearing's ellipse as the running scene sized it. */
function archFits(page: Page): Promise<ArchFit[]> {
	return page.evaluate(() => {
		type Pos = { x: number; y: number };
		const scene = (
			window as unknown as {
				__cabnGame: { scene: { getScene(k: string): unknown } };
			}
		).__cabnGame.scene.getScene("world") as {
			manifest: {
				clusters: { id: string; pos: Pos; portalIds: string[] }[];
			};
			portalSprites: Map<string, Pos & { displayHeight: number }>;
			groundRadius(c: unknown): number;
			groundRadiusY(c: unknown): number;
		};
		const out: ArchFit[] = [];
		for (const c of scene.manifest.clusters) {
			const rx = scene.groundRadius(c);
			const ry = scene.groundRadiusY(c);
			const at = (x: number, y: number) =>
				((x - c.pos.x) / rx) ** 2 + ((y - c.pos.y) / ry) ** 2;
			for (const id of c.portalIds) {
				const s = scene.portalSprites.get(id);
				if (!s) continue;
				out.push({
					cluster: c.id,
					portal: id,
					roof: at(s.x, s.y - s.displayHeight / 2),
					base: at(s.x, s.y + s.displayHeight / 2),
				});
			}
		}
		return out;
	});
}

async function frameCluster(page: Page, clusterId: string, zoom: number) {
	await page.evaluate(
		({ id, z }) => {
			const scene = (
				window as unknown as {
					__cabnGame: { scene: { getScene(k: string): unknown } };
				}
			).__cabnGame.scene.getScene("world") as {
				manifest: { clusters: { id: string; pos: { x: number; y: number } }[] };
				cameras: {
					main: {
						stopFollow(): void;
						setZoom(z: number): void;
						centerOn(x: number, y: number): void;
					};
				};
			};
			const c = scene.manifest.clusters.find((k) => k.id === id);
			if (!c) throw new Error(`no cluster ${id}`);
			scene.cameras.main.stopFollow();
			scene.cameras.main.setZoom(z);
			scene.cameras.main.centerOn(c.pos.x, c.pos.y);
		},
		{ id: clusterId, z: zoom },
	);
	await page.waitForTimeout(500);
}

async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page.evaluate((t) => {
		(
			window as unknown as {
				__cabnStore: {
					getState(): { setTimeOfDayOverride(t: string): void };
				};
			}
		).__cabnStore
			.getState()
			.setTimeOfDayOverride(t);
	}, tod);
	await page.waitForTimeout(800);
}

test("every root arch sits inside its clearing at 1280x720", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await enterSampleWorld(page);
	const fits = await archFits(page);
	const root = fits.filter((f) => f.cluster === "root");
	expect(root.length).toBeGreaterThan(0);
	for (const f of fits) {
		expect(f.roof, `${f.portal} roof`).toBeLessThanOrEqual(1);
		expect(f.base, `${f.portal} base`).toBeLessThanOrEqual(1);
	}
});

test("clearing review shots", async ({ page }) => {
	test.skip(!TAKE_SHOTS, "CABN_REVIEW_SHOTS=1 only");
	test.setTimeout(120_000);
	await enterSampleWorld(page);
	await mkdir(SHOTS_DIR, { recursive: true });
	const framings: [string, number][] = [
		["root", 0.62],
		["scripts", 1],
		["docs", 1],
	];
	for (const tod of ["day", "night"] as const) {
		await setTimeOfDay(page, tod);
		for (const [cluster, zoom] of framings) {
			await frameCluster(page, cluster, zoom);
			await writeFile(
				join(SHOTS_DIR, `${PREFIX}-${cluster}-${tod}.png`),
				await page.screenshot(),
			);
		}
	}
});
