import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Owner mode end to end, against a real `cabn serve` of a temp copy of the
// CLI's serve fixture (not the demo's vite preview, which has no owner mode):
// the owner's toolkit (O) offers Place sign, placing shows a ghost, the editor saves a
// .seyn file to disk, the world and the orb search show it live (and after
// a reload), and edit/delete round-trip.
// CABN_REVIEW_SHOTS=1 writes the placing-flow screenshots to
// assets/generated/review/signs/.

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
const SHOTS_DIR = join(REPO, "assets", "generated", "review", "signs");
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const PORT = Number(process.env.CABN_OWNER_E2E_PORT ?? 5042);

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
	dir = await mkdtemp(join(tmpdir(), "cabn-owner-e2e-"));
	await cp(FIXTURE, dir, { recursive: true });
	serve = spawn(
		process.execPath,
		[CLI, "serve", dir, "--port", String(PORT), "--offline", "--owner"],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
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
			`[signs-owner] cabn serve output so far:\n${serveOutput}\n` +
				`[signs-owner] cabn serve exit: ${serveExit ? `code=${serveExit.code} signal=${serveExit.signal}` : "still running"}`,
		);
	}
});

test.afterAll(async () => {
	serve?.kill("SIGINT");
	await new Promise((r) => setTimeout(r, 300));
	if (serve && serve.exitCode === null) serve.kill("SIGKILL");
	await rm(dir, { recursive: true, force: true });
});

