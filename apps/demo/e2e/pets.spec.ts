import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type Request, test } from "@playwright/test";

// AI pets end to end, against a MOCKED provider (page.route): no real key
// and no real provider request ever leaves the test browser. Covers setup
// (session key), asking, a tool call reading a raw file, a proposed edit
// reviewed in the spellbook and accepted into the buffer, every provider's
// out-of-credits message, "remember on this device" and "forget key".
// CABN_REVIEW_SHOTS=1 also writes review screenshots to
// assets/generated/review/pets/.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(
	here,
	"..",
	"..",
	"..",
	"assets",
	"generated",
	"review",
	"pets",
);
const TAKE_SHOTS = process.env.CABN_REVIEW_SHOTS === "1";
const INDEX_TS = readFileSync(
	join(here, "..", "sample-project", "src", "index.ts"),
	"utf8",
);
const SERVER_TS = readFileSync(
	join(here, "..", "sample-project", "src", "server.ts"),
	"utf8",
);

// Deliberately not key-shaped (the bundle check rejects sk-… literals anywhere they'd ship).
const FAKE_KEY = "e2e-fake-key-7Qm2Zp9";

const PROVIDER_URL =
	/^(https:\/\/(api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|dashscope-intl\.aliyuncs\.com)|http:\/\/localhost:11434)\//;

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
};

interface Reply {
	status?: number;
	json: unknown;
}

interface Captured {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

async function mockProviders(page: Page) {
	const replies: Reply[] = [];
	const captured: Captured[] = [];
	await page.route(PROVIDER_URL, async (route) => {
		const req = route.request();
		if (req.method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: CORS });
			return;
		}
		captured.push({
			url: req.url(),
			headers: req.headers(),
			body: (req.postDataJSON() ?? {}) as Record<string, unknown>,
		});
		const next = replies.shift() ?? {
			status: 500,
			json: { error: { message: "no scripted reply" } },
		};
		await route.fulfill({
			status: next.status ?? 200,
			headers: { ...CORS, "content-type": "application/json" },
			body: JSON.stringify(next.json),
		});
	});
	return { replies, captured };
}

interface Snapshot {
	mode: string;
	activeWorldBase: string | null;
	activePortalId: string | null;
	playerPos: { x: number; y: number };
	petProvider: string | null;
	petChatOpen: boolean;
	petPanelOpen: boolean;
	petNpc: { pos: { x: number; y: number } } | null;
	petWorld: boolean;
	buffer: string | null;
	saved: string | null;
	proposals: Array<{ id: string; path: string; status: string }>;
}

