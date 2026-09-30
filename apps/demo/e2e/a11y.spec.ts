import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import * as git from "isomorphic-git";

// The M10 a11y pass's automated sweep — see docs/testing/2026-09-30-a11y.md
// for the full write-up, what's fixed and what's a reported (not fixed)
// design decision. Split from the rest of e2e/ rather than folded into the
// specs above because it asks a different question of the same app: not "did
// this feature work" but "is every one of these panels a well-formed dialog,
// keyboard-reachable, and non-violating" — run at four viewports, which none
// of the feature specs vary.
//
// color-contrast is deliberately excluded from every axe run below: contrast
// is checked precisely against the real theme tokens in
// packages/engine/tests/{editorThemeContrast,uiContrast}.test.ts (day/night/
// crimson, exact hex pairs), which catches the same defects axe's rendered-
// DOM sampling would, without also flagging panels that sit over the
// game canvas (whose Phaser-drawn background axe can't see) as false
// positives.
const AXE_DISABLED_RULES = ["color-contrast"];

async function scan(page: Page, selector?: string): Promise<void> {
	const builder = new AxeBuilder({ page }).disableRules(AXE_DISABLED_RULES);
	if (selector) builder.include(selector);
	const results = await builder.analyze();
	const bad = results.violations.filter(
		(v) => v.impact === "serious" || v.impact === "critical",
	);
	expect(
		bad,
		bad
			.map(
				(v) =>
					`${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => n.target.join(" ")).join("\n")}`,
			)
			.join("\n\n"),
	).toEqual([]);
}

interface Snap {
	mode: string;
	playerPos: { x: number; y: number };
	signs: Array<{ path: string }>;
	monsters: Array<{ id: string }>;
	portals: Array<{ id: string }>;
	git: boolean;
}

function state(page: Page): Promise<Snap> {
	return page.evaluate(() => {
		const s = (
			window as unknown as {
				__cabnStore: { getState(): Record<string, unknown> };
			}
		).__cabnStore.getState();
		return {
			mode: s.mode as string,
			playerPos: s.playerPos as { x: number; y: number },
			signs: s.signs as Array<{ path: string }>,
			monsters: s.monsters as Array<{ id: string }>,
			portals: s.portals as Array<{ id: string }>,
			git: s.git !== null,
		};
	});
}

async function storeCall(page: Page, method: string, ...args: unknown[]) {
	await page.evaluate(
		({ method, args }) => {
			const store = (
				window as unknown as {
					__cabnStore: {
						getState(): Record<string, (...a: unknown[]) => void>;
					};
				}
			).__cabnStore;
			store.getState()[method]?.(...args);
		},
		{ method, args },
	);
}

async function holdKey(page: Page, key: string, ms = 150) {
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
		const pos = (await state(page)).playerPos;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys: string[] = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(120);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

/** Every panel this pass fixed traps Tab inside itself now — this confirms it for real, not by reading the source. */
async function assertTabStaysWithin(page: Page, containerSelector: string) {
	const container = page.locator(containerSelector);
	await expect(container).toBeVisible();
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press("Tab");
		const inside = await page.evaluate((sel) => {
			const root = document.querySelector(sel);
			return !!root && root.contains(document.activeElement);
		}, containerSelector);
		expect(inside, `Tab #${i + 1} left ${containerSelector}`).toBe(true);
	}
}

async function bootWorld(
	page: Page,
	viewport: { width: number; height: number },
) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewportSize(viewport);
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1200);
	// shelf.json puts the sample world due north (see guide.spec.ts).
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page)).mode, { timeout: 15_000 })
		.toBe("world");
	await page.waitForTimeout(1200);
	return errors;
}

const VIEWPORTS = [
	{ name: "1024x768", width: 1024, height: 768 },
	{ name: "1280x800 (baseline)", width: 1280, height: 800 },
	{ name: "1920x1200", width: 1920, height: 1200 },
	{ name: "~800 wide", width: 800, height: 700 },
] as const;

