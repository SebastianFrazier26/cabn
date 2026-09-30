import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import * as git from "isomorphic-git";
import type { CabnStore } from "../../../packages/engine/src/bridge/store.js";

// The one owner key (O) end to end, against a real `cabn serve --owner` of a
// temp git repository made from the CLI's serve fixture: the hotbar has one
// owner slot, O opens the owner's toolkit (Place sign, Sudo, Commit, Switch
// branch, Create branch), arrows/numbers/Enter/Esc and the mouse drive it,
// it owns the keyboard while open, and the git entries open the rift's
// Owner tab at their section. The hosted demo has no slot and O does
// nothing. CABN_REVIEW_SHOTS=1 writes the day/night/shadow shots of the menu
// to assets/generated/review/owner-key/.

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
const SHOTS_DIR = join(REPO, "assets", "generated", "review", "owner-key");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PORT = Number(
	process.env.CABN_OWNER_KEY_E2E_PORT ??
		Number(process.env.CABN_OWNER_E2E_PORT ?? 5042) + 3,
);
const AUTHOR = { name: "Wren Hollow", email: "wren@lantern-garden.invalid" };

let dir: string;
let serve: ChildProcess | undefined;
let url: string;

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-owner-key-e2e-"));
	await cp(FIXTURE, dir, { recursive: true });
	// One hidden file, so Sudo has a realm to raise.
	fs.writeFileSync(join(dir, ".editorconfig"), "root = true\n");
	await git.init({ fs, dir, defaultBranch: "main" });
	for (const name of fs.readdirSync(dir)) {
		if (name === ".git") continue;
		await git.add({ fs, dir, filepath: name });
	}
	await git.commit({ fs, dir, message: "first", author: AUTHOR });
	await git.branch({ fs, dir, ref: "side" });
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

interface Snap {
	toolkitOpen: boolean;
	activeLayerId: string | null;
	universeOpen: boolean;
	pensieve: string | null;
	player: { x: number; y: number };
	hasGit: boolean;
	mapPortals: number;
}

async function snap(page: Page): Promise<Snap> {
	return page.evaluate(() => {
		const s = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		return {
			toolkitOpen: s.ownerToolkitOpen,
			activeLayerId: s.activeLayerId,
			universeOpen: s.universeOpen,
			pensieve: s.pensievePortalId,
			player: { ...s.playerPos },
			hasGit: s.git !== null,
			mapPortals: s.worldMap?.portals.length ?? 0,
		};
	});
}

async function setTime(page: Page, time: "day" | "night") {
	await page.evaluate(
		(t) =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore
				.getState()
				.setTimeOfDayOverride(t),
		time,
	);
	await page.waitForTimeout(700);
}

async function waitForOwnerWorld(page: Page) {
	await expect
		.poll(async () => (await snap(page)).mapPortals, { timeout: 30_000 })
		.toBeGreaterThan(0);
	await expect(page.locator('[data-tool="owner"]')).toBeVisible({
		timeout: 20_000,
	});
	await expect.poll(async () => (await snap(page)).hasGit).toBe(true);
	await page.waitForTimeout(1200);
}

