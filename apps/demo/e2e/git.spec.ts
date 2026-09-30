import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// The git multiverse end to end, against the sample world's generated
// history (scripts/gen-git-fixture.mjs): the rift by the bonfire opens the
// universe picker, travelling reloads the world as another branch (badge,
// tint, its own files) and back, releases render safely, the pensieve shows
// a file's timeline, diff and a rebuilt past version, and the map timeline
// highlights what a commit changed. CABN_REVIEW_SHOTS=1 also writes review
// screenshots to assets/generated/review/git/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"git",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";

interface Snapshot {
	mode: string;
	playerPos: { x: number; y: number };
	riftPos: { x: number; y: number } | null;
	universeOpen: boolean;
	pensievePortalId: string | null;
	focusedPortalId: string | null;
	branch: string | null;
	universe: string | null;
	portals: string[];
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		const store = (
			window as unknown as {
				__cabnStore?: {
					getState(): {
						mode: string;
						playerPos: { x: number; y: number };
						riftPos: { x: number; y: number } | null;
						universeOpen: boolean;
						pensievePortalId: string | null;
						focusedPortalPreview: { portalId: string } | null;
						git: { branch: string; universe: { branch: string } | null } | null;
						portals: { id: string }[];
					};
				};
			}
		).__cabnStore;
		const s = store?.getState();
		return s
			? {
					mode: s.mode,
					playerPos: s.playerPos,
					riftPos: s.riftPos,
					universeOpen: s.universeOpen,
					pensievePortalId: s.pensievePortalId,
					focusedPortalId: s.focusedPortalPreview?.portalId ?? null,
					branch: s.git?.branch ?? null,
					universe: s.git?.universe?.branch ?? null,
					portals: s.portals.map((p) => p.id),
				}
			: undefined;
	});
}

async function holdKey(page: Page, key: string, ms = 150): Promise<void> {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
}

async function walkToward(
	page: Page,
	target: { x: number; y: number },
	within: number,
) {
	const deadline = Date.now() + 25_000;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(90);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

async function shoot(page: Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

/** Through the store, not the corner switch: a modal git panel covers the switch while it's open. */
async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await page.evaluate(
		(t) =>
			(
				window as unknown as {
					__cabnStore: {
						getState(): { setTimeOfDayOverride(t: string): void };
					};
				}
			).__cabnStore
				.getState()
				.setTimeOfDayOverride(t),
		tod,
	);
	await page.waitForTimeout(800);
}

async function enterSampleWorld(page: Page, errors: string[]) {
	page.on("pageerror", (err) => errors.push(err.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.riftPos ?? null, { timeout: 20_000 })
		.not.toBeNull();
	await page.waitForTimeout(1000);
}

async function openRift(page: Page, shotName?: string) {
	const rift = (await state(page))?.riftPos;
	if (!rift) throw new Error("no rift");
	await walkToward(page, rift, 36);
	if (shotName) {
		await page.waitForTimeout(600);
		await shoot(page, `${shotName}-day`);
		await setTimeOfDay(page, "night");
		await shoot(page, `${shotName}-night`);
		await setTimeOfDay(page, "day");
	}
	await holdKey(page, "Enter");
	await expect(page.getByTestId("universe-picker")).toBeVisible();
}

test("git: the rift switches universes and back; releases render safely", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors: string[] = [];
	await enterSampleWorld(page, errors);
	await setTimeOfDay(page, "day");
	await expect(page.getByTestId("universe-badge")).toContainText("main");
	expect((await state(page))?.branch).toBe("main");
	await page.keyboard.press("m");
	await expect(page.getByTestId("map-rift")).toBeVisible();
	await page.keyboard.press("Escape");

	// The pack starts loading when the rift opens; holding it back keeps the
	// on-demand conversion (which needs it) on its loading swirl long enough to see.
	await page.route("**/git/objects/pack/*.pack", async (route) => {
		await new Promise((r) => setTimeout(r, 6000));
		await route.continue();
	});
	await openRift(page, "rift-main");
	const before = (await state(page))?.playerPos;
	await holdKey(page, "ArrowLeft", 300);
	expect((await state(page))?.playerPos).toEqual(before);
	await expect(page.getByTestId("universe-branch")).toHaveCount(3);
	await shoot(page, "picker-universes-day");

	await page.getByRole("tab", { name: "Tags & releases" }).click();
	const release = page.getByTestId("universe-release").first();
	await expect(release).toContainText("Full bloom");
	const asset = release.getByRole("link", { name: "lantern-garden-1.0.0.zip" });
	await expect(asset).toHaveAttribute("target", "_blank");
	await expect(asset).toHaveAttribute("rel", "noopener noreferrer");
	await expect(page.getByTestId("universe-picker")).toContainText(
		"<script>alert('stays text')</script>",
	);
	expect(
		await page.locator("[data-testid=universe-picker] script").count(),
	).toBe(0);
	await shoot(page, "picker-releases-day");

	await page.getByRole("tab", { name: "Universes" }).click();
	// The conversion runs under the shared loading panel (it only shows if the
	// wait passes its delay), so check the load itself was announced.
	await page.evaluate(() => {
		const w = window as unknown as {
			__loadingLabels: string[];
			__cabnStore: {
				subscribe(
					fn: (s: { loading: { active: boolean; label: string } }) => void,
				): () => void;
			};
		};
		w.__loadingLabels = [];
		w.__cabnStore.subscribe((s) => {
			if (s.loading.active) w.__loadingLabels.push(s.loading.label);
		});
	});
	await page
		.locator(
			'[data-testid=universe-branch][data-branch="feature/lantern-festival"]',
		)
		.getByRole("button", { name: "Travel" })
		.click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __loadingLabels: string[] }).__loadingLabels,
			),
		)
		.toContain("Opening the rift to feature/lantern-festival…");
	if (await page.getByTestId("loading-overlay").isVisible())
		await shoot(page, "universe-loading-day");
	await expect
		.poll(async () => (await state(page))?.universe, { timeout: 20_000 })
		.toBe("feature/lantern-festival");
	await expect(page.getByTestId("universe-badge")).toContainText(
		"feature/lantern-festival",
	);
	await expect
		.poll(async () => (await state(page))?.portals ?? [], { timeout: 10_000 })
		.toContain("docs/lantern-festival.md");
	await page.waitForTimeout(1200);
	await shoot(page, "universe-feature-day");

	// The universe was built in this browser from the shipped objects; a secret-named file is not shipped.
	await page.evaluate(() =>
		(
			window as unknown as {
				__cabnStore: { getState(): { setPensievePortalId(id: string): void } };
			}
		).__cabnStore
			.getState()
			.setPensievePortalId("config/credentials.json"),
	);
	await expect(page.getByTestId("pensieve-not-shipped")).toContainText(
		"Not shipped",
	);
	await shoot(page, "pensieve-not-shipped-day");
	await page.keyboard.press("Escape");
	await setTimeOfDay(page, "night");
	await shoot(page, "universe-feature-night");
	await setTimeOfDay(page, "day");

	await expect
		.poll(async () => (await state(page))?.riftPos ?? null, { timeout: 10_000 })
		.not.toBeNull();
	await openRift(page, "rift-universe");
	await page
		.locator('[data-testid=universe-branch][data-branch="main"]')
		.getByRole("button", { name: "Return" })
		.click();
	await expect
		.poll(async () => (await state(page))?.universe ?? "main", {
			timeout: 20_000,
		})
		.toBe("main");
	await expect
		.poll(async () => (await state(page))?.portals ?? [], { timeout: 10_000 })
		.not.toContain("docs/lantern-festival.md");
	expect(errors).toEqual([]);
});