function state(page: Page): Promise<Snapshot | undefined> {
	return page.evaluate(() => {
		type S = {
			mode: string;
			activeWorldBase: string | null;
			activePortalId: string | null;
			playerPos: { x: number; y: number };
			petProvider: string | null;
			petChatOpen: boolean;
			petPanelOpen: boolean;
			petNpc: { pos: { x: number; y: number } } | null;
			petWorld: unknown;
			activeFileState: { doc: { toString(): string } } | null;
			activePortalContent: string | null;
			petProposals: Array<{ id: string; path: string; status: string }>;
		};
		const store = (window as unknown as { __cabnStore?: { getState(): S } })
			.__cabnStore;
		const s = store?.getState();
		return s
			? {
					mode: s.mode,
					activeWorldBase: s.activeWorldBase,
					activePortalId: s.activePortalId,
					playerPos: s.playerPos,
					petProvider: s.petProvider,
					petChatOpen: s.petChatOpen,
					petPanelOpen: s.petPanelOpen,
					petNpc: s.petNpc,
					petWorld: s.petWorld !== null,
					buffer: s.activeFileState?.doc.toString() ?? null,
					saved: s.activePortalContent,
					proposals: s.petProposals.map((p) => ({
						id: p.id,
						path: p.path,
						status: p.status,
					})),
				}
			: undefined;
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
		await page.waitForTimeout(120);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

async function holdKey(page: Page, key: string, ms = 150) {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
}

async function enterFirstWorld(page: Page) {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	await walkToward(page, { x: 0, y: -480 }, 50);
	await holdKey(page, "Enter");
	await expect
		.poll(async () => (await state(page))?.petWorld, { timeout: 15_000 })
		.toBe(true);
	await page.waitForTimeout(1000);
}

/** Through the store: the settings corner is hidden in the spellbook and covered by the pet panel's backdrop. */
async function setTimeOfDay(page: Page, tod: "day" | "night") {
	await storeCall(page, "setTimeOfDayOverride", tod);
	await page.waitForTimeout(700);
}

async function shoot(
	page: Page,
	name: string,
	around?: { x: number; y: number },
) {
	if (!TAKE_SHOTS) return;
	await page.waitForTimeout(300);
	await mkdir(SHOTS_DIR, { recursive: true });
	const path = join(SHOTS_DIR, `${name}.png`);
	if (!around) {
		await page.screenshot({ path });
		return;
	}
	const box = await page.locator("canvas").first().boundingBox();
	const pos = (await state(page))?.playerPos;
	if (!box || !pos) return;
	const w = 360;
	const h = 240;
	const cx = box.x + box.width / 2 + (around.x - pos.x);
	const cy = box.y + box.height / 2 + (around.y - pos.y) - 16;
	await page.screenshot({
		path,
		clip: {
			x: Math.max(box.x, cx - w / 2),
			y: Math.max(box.y, cy - h / 2),
			width: w,
			height: h,
		},
	});
}

async function storedKeys(page: Page) {
	return page.evaluate(() => {
		const pick = (s: Storage) =>
			Object.fromEntries(
				Object.keys(s)
					.filter((k) => k.startsWith("cabn:pet-key:"))
					.map((k) => [k, s.getItem(k)]),
			);
		return { session: pick(sessionStorage), local: pick(localStorage) };
	});
}

/** Every request that isn't to a pet provider must not carry the key anywhere. */
function watchForKeyLeaks(page: Page): string[] {
	const leaks: string[] = [];
	page.on("request", (req: Request) => {
		if (PROVIDER_URL.test(req.url())) return;
		const blob = `${req.url()} ${JSON.stringify(req.headers())} ${req.postData() ?? ""}`;
		if (blob.includes(FAKE_KEY)) leaks.push(req.url());
	});
	return leaks;
}

function collectErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (msg) => {
		// The mocked 4xx replies are logged by the browser itself as failed
		// resource loads; those are the point of the error tests.
		if (msg.type() === "error" && !/Failed to load resource/.test(msg.text()))
			errors.push(msg.text());
	});
	page.on("pageerror", (err) => errors.push(err.message));
	return errors;
}

test("pets: configure a session key, ask, read a raw file, propose + accept an edit", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors = collectErrors(page);
	const leaks = watchForKeyLeaks(page);
	const mock = await mockProviders(page);
	await enterFirstWorld(page);

	await page.getByTestId("cabn-pet-corner").click();
	const panel = page.getByTestId("cabn-pet-panel");
	await expect(panel).toBeVisible();
	await page.getByTestId("cabn-pet-provider-anthropic").click();
	const keyInput = page.getByTestId("cabn-pet-key");
	await expect(keyInput).toHaveAttribute("type", "password");
	await keyInput.fill(FAKE_KEY);
	await expect(page.getByTestId("cabn-pet-remember")).not.toBeChecked();
	await setTimeOfDay(page, "day");
	await shoot(page, "panel-day");
	await page.getByTestId("cabn-pet-save").click();
	await expect(page.getByTestId("cabn-pet-status")).toContainText(
		"following you",
	);
	await expect(keyInput).toHaveValue("");
	await expect(page.getByTestId("cabn-pet-key-state")).toContainText(
		"for this tab",
	);
	expect(await storedKeys(page)).toEqual({
		session: { "cabn:pet-key:anthropic": FAKE_KEY },
		local: {},
	});
	expect(JSON.stringify(await state(page))).not.toContain(FAKE_KEY);
	expect(await page.content()).not.toContain(FAKE_KEY);

	// Test connection makes one real (mocked) call with the key in the header.
	mock.replies.push({ json: { content: [{ type: "text", text: "ready" }] } });
	await page.getByTestId("cabn-pet-test").click();
	await expect(page.getByTestId("cabn-pet-status")).toContainText(
		"The spell connects",
	);
	expect(mock.captured.at(-1)?.headers["x-api-key"]).toBe(FAKE_KEY);
	expect(
		mock.captured.at(-1)?.headers["anthropic-dangerous-direct-browser-access"],
	).toBe("true");
	await page.getByTestId("cabn-pet-close").click();
	await expect(panel).toBeHidden();

	await expect
		.poll(async () => (await state(page))?.petNpc ?? null, { timeout: 10_000 })
		.not.toBeNull();
	await page.waitForTimeout(800);
	const pet = (await state(page))?.petNpc;
	if (!pet) throw new Error("no pet");

	// Click the pet (canvas centre is the player): the click-walk arrives and opens the chat.
	const box = await page.locator("canvas").first().boundingBox();
	if (!box) throw new Error("no canvas box");
	const from = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await page.mouse.click(
		box.x + box.width / 2 + (pet.pos.x - from.x),
		box.y + box.height / 2 + (pet.pos.y - 8 - from.y),
	);
	await expect
		.poll(async () => (await state(page))?.petChatOpen, { timeout: 10_000 })
		.toBe(true);
	const chat = page.getByTestId("cabn-pet-chat");
	await expect(chat).toBeVisible();

	// Ask: the model reads src/server.ts through the tool; the raw file text goes back to it.
	mock.replies.push(
		{
			json: {
				content: [
					{ type: "text", text: "Let me peek." },
					{
						type: "tool_use",
						id: "tu_1",
						name: "read_file",
						input: { path: "src/server.ts" },
					},
				],
				stop_reason: "tool_use",
			},
		},
		{
			json: {
				content: [
					{
						type: "text",
						text: "Meow! src/server.ts builds the Express app and mounts /health, /harvests and /gardeners.",
					},
				],
				stop_reason: "end_turn",
			},
		},
	);
	const before = mock.captured.length;
	await page
		.getByTestId("cabn-pet-input")
		.fill("What does the server file do?");
	await page.getByTestId("cabn-pet-input").press("Enter");
	await expect(chat.getByTestId("cabn-pet-message").last()).toContainText(
		"mounts /health",
		{ timeout: 10_000 },
	);
	await expect(chat.getByTestId("cabn-pet-cite")).toHaveText(["src/server.ts"]);
	const second = mock.captured[before + 1];
	const sentMessages = (second?.body.messages ?? []) as Array<{
		content?: Array<{ content: string; tool_use_id: string }>;
	}>;
	const toolResult = sentMessages[2]?.content ?? [];
	expect(toolResult[0]?.tool_use_id).toBe("tu_1");
	expect(JSON.parse(toolResult[0]?.content ?? "{}").content).toBe(SERVER_TS);
	expect(JSON.stringify(mock.captured.map((c) => c.body))).not.toContain(
		FAKE_KEY,
	);
	await setTimeOfDay(page, "day");
	await shoot(page, "chat-day");

	// Propose an edit; nothing changes until the player accepts in the spellbook.
	const oldLine = "const PORT = Number(process.env.PORT ?? 4000);";
	const newLine = "const PORT = Number(process.env.PORT ?? 4100);";
	expect(INDEX_TS).toContain(oldLine);
	mock.replies.push(
		{
			json: {
				content: [
					{
						type: "tool_use",
						id: "tu_2",
						name: "propose_edit",
						input: {
							path: "src/index.ts",
							old_text: oldLine,
							new_text: newLine,
							summary: "Move the default port to 4100",
						},
					},
				],
			},
		},
		{
			json: {
				content: [
					{ type: "text", text: "Meow! I left a proposal in your spellbook." },
				],
			},
		},
	);
	await page
		.getByTestId("cabn-pet-input")
		.fill("Change the default port to 4100");
	await page.getByTestId("cabn-pet-send").click();
	const card = chat.getByTestId("cabn-pet-proposal-card");
	await expect(card).toContainText("src/index.ts");
	await expect(card).toContainText("pending");
	await setTimeOfDay(page, "night");
	await shoot(page, "chat-night-proposal");
	await setTimeOfDay(page, "day");

	await card.getByTestId("cabn-pet-review").click();
	await expect
		.poll(async () => (await state(page))?.mode, { timeout: 15_000 })
		.toBe("editor");
	expect((await state(page))?.activePortalId).toBe("src/index.ts");
	const review = page.getByTestId("cabn-pet-proposal");
	await expect(review).toBeVisible();
	await expect(review.locator('[data-kind="del"]')).toContainText("4000");
	await expect(review.locator('[data-kind="add"]')).toContainText("4100");
	expect((await state(page))?.buffer).toBe(INDEX_TS);
	await page.waitForTimeout(600);
	await shoot(page, "spellbook-diff-day");
	await setTimeOfDay(page, "night");
	await shoot(page, "spellbook-diff-night");
	await setTimeOfDay(page, "day");

	await page.getByTestId("cabn-pet-accept").click();
	await expect(review).toBeHidden();
	const accepted = await state(page);
	expect(accepted?.buffer).toBe(INDEX_TS.replace(oldLine, newLine));
	// Applied to the buffer, not saved: the player seals it like any other edit.
	expect(accepted?.saved).toBe(INDEX_TS);
	expect(accepted?.proposals).toEqual([
		{ id: expect.any(String), path: "src/index.ts", status: "accepted" },
	]);

	expect(leaks).toEqual([]);
	expect(errors).toEqual([]);
});