async function shoot(page: import("@playwright/test").Page, name: string) {
	if (!TAKE_SHOTS) return;
	await mkdir(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

/** Opens the orb, types the query, and returns the listed result paths (closing the orb again unless asked not to). */
async function orbSearch(
	page: import("@playwright/test").Page,
	query: string,
	opts: { keepOpen?: boolean } = {},
): Promise<string[]> {
	await page.locator('[data-tool="orb"]').click();
	const input = page.getByPlaceholder("search the world...");
	await expect(input).toBeFocused();
	await input.fill(query);
	const content = page.locator(".cabn-crystal-ball-content");
	await expect(
		content.locator("li").first().or(content.getByText("no matches")),
	).toBeVisible();
	const rows = await content.locator("li").allInnerTexts();
	if (!opts.keepOpen) {
		await page.keyboard.press("Escape");
		await expect(input).toBeHidden();
		// The focus gate hands the keyboard back to Phaser on its next step;
		// an Enter sent sooner than that would be dropped.
		await page.waitForTimeout(250);
	}
	return rows;
}

test("owner: place a sign, it lands on disk and in the world, edit and delete it", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(url);
	const canvas = page.locator("canvas").first();
	await expect(canvas).toBeVisible();
	const slot = page.locator('[data-tool="owner"]');
	await expect(slot).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('[data-tool="sign"]')).toHaveCount(0);
	await page.waitForTimeout(1500);

	// P is no longer an owner key; O opens the toolkit with Place sign first.
	await page.keyboard.press("p");
	await expect(page.getByTestId("sign-placing")).toHaveCount(0);
	await page.keyboard.press("o");
	const toolkit = page.getByTestId("owner-toolkit");
	await expect(toolkit).toBeVisible();
	await expect(toolkit.locator('[data-entry="sign"]')).toHaveAttribute(
		"data-picked",
		"true",
	);
	await page.keyboard.press("Enter");
	await expect(toolkit).toHaveCount(0);
	await expect(page.getByTestId("sign-placing")).toBeVisible();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("no canvas box");
	// Somewhere up and to the left of the player (canvas centre) — the ghost
	// follows the pointer and shows where the sign would really stand.
	const target = {
		x: box.x + box.width / 2 - 170,
		y: box.y + box.height / 2 - 120,
	};
	await page.mouse.move(target.x, target.y);
	await page.waitForTimeout(400);
	await shoot(page, "owner-1-placing-ghost");
	await page.mouse.click(target.x, target.y);

	const editor = page.getByTestId("sign-editor");
	await expect(editor).toBeVisible();
	await expect(page.getByTestId("sign-placing")).toBeHidden();
	const path = await page.getByTestId("sign-editor-file").inputValue();
	expect(path).toMatch(/^[A-Za-z0-9][A-Za-z0-9._ -]*\.seyn$/);

	// "Stands beside" filters as you type; Escape closes only its list, and
	// typed letters (the l in "hello") never reach the hotbar.
	const near = page.getByTestId("sign-editor-near");
	const nearList = page.getByTestId("sign-editor-near-list");
	const originalNear = await near.inputValue();
	await near.click();
	await expect(nearList.getByRole("option")).toHaveCount(7);
	await near.pressSequentially("hello");
	await expect(nearList.getByRole("option")).toHaveText([
		"/hello.js",
		"/hello.py",
	]);
	await page.waitForTimeout(400);
	await shoot(page, "owner-2a-near-picker");
	await page.keyboard.press("Escape");
	await expect(nearList).toBeHidden();
	await expect(editor).toBeVisible();
	await expect(page.locator(".cabn-spyglass-frame")).toHaveCount(0);
	await near.fill("py hel");
	await page.keyboard.press("Enter");
	await expect(nearList).toBeHidden();
	await expect(near).toHaveValue("/hello.py");
	await near.click();
	await nearList
		.getByRole("option", { name: originalNear, exact: true })
		.click();
	await expect(near).toHaveValue(originalNear);
	await page
		.getByTestId("sign-editor-text")
		.fill(
			"# Owner's note\n\nWritten from *inside* the world.\n\n- runs with [[hello.py]]\n- more at [[https://example.com/|example.com]]",
		);
	await expect(page.getByTestId("sign-editor-preview")).toContainText(
		"Owner's note",
	);
	await expect(
		page.getByTestId("sign-editor-preview").getByText("hello.py"),
	).toBeVisible();
	// Past the panel's 140ms fade-in, or the shot catches it half-transparent.
	await page.waitForTimeout(400);
	await shoot(page, "owner-2-editor");
	await page.getByTestId("sign-editor-save").click();
	await expect(editor).toBeHidden();

	const onDisk = join(dir, path);
	await expect
		.poll(async () => (await stat(onDisk).catch(() => null))?.isFile() ?? false)
		.toBe(true);
	const saved = await readFile(onDisk, "utf8");
	expect(saved).toMatch(/^@near \/\S+\n@offset -?\d+ -?\d+\n# Owner's note\n/);

	// Saving walks the player over; the popup shows the new sign.
	const popup = page.getByTestId("sign-popup");
	await expect(popup).toBeVisible({ timeout: 15_000 });
	await expect(popup).toHaveAttribute("data-sign-path", path);
	await expect(popup).toContainText("Written from inside the world.");
	await page.waitForTimeout(600);
	await shoot(page, "owner-3-saved-popup");

	// The served signs.json already has it — a reload shows it too.
	const served = await page.evaluate(async () =>
		(await fetch("/world/signs.json")).json(),
	);
	expect(served.signs.map((s: { path: string }) => s.path)).toContain(path);

	// Orb search finds it without a server restart.
	expect(await orbSearch(page, "inside")).toContain(path);

	// After a reload too, though the served search-index.json predates the
	// sign; picking the hit walks back to it.
	await page.reload();
	await expect(slot).toBeVisible({ timeout: 20_000 });
	await page.waitForTimeout(1500);
	expect(await orbSearch(page, "inside", { keepOpen: true })).toContain(path);
	await page
		.locator(".cabn-crystal-ball-content li", { hasText: path })
		.click();
	await expect(popup).toBeVisible({ timeout: 15_000 });
	await expect(popup).toHaveAttribute("data-sign-path", path);

	// Edit: same file, new text.
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	const reader = page.getByTestId("sign-reader");
	await expect(reader).toBeVisible();
	await reader.getByTestId("sign-edit").click();
	await expect(editor).toBeVisible();
	await expect(page.getByTestId("sign-editor-file")).toHaveValue(path);
	await page.getByTestId("sign-editor-text").fill("# Owner's note\n\nEdited.");
	await page.keyboard.press("Control+s");
	await expect(editor).toBeHidden();
	await expect.poll(async () => readFile(onDisk, "utf8")).toContain("Edited.");
	await expect(popup).toContainText("Edited.", { timeout: 15_000 });
	expect(await orbSearch(page, "edited")).toContain(path);
	expect(await orbSearch(page, "inside")).not.toContain(path);

	// Delete, with its confirmation step.
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await expect(reader).toBeVisible();
	await reader.getByTestId("sign-delete").click();
	await reader.getByTestId("sign-delete-confirm").click();
	await expect(reader).toBeHidden();
	await expect
		.poll(async () => (await stat(onDisk).catch(() => null)) === null)
		.toBe(true);
	await expect(popup).toBeHidden();
	expect(await orbSearch(page, "edited")).not.toContain(path);

	expect(pageErrors).toEqual([]);
});