test("git: the pensieve shows a file's timeline, diff and a rebuilt past version", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors: string[] = [];
	await enterSampleWorld(page, errors);
	await setTimeOfDay(page, "day");
	await page.evaluate(() =>
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId: "README.md" }),
	);
	await expect
		.poll(async () => (await state(page))?.focusedPortalId, { timeout: 20_000 })
		.toBe("README.md");
	await expect(page.getByTestId("dock-pensieve")).toBeVisible();
	await page.keyboard.press("h");
	const pensieve = page.getByTestId("pensieve");
	await expect(pensieve).toBeVisible();
	await expect(page.getByTestId("pensieve-entry")).toHaveCount(2);
	const diff = page.getByTestId("pensieve-diff");
	await expect(diff).toBeVisible();
	expect(await diff.locator("[data-diff-kind=add]").count()).toBeGreaterThan(0);
	expect(await diff.locator("[data-diff-kind=del]").count()).toBeGreaterThan(0);
	await shoot(page, "pensieve-diff-day");
	await setTimeOfDay(page, "night");
	await shoot(page, "pensieve-diff-night");
	await setTimeOfDay(page, "day");

	await page.getByTestId("pensieve-entry").last().click();
	await page.getByTestId("pensieve-show-version").click();
	await expect(page.getByTestId("pensieve-version")).toContainText(
		"write the rest of this README",
	);
	await shoot(page, "pensieve-version-day");
	await page.keyboard.press("Escape");
	await expect(pensieve).toHaveCount(0);

	// History ships as-is: a file with a planted key shows its real diff (its magpie is the warning).
	await page.evaluate(() =>
		(
			window as unknown as {
				__cabnStore: { getState(): { setPensievePortalId(id: string): void } };
			}
		).__cabnStore
			.getState()
			.setPensievePortalId("src/plantNamer.ts"),
	);
	await expect(page.getByTestId("pensieve-diff")).toBeVisible();
	await page.keyboard.press("Escape");

	// Inside a file the pensieve is Alt/Option+H, and Esc closes it without leaving the file.
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 10_000 })
		.toBe("file");
	await page.waitForTimeout(600);
	await page.keyboard.press("Alt+KeyH");
	await expect(pensieve).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(pensieve).toHaveCount(0);
	expect((await state(page))?.mode).toBe("file");
	expect(errors).toEqual([]);
});

test("git: the map timeline highlights the files a commit changed", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const errors: string[] = [];
	await enterSampleWorld(page, errors);
	await setTimeOfDay(page, "day");
	await page.keyboard.press("m");
	await expect(page.getByTestId("map-timeline")).toBeVisible();
	// The map never pulls the pack in by itself.
	await page.getByTestId("map-timeline-load").click();
	await expect(page.getByTestId("map-timeline-slider")).toBeVisible();
	await expect(page.getByTestId("map-portal-changed")).toHaveCount(0);
	// Newest main commit ("Full bloom") changes nothing; one step older is the README polish.
	await page.getByRole("button", { name: "Older commit" }).click();
	await page.getByRole("button", { name: "Older commit" }).click();
	await expect(page.getByTestId("map-timeline-commit")).toContainText(
		"Polish the README",
	);
	await expect(
		page.locator(
			'[data-testid=map-portal-changed][data-portal-id="README.md"]',
		),
	).toHaveCount(1);
	await shoot(page, "map-timeline-day");
	const slider = page.getByTestId("map-timeline-slider");
	await slider.focus();
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByTestId("map-timeline-commit")).toContainText(
		"Tests, the seed script",
	);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("world-map")).toHaveCount(0);
	expect(errors).toEqual([]);
});