const CREDIT_ERRORS: Record<
	string,
	{ sound: string; billing: string; reply: Reply }
> = {
	anthropic: {
		sound: "Meow",
		billing: "https://platform.claude.com/settings/billing",
		reply: {
			status: 402,
			json: {
				type: "error",
				error: {
					type: "billing_error",
					message: "Your credit balance is too low.",
				},
			},
		},
	},
	openai: {
		sound: "Squeak",
		billing:
			"https://platform.openai.com/settings/organization/billing/overview",
		reply: {
			status: 429,
			json: {
				error: {
					type: "insufficient_quota",
					code: "insufficient_quota",
					message: "You exceeded your current quota.",
				},
			},
		},
	},
	gemini: {
		sound: "Tweet",
		billing: "https://aistudio.google.com/billing",
		reply: {
			status: 429,
			json: {
				error: {
					code: 429,
					status: "RESOURCE_EXHAUSTED",
					message:
						"You exceeded your current quota, please check your plan and billing details.",
					details: [
						{
							violations: [
								{
									quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
								},
							],
						},
					],
				},
			},
		},
	},
	ollama: {
		sound: "Hum",
		billing: "https://ollama.com/download",
		reply: { status: 402, json: { error: { message: "payment required" } } },
	},
	qwen: {
		sound: "Hoot",
		billing: "https://billing-cost.console.alibabacloud.com/",
		reply: {
			status: 400,
			json: {
				error: {
					code: "Arrearage",
					message:
						"Access denied, please make sure your account is in good standing.",
				},
			},
		},
	},
	deepseek: {
		sound: "Whoosh",
		billing: "https://platform.deepseek.com/top_up",
		reply: {
			status: 402,
			json: {
				error: { message: "Insufficient Balance", type: "unknown_error" },
			},
		},
	},
};