test("owner: O opens the one toolkit; keys and mouse drive it, and git entries open the rift's Owner tab", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${url}&e2e=1`);
	await waitForOwnerWorld(page);
	await setTime(page, "day");

	// One owner slot: the old separate sign and sudo slots are gone.
	await expect(page.locator('[data-tool="sign"]')).toHaveCount(0);
	await expect(page.locator('[data-tool="sudo"]')).toHaveCount(0);
	await expect(page.locator(".cabn-hotbar-slot")).toHaveCount(7);

	// H and P are no owner keys any more.
	await page.keyboard.press("h");
	await page.keyboard.press("p");
	await page.waitForTimeout(300);
	expect((await snap(page)).activeLayerId).toBeNull();
	await expect(page.getByTestId("sign-placing")).toHaveCount(0);

	const toolkit = page.getByTestId("owner-toolkit");
	await page.keyboard.press("o");
	await expect(toolkit).toBeVisible();
	const rows = toolkit.locator("[data-entry]");
	await expect(rows).toHaveCount(5);
	expect(
		await rows.evaluateAll((els) =>
			els.map((e) => e.getAttribute("data-entry")),
		),
	).toEqual(["sign", "shadow:sudo", "git:commit", "git:switch", "git:branch"]);
	await expect(toolkit.locator(".cabn-owner-toolkit-label")).toHaveText([
		"Place sign",
		"Sudo",
		"Commit",
		"Switch branch",
		"Create branch",
	]);

	// It owns the keyboard: the focus gate sees a keyboard-owner panel, and a
	// held W walks nobody.
	expect(
		await page.evaluate(
			() =>
				document.activeElement
					?.closest("[data-cabn-keyboard-owner]")
					?.getAttribute("data-testid") ?? null,
		),
	).toBe("owner-toolkit");
	const before = (await snap(page)).player;
	await page.keyboard.down("w");
	await page.waitForTimeout(500);
	await page.keyboard.up("w");
	const after = (await snap(page)).player;
	expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);

	const picked = () =>
		toolkit.locator('[data-picked="true"]').getAttribute("data-entry");
	expect(await picked()).toBe("sign");
	await page.keyboard.press("ArrowDown");
	expect(await picked()).toBe("shadow:sudo");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	expect(await picked()).toBe("git:branch");
	await page.keyboard.press("3");
	expect(await picked()).toBe("git:commit");
	// H inside the open toolkit is swallowed, never the pensieve or a layer.
	await page.keyboard.press("h");
	expect((await snap(page)).pensieve).toBeNull();
	expect((await snap(page)).activeLayerId).toBeNull();
	await page.waitForTimeout(250);
	await shoot(page, "toolkit-day");
	await setTime(page, "night");
	await shoot(page, "toolkit-night");
	await setTime(page, "day");

	// Esc closes, and so does O again.
	await page.keyboard.press("Escape");
	await expect(toolkit).toHaveCount(0);
	await page.keyboard.press("o");
	await expect(toolkit).toBeVisible();
	await page.keyboard.press("o");
	await expect(toolkit).toHaveCount(0);
	// A click outside closes it too.
	await page.locator('[data-tool="owner"]').click();
	await expect(toolkit).toBeVisible();
	await page.mouse.click(200, 200);
	await expect(toolkit).toHaveCount(0);

	// Number, then Enter: Switch branch opens the rift's Owner tab at that section.
	await page.keyboard.press("o");
	await page.keyboard.press("4");
	await page.keyboard.press("Enter");
	await expect(toolkit).toHaveCount(0);
	const picker = page.getByTestId("universe-picker");
	await expect(picker).toBeVisible({ timeout: 15_000 });
	await expect(picker.getByTestId("owner-panel")).toBeVisible();
	await expect(
		picker.locator('[data-owner-section="switch"][data-focused="true"]'),
	).toBeVisible();
	await expect(
		picker.locator('[data-owner-section="switch"] button', { hasText: "side" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(picker).toHaveCount(0);
	expect((await snap(page)).universeOpen).toBe(false);

	// Mouse: the slot, then Create branch, which lands on the branch name field.
	await page.locator('[data-tool="owner"]').click();
	await toolkit.locator('[data-entry="git:branch"]').click();
	await expect(picker).toBeVisible();
	const name = picker.getByTestId("owner-branch-name");
	await expect(name).toBeFocused();
	await name.fill("toolkit-branch");
	await picker.getByLabel("switch to it").uncheck();
	// Every owner write reloads the page into the reconverted world.
	const reloaded = page.waitForEvent("load");
	await picker.getByRole("button", { name: "Create", exact: true }).click();
	await reloaded;
	await expect
		.poll(async () => git.listBranches({ fs, dir }), { timeout: 20_000 })
		.toContain("toolkit-branch");
	expect(await git.currentBranch({ fs, dir })).toBe("main");
	await waitForOwnerWorld(page);

	// Sudo through the toolkit; its row then shows "on", in the crimson HUD.
	await page.keyboard.press("o");
	await page.keyboard.press("2");
	await page.keyboard.press("Enter");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 20_000 })
		.toBe("shadow");
	await page.waitForTimeout(1500);
	await page.keyboard.press("o");
	await expect(
		toolkit.locator('[data-entry="shadow:sudo"] .cabn-owner-toolkit-on'),
	).toBeVisible();
	await page.waitForTimeout(250);
	await shoot(page, "toolkit-shadow");
	await page.keyboard.press("Escape");
	await expect(toolkit).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("hosted: no owner slot, and O does nothing", async ({ page }) => {
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas")).toBeVisible();
	await expect(page.locator('[data-tool="opener"]')).toBeVisible({
		timeout: 20_000,
	});
	await page.waitForTimeout(800);
	await expect(page.locator('[data-tool="owner"]')).toHaveCount(0);
	await page.keyboard.press("o");
	await page.waitForTimeout(300);
	await expect(page.getByTestId("owner-toolkit")).toHaveCount(0);
	const open = await page.evaluate(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore.getState().ownerToolkitOpen,
	);
	expect(open).toBe(false);
});
