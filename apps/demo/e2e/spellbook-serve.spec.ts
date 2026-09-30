import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Regression for the 2026-09-29 "spellbook shows no text" bug: under a real
// `cabn serve` (not the demo's `vite preview`, which is what the rest of this
// suite runs against), the editor's left page mounted CodeMirror into a host
// div that a same-tick React re-render had already torn down — see
// EditorOverlay.tsx's `openEpisodeKey` comment for the root cause. Read-only
// (never saves), so — unlike signs-owner.spec.ts — this runs straight against
// the fixture directory rather than a temp copy.
//
// Drives navigation via `window.__cabnBus`/`__cabnStore`, exposed by the serve
// host page only under `?e2e=1` (see hostPage.ts's `onGameReady`, mirroring
// apps/demo/src/App.tsx's own test hook): a real serve host has no static
// pixel position to click for a portal, since world layout is computed
// client-side.

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
const PORT = Number(process.env.CABN_SPELLBOOK_E2E_PORT ?? 5043);

let serve: ChildProcess | undefined;
let url: string;

test.beforeAll(async () => {
	serve = spawn(
		process.execPath,
		[CLI, "serve", FIXTURE, "--port", String(PORT), "--offline"],
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
});

test("spellbook: opening a file under a real cabn serve shows its text", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.setViewportSize({ width: 1280, height: 800 });

	await page.goto(`${url}&e2e=1`);
	await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
	await page.waitForTimeout(1500);

	await page.evaluate((portalId) => {
		(
			window as unknown as { __cabnBus: { emit(e: string, p: unknown): void } }
		).__cabnBus.emit("tool:walk-to-portal", { portalId });
	}, "hello.py");
	await page.waitForFunction(
		() =>
			(
				window as unknown as {
					__cabnStore: {
						getState(): { focusedPortalPreview: { portalId: string } | null };
					};
				}
			).__cabnStore.getState().focusedPortalPreview?.portalId === "hello.py",
		{ timeout: 20_000 },
	);
	await page.waitForTimeout(900);

	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await page.waitForFunction(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): { mode: string } } }
			).__cabnStore.getState().mode === "file",
		{ timeout: 10_000 },
	);

	await page.keyboard.press("Alt+KeyQ");
	await page.waitForFunction(
		() =>
			(
				window as unknown as { __cabnStore: { getState(): { mode: string } } }
			).__cabnStore.getState().mode === "editor",
		{ timeout: 10_000 },
	);
	await page.waitForTimeout(600);

	// The bug left this element missing entirely (CodeMirror never mounted),
	// not merely empty — so `.cm-content` existing at all is already most of
	// the regression check; the text assertion below is the rest.
	const content = page.locator(".cm-content");
	await expect(content).toBeVisible();
	await expect(content).toContainText("def greet(name):");
	await expect(content).toContainText('greet("world")');

	expect(pageErrors).toEqual([]);
});