test("pets: every provider's out-of-credits message, all six pets, remember + forget key", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors = collectErrors(page);
	const mock = await mockProviders(page);
	await enterFirstWorld(page);

	// Walk off the spawn a little so the pets have room to trail into view.
	const start = (await state(page))?.playerPos ?? { x: 0, y: 0 };
	await walkToward(page, { x: start.x + 90, y: start.y + 40 }, 12);

	for (const [provider, expected] of Object.entries(CREDIT_ERRORS)) {
		if (provider !== "ollama") {
			await page.evaluate(
				([p, k]) => sessionStorage.setItem(`cabn:pet-key:${p}`, k),
				[provider, FAKE_KEY],
			);
		}
		await storeCall(page, "setPetProvider", provider);
		await expect
			.poll(async () => (await state(page))?.petNpc ?? null, {
				timeout: 10_000,
			})
			.not.toBeNull();
		// Nudge the player so the pet walks, then let it settle for the shot.
		const here = (await state(page))?.playerPos ?? start;
		await walkToward(page, { x: here.x + 30, y: here.y }, 8);
		await page.waitForTimeout(900);
		const pet = (await state(page))?.petNpc;
		await setTimeOfDay(page, "day");
		await shoot(page, `pet-${provider}-day`, pet?.pos);
		await setTimeOfDay(page, "night");
		await shoot(page, `pet-${provider}-night`, pet?.pos);
		await setTimeOfDay(page, "day");

		await storeCall(page, "setPetChatOpen", true);
		mock.replies.push(expected.reply);
		await page.getByTestId("cabn-pet-input").fill("hello?");
		await page.getByTestId("cabn-pet-input").press("Enter");
		const last = page.getByTestId("cabn-pet-message").last();
		await expect(last).toContainText(
			`${expected.sound}… it appears our communication spell has worn off. We need to add mana to`,
		);
		await expect(last.getByTestId("cabn-pet-link")).toHaveAttribute(
			"href",
			expected.billing,
		);
		await expect(last).not.toContainText(FAKE_KEY);
		if (provider === "deepseek") {
			await shoot(page, "chat-day-out-of-credits");
			await setTimeOfDay(page, "night");
			await shoot(page, "chat-night-out-of-credits");
			await setTimeOfDay(page, "day");
		}
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("cabn-pet-chat")).toBeHidden();
		expect((await state(page))?.mode).toBe("world");
	}

	// Remember on this device moves the key to localStorage, with a warning.
	await page.getByTestId("cabn-pet-corner").click();
	await page.getByTestId("cabn-pet-provider-openai").click();
	await page.getByTestId("cabn-pet-remember").check();
	await expect(page.getByTestId("cabn-pet-remember-warning")).toContainText(
		"only as safe as this browser",
	);
	await setTimeOfDay(page, "night");
	await shoot(page, "panel-night-remember");
	await setTimeOfDay(page, "day");
	await page.getByTestId("cabn-pet-key").fill(FAKE_KEY);
	await page.getByTestId("cabn-pet-save").click();
	await expect(page.getByTestId("cabn-pet-key-state")).toContainText(
		"on this device",
	);
	let keys = await storedKeys(page);
	expect(keys.local).toEqual({ "cabn:pet-key:openai": FAKE_KEY });
	expect(keys.session["cabn:pet-key:openai"]).toBeUndefined();

	// Forget clears it everywhere and sends the pet away.
	await page.getByTestId("cabn-pet-forget").click();
	await expect(page.getByTestId("cabn-pet-status")).toContainText("Forgot");
	keys = await storedKeys(page);
	expect(keys.local).toEqual({});
	expect(keys.session["cabn:pet-key:openai"]).toBeUndefined();
	expect((await state(page))?.petProvider).toBeNull();
	await expect.poll(async () => (await state(page))?.petNpc ?? null).toBeNull();
	const petSettings = await page.evaluate(
		() => localStorage.getItem("cabn:pet-settings") ?? "",
	);
	expect(petSettings).not.toContain(FAKE_KEY);

	expect(errors).toEqual([]);
});