for (const viewport of VIEWPORTS) {
	test(`a11y sweep (base HUD + spyglass/orb/map/guide): ${viewport.name}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const errors = await bootWorld(page, viewport);

		// Base HUD: hotbar, minimap, settings corner, monster counter,
		// universe badge, pet corner — nothing open.
		await scan(page);

		// Spyglass (non-modal HUD tray — see pixelTheme.tsx's own backdrop-
		// less styling; not wrapped in a focus trap on purpose).
		await page.keyboard.press("l");
		await scan(page, ".cabn-spyglass-frame");
		await page.keyboard.press("Escape");
		await expect(page.locator(".cabn-spyglass-frame")).toHaveCount(0);

		// Orb search — a real modal now (role="dialog", aria-modal, trapped).
		await page.keyboard.press("f");
		const orb = page.locator('[role="dialog"][aria-label="Search"]');
		await expect(orb).toBeVisible();
		await scan(page, ".cabn-crystal-ball");
		await assertTabStaysWithin(page, ".cabn-crystal-ball");
		await page.keyboard.press("Escape");
		await expect(orb).toHaveCount(0);

		// World map: minimap first, then the full dialog (already had its own
		// hand-rolled Tab trap before this pass — confirmed still works).
		await scan(page, '[data-testid="world-minimap"]');
		await page.keyboard.press("m");
		const map = page.getByTestId("world-map");
		await expect(map).toBeVisible();
		await scan(page, '[data-testid="world-map"]');
		await assertTabStaysWithin(page, '[data-testid="world-map"]');
		await page.keyboard.press("Escape");
		await expect(map).toHaveCount(0);

		// Guide dialog: content is static (see GuideDialog.tsx), so opening it
		// through the store directly (same pattern pets.spec.ts's storeCall
		// uses) is exercising the exact same render the NPC's own click-to-
		// talk flow produces (see guide.spec.ts), just without re-walking to
		// her every viewport.
		await storeCall(page, "setGuideOpen", true);
		const guide = page.getByTestId("guide-dialog");
		await expect(guide).toBeVisible();
		await scan(page, '[data-testid="guide-dialog"]');
		await assertTabStaysWithin(page, '[data-testid="guide-dialog"]');
		await page.keyboard.press("Escape");
		await expect(guide).toHaveCount(0);

		expect(errors).toEqual([]);
	});
}

test("a11y sweep (every remaining panel, 1280x800): sign reader, bag, pensieve, rift, encounter, pets, file + spellbook", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors = await bootWorld(page, { width: 1280, height: 800 });

	// Sign reader — a real sign from the sample project (welcome.seyn at root).
	const signs = (await state(page)).signs;
	const signPath = signs[0]?.path;
	if (signPath) {
		await storeCall(page, "setOpenSign", signPath);
		const reader = page.getByTestId("sign-reader");
		await expect(reader).toBeVisible();
		await scan(page, '[data-testid="sign-reader"]');
		await assertTabStaysWithin(page, '[data-testid="sign-reader"]');
		await page.keyboard.press("Escape");
		await expect(reader).toHaveCount(0);
	}

	// Bag tray — non-modal (see BagTray.tsx), so no Tab-trap assertion, only
	// that the toggle has a real name and the tray itself is clean.
	const portalId = (await state(page)).portals[0]?.id;
	if (portalId) {
		await storeCall(page, "addBagSlot", {
			id: "a11y-e2e-slot",
			text: "const x = 1;",
			sourcePortalId: portalId,
			startLine: 0,
			endLine: 0,
		});
		const closed = page.locator(".cabn-satchel-closed");
		await expect(closed).toBeVisible();
		await expect(closed).toHaveAccessibleName(/open bag/i);
		await closed.click();
		await expect(page.locator(".cabn-satchel-open")).toBeVisible();
		await scan(page, ".cabn-satchel-open");
		await page.keyboard.press("Escape");
		await expect(page.locator(".cabn-satchel-open")).toHaveCount(0);
	}

	// Pensieve — only meaningful with real git history, which the sample
	// project build carries (see git.spec.ts).
	if ((await state(page)).git && portalId) {
		await storeCall(page, "setPensievePortalId", portalId);
		const pensieve = page.getByTestId("pensieve");
		await expect(pensieve).toBeVisible();
		await page.waitForTimeout(500);
		await scan(page, '[data-testid="pensieve"]');
		await assertTabStaysWithin(page, '[data-testid="pensieve"]');
		await page.keyboard.press("Escape");
		await expect(pensieve).toHaveCount(0);

		// The rift (universe picker) — same git context.
		await storeCall(page, "setUniverseOpen", true);
		const rift = page.getByTestId("universe-picker");
		await expect(rift).toBeVisible();
		await scan(page, '[data-testid="universe-picker"]');
		await assertTabStaysWithin(page, '[data-testid="universe-picker"]');
		await page.keyboard.press("Escape");
		await expect(rift).toHaveCount(0);
	}

	// Pet setup panel, opened for real through its corner button.
	await expect(page.getByTestId("cabn-pet-corner")).toBeVisible({
		timeout: 20_000,
	});
	await page.getByTestId("cabn-pet-corner").click();
	const petPanel = page.getByTestId("cabn-pet-panel");
	await expect(petPanel).toBeVisible();
	await scan(page, '[data-testid="cabn-pet-panel"]');
	await assertTabStaysWithin(page, '[data-testid="cabn-pet-panel"]');
	await page.keyboard.press("Escape");
	await expect(petPanel).toHaveCount(0);

	// Pet chat + a proposal review card, built directly through the store
	// (same shape pets.spec.ts's mocked-provider flow ends up producing) —
	// no real provider request leaves this test.
	await storeCall(page, "setPetProvider", "anthropic");
	await storeCall(page, "setPetChatOpen", true);
	const chat = page.getByTestId("cabn-pet-chat");
	await expect(chat).toBeVisible();
	await scan(page, '[data-testid="cabn-pet-chat"]');
	await assertTabStaysWithin(page, '[data-testid="cabn-pet-chat"]');
	await page.keyboard.press("Escape");
	await expect(chat).toHaveCount(0);

	// File view, the spellbook, its toolbar and two of its three tool
	// dialogs (Go to line, Go to symbol — Rename needs a real symbol under
	// the caret, covered qualitatively by reading SpellbookDialogs.tsx and
	// by fixing it identically to the other two, not re-walked here).
	if (portalId) {
		await page.evaluate((id) => {
			(
				window as unknown as {
					__cabnBus: { emit(e: string, p: unknown): void };
				}
			).__cabnBus.emit("tool:walk-to-portal", { portalId: id });
		}, portalId);
		// Same wait spellbook-serve.spec.ts uses: the walk is done once the
		// player's arrival is reflected in focusedPortalPreview, not mode
		// (mode only changes once Enter below actually opens the file).
		await page.waitForFunction(
			(id) =>
				(
					window as unknown as {
						__cabnStore: {
							getState(): {
								focusedPortalPreview: { portalId: string } | null;
							};
						};
					}
				).__cabnStore.getState().focusedPortalPreview?.portalId === id,
			portalId,
			{ timeout: 20_000 },
		);
		await page.waitForTimeout(500);
		await holdKey(page, "Enter");
		await expect
			.poll(async () => (await state(page)).mode, { timeout: 10_000 })
			.toBe("file");
		await page.waitForTimeout(500);
		await scan(page, '[data-testid="cabn-file-status"]');
		const caretInput = page.getByTestId("cabn-file-caret-input");
		await expect(caretInput).toHaveAccessibleName(
			new RegExp(`Edit ${portalId}`),
		);

		// The caret textarea owns plain keys while it's focused, so opening the
		// quill from inside a file is the Alt chord (see ToolHotbar's own
		// "writing" comment and spellbook-serve.spec.ts's identical keypress).
		await page.keyboard.press("Alt+KeyQ");
		await expect
			.poll(async () => (await state(page)).mode, { timeout: 10_000 })
			.toBe("editor");
		await page.waitForTimeout(600);
		await scan(page, ".cabn-spellbook-toolbar");

		const goto = page.locator('[data-tool="goto"]');
		if (await goto.count()) {
			await goto.click();
			const gotoDialog = page.getByRole("dialog", { name: "Go to line" });
			await expect(gotoDialog).toBeVisible();
			await scan(page, '[role="dialog"][aria-label="Go to line"]');
			await assertTabStaysWithin(
				page,
				'[role="dialog"][aria-label="Go to line"]',
			);
			await page.keyboard.press("Escape");
			await expect(gotoDialog).toHaveCount(0);
		}

		const symbol = page.locator('[data-tool="symbol"]');
		if (await symbol.count()) {
			await symbol.click();
			const symbolDialog = page.getByRole("dialog", { name: "Go to symbol" });
			await expect(symbolDialog).toBeVisible();
			await scan(page, '[role="dialog"][aria-label="Go to symbol"]');
			await assertTabStaysWithin(
				page,
				'[role="dialog"][aria-label="Go to symbol"]',
			);
			await page.keyboard.press("Escape");
			await expect(symbolDialog).toHaveCount(0);
		}

		// Pet proposal review, on the same file that's open right now.
		await storeCall(page, "addPetProposals", [
			{
				id: "a11y-e2e-proposal",
				path: portalId,
				status: "pending",
				before: "",
				after: "",
				summary: "a11y sweep test proposal",
			},
		]);
		const review = page.getByTestId("cabn-pet-proposal");
		if (await review.count())
			await scan(page, '[data-testid="cabn-pet-proposal"]');

		await page.keyboard.press("Escape");
		await expect
			.poll(async () => (await state(page)).mode, { timeout: 10_000 })
			.toBe("file");
	}

	// Encounter popup, triggered directly (see setGuideOpen's comment above
	// for the same reasoning) rather than by really clicking a monster —
	// last, since endEncounter() always lands in "file" mode regardless of
	// where the encounter really started, which would otherwise strand a
	// later step that needs "world".
	const monsterId = (await state(page)).monsters[0]?.id;
	if (monsterId) {
		await storeCall(page, "startEncounter", monsterId);
		const popup = page.getByTestId("cabn-encounter-popup");
		await expect(popup).toBeVisible();
		await scan(page, '[data-testid="cabn-encounter-popup"]');
		await page.keyboard.press("Escape");
		await expect(popup).toHaveCount(0);
	}

	expect(errors).toEqual([]);
});

// ── Owner mode: a real `cabn serve --owner`, per the task brief. ──
const OWNER_PORT = Number(process.env.CABN_A11Y_OWNER_E2E_PORT ?? 5044);
const ownerHere = dirname(fileURLToPath(import.meta.url));
const OWNER_REPO_ROOT = join(ownerHere, "..", "..", "..");
const OWNER_CLI = join(OWNER_REPO_ROOT, "packages", "cli", "dist", "main.js");
const OWNER_FIXTURE = join(
	OWNER_REPO_ROOT,
	"packages",
	"cli",
	"tests",
	"fixtures",
	"serve-project",
);
const OWNER_AUTHOR = {
	name: "A11y Sweep",
	email: "a11y@lantern-garden.invalid",
};

let ownerDir: string;
let ownerServe: ChildProcess | undefined;
let ownerUrl: string;

test.beforeAll(async () => {
	ownerDir = await mkdtemp(join(tmpdir(), "cabn-a11y-owner-e2e-"));
	await cp(OWNER_FIXTURE, ownerDir, { recursive: true });
	fs.writeFileSync(join(ownerDir, ".editorconfig"), "root = true\n");
	await git.init({ fs, dir: ownerDir, defaultBranch: "main" });
	for (const name of fs.readdirSync(ownerDir)) {
		if (name === ".git") continue;
		await git.add({ fs, dir: ownerDir, filepath: name });
	}
	await git.commit({
		fs,
		dir: ownerDir,
		message: "first",
		author: OWNER_AUTHOR,
	});
	ownerServe = spawn(
		process.execPath,
		[
			OWNER_CLI,
			"serve",
			ownerDir,
			"--port",
			String(OWNER_PORT),
			"--offline",
			"--owner",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	ownerUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
		let out = "";
		const timer = setTimeout(
			() => rejectUrl(new Error(`cabn serve never printed its url: ${out}`)),
			30_000,
		);
		ownerServe?.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			const m =
				/cabn serve: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(out);
			if (m?.[1]) {
				clearTimeout(timer);
				resolveUrl(m[1]);
			}
		});
		ownerServe?.stderr?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		ownerServe?.once("exit", (code) =>
			rejectUrl(new Error(`cabn serve exited (${code}): ${out}`)),
		);
	});
});

test.afterAll(async () => {
	ownerServe?.kill("SIGINT");
	await new Promise((r) => setTimeout(r, 300));
	if (ownerServe && ownerServe.exitCode === null) ownerServe.kill("SIGKILL");
	await rm(ownerDir, { recursive: true, force: true });
});

test("a11y sweep (owner toolkit, sign editor, shadow realm, rift's owner tab)", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${ownerUrl}&e2e=1`);
	await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(async () => (await state(page)).portals.length, { timeout: 30_000 })
		.toBeGreaterThan(0);
	await expect(page.locator('[data-tool="owner"]')).toBeVisible({
		timeout: 20_000,
	});
	await page.waitForTimeout(1000);

	// The owner's toolkit (role="menu", its own Tab-absorbing keydown from
	// before this pass — confirmed still holds).
	await page.keyboard.press("o");
	const toolkit = page.getByTestId("owner-toolkit");
	await expect(toolkit).toBeVisible();
	await scan(page, '[data-testid="owner-toolkit"]');
	await page.keyboard.press("Escape");
	await expect(toolkit).toHaveCount(0);

	// Place a sign -> the owner's sign editor.
	await page.keyboard.press("o");
	await expect(toolkit).toBeVisible();
	await page.keyboard.press("1"); // picks "Place sign" (entry 1, see owner-key.spec.ts's row order)
	await page.keyboard.press("Enter"); // confirms the picked entry, toggling sign-placing mode
	await expect(page.getByTestId("sign-placing")).toBeVisible();
	await page.keyboard.press("Enter"); // place beside the player
	const editor = page.getByTestId("sign-editor");
	await expect(editor).toBeVisible();
	await scan(page, '[data-testid="sign-editor"]');
	await assertTabStaysWithin(page, '[data-testid="sign-editor"]');
	await expect(page.getByTestId("sign-editor-file")).toHaveAccessibleName(
		/file/i,
	);
	await expect(page.getByTestId("sign-editor-text")).toHaveAccessibleName(
		/text/i,
	);
	await page.keyboard.press("Escape");
	await expect(editor).toHaveCount(0);

	// The rift's Owner tab, via the toolkit's "Commit" entry.
	await page.keyboard.press("o");
	await expect(toolkit).toBeVisible();
	await page.keyboard.press("3"); // picks git:commit (entry 3, see owner-key.spec.ts)
	await page.keyboard.press("Enter"); // confirms it, opening the rift's Owner tab
	const rift = page.getByTestId("universe-picker");
	await expect(rift).toBeVisible();
	await expect(page.getByTestId("owner-panel")).toBeVisible();
	await scan(page, '[data-testid="universe-picker"]');
	await assertTabStaysWithin(page, '[data-testid="universe-picker"]');
	await page.keyboard.press("Escape");
	await expect(rift).toHaveCount(0);

	// The shadow realm: raised through the toolkit's Sudo entry — a world
	// layer switch, not a dialog, so this only re-runs the base-HUD scan
	// with it on rather than asserting a new panel's shape.
	await page.keyboard.press("o");
	await expect(toolkit).toBeVisible();
	await page.keyboard.press("2"); // picks shadow:sudo (entry 2)
	await page.keyboard.press("Enter"); // confirms it, raising the realm
	await page.waitForTimeout(1500);
	await scan(page);

	expect(errors).toEqual([]);
});
