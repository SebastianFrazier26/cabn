import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { CabnStore } from "../../../packages/engine/src/bridge/store.js";

// The loading overlay on an owner page (`cabn serve --owner`): a slow
// shadow-layer fetch shows the panel labelled with the layer, and inside the
// layer the panel wears the layer's crimson tokens. CABN_REVIEW_SHOTS=1
// writes review screenshots to assets/generated/review/loading-screen/.

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
const SHOTS_DIR = join(REPO, "assets", "generated", "review", "loading-screen");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PORT = Number(process.env.CABN_OWNER_E2E_PORT ?? 5042) + 6;

let root: string;
let serve: ChildProcess | undefined;
let url: string;
// Same diagnostic capture as signs-owner and friends: keep the whole serve log
// and exit status so a failing test can print them from afterEach.
let serveOutput = "";
let serveExit:
	| { code: number | null; signal: NodeJS.Signals | null }
	| undefined;

test.beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "cabn-loading-e2e-"));
	const dir = join(root, "serve-project");
	await cp(FIXTURE, dir, { recursive: true });
	await mkdir(join(dir, ".github"), { recursive: true });
	await writeFile(join(dir, ".github", "ci.yml"), "name: ci\non: push\n");
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
			`[loading-screen-owner] cabn serve output so far:\n${serveOutput}\n` +
				`[loading-screen-owner] cabn serve exit: ${serveExit ? `code=${serveExit.code} signal=${serveExit.signal}` : "still running"}`,
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

interface Snapshot {
	ready: boolean;
	activeLayerId: string | null;
}

function snap(page: Page): Promise<Snapshot> {
	return page.evaluate(() => {
		const x = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState();
		return {
			ready: x.portals.length > 0 && !x.loading.active && !x.loading.visible,
			activeLayerId: x.activeLayerId,
		};
	});
}

test("owner: a slow layer fetch shows the panel, and inside the layer it wears the layer's tokens", async ({
	page,
}) => {
	test.setTimeout(150_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${url}&e2e=1`);
	await expect
		.poll(async () => (await snap(page)).ready, { timeout: 30_000 })
		.toBe(true);
	await expect(page.locator('[data-tool="owner"]')).toBeVisible({
		timeout: 20_000,
	});
	await page.evaluate(() =>
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.setTimeOfDayOverride("day"),
	);
	await page.waitForTimeout(800);

	await page.route("**/owner/shadow/**", async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	await page.evaluate(() =>
		(
			window as unknown as {
				__cabnBus: { emit(e: string, p: unknown): void };
			}
		).__cabnBus.emit("layer:toggle", { layerId: "shadow" }),
	);
	const overlay = page.getByTestId("loading-overlay");
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await expect(page.getByTestId("loading-label")).toHaveText(
		"Revealing the hidden layer…",
	);
	await page.waitForTimeout(300);
	await shoot(page, "owner-layer-fetch-day");
	await expect
		.poll(async () => (await snap(page)).activeLayerId, { timeout: 30_000 })
		.toBe("shadow");
	await expect(overlay).toBeHidden({ timeout: 10_000 });
	await page.unroute("**/owner/shadow/**");
	await page.waitForTimeout(1500);

	// Inside the layer every panel takes the layer's own tokens (layerUiTokens);
	// the panel is put up straight through the store here, since nothing in the
	// fixture loads slowly while the layer is showing.
	await expect(page.locator(".cabn-pixel-root[data-layer]")).toHaveCount(1);
	const token = await page.evaluate(() =>
		(
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore
			.getState()
			.beginLoading("Stepping back into the world…", { delayMs: 0 }),
	);
	await expect(overlay).toBeVisible();
	const panelBg = await page
		.getByTestId("loading-panel")
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	const layerBg = await page.evaluate(() => {
		const tokens = (
			window as unknown as { __cabnStore: { getState(): CabnStore } }
		).__cabnStore.getState().layerUiTokens;
		const n = tokens?.panelBody ?? 0;
		return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
	});
	expect(panelBg).toBe(layerBg);
	await page.waitForTimeout(300);
	await shoot(page, "layer-crimson");
	await page.evaluate(
		(t) =>
			(
				window as unknown as { __cabnStore: { getState(): CabnStore } }
			).__cabnStore
				.getState()
				.endLoading(t),
		token,
	);
	await expect(overlay).toBeHidden({ timeout: 5_000 });
	expect(pageErrors).toEqual([]);
});