test("pets: hotbar and walk keys stay out while the chat or setup panel has focus", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const errors = collectErrors(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas").first()).toBeVisible();
	await page.waitForTimeout(1500);
	const spyglassOpen = () =>
		page.evaluate(
			() =>
				(
					window as unknown as {
						__cabnStore: { getState(): { spyglassOpen: boolean } };
					}
				).__cabnStore.getState().spyglassOpen,
		);
	const expectKeysSwallowed = async () => {
		const before = (await state(page))?.playerPos;
		await page.keyboard.press("l");
		await holdKey(page, "d", 400);
		await page.waitForTimeout(150);
		expect(await spyglassOpen()).toBe(false);
		expect((await state(page))?.playerPos).toEqual(before);
	};

	await storeCall(page, "setPetProvider", "anthropic");
	await storeCall(page, "setPetChatOpen", true);
	const chat = page.getByTestId("cabn-pet-chat");
	await expect(chat).toBeVisible();
	await expect(page.getByTestId("cabn-pet-input")).toBeFocused();
	await expectKeysSwallowed();
	// Clicking the log (not a text field) used to drop focus to <body>.
	await chat.click({ position: { x: 20, y: 60 } });
	await expectKeysSwallowed();
	await page.getByTestId("cabn-pet-send").focus();
	await expectKeysSwallowed();

	await storeCall(page, "setPetChatOpen", false);
	await storeCall(page, "setPetPanelOpen", true);
	const panel = page.getByTestId("cabn-pet-panel");
	await expect(panel).toBeVisible();
	await expectKeysSwallowed();
	await panel.click({ position: { x: 30, y: 10 } });
	await expectKeysSwallowed();
	await page.keyboard.press("Escape");
	await expect(panel).toBeHidden();

	// Closed: the same key reaches the hotbar again.
	await page.locator("canvas").first().click();
	await page.keyboard.press("l");
	await expect.poll(spyglassOpen).toBe(true);
	expect(errors).toEqual([]);
});
