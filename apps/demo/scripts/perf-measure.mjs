#!/usr/bin/env node
// Milestone 10 testing-phase 1 perf harness (measure/diagnose only — see
// CLAUDE.md's testing-phase note in this branch's task brief). Drives the
// production `vite preview` build with the cached Chrome for Testing binary,
// times named phases via the engine's `?perf=1` performance.mark hooks
// (packages/engine/src/systems/perfMarks.ts), and captures a Chrome trace
// per scenario class for the CPU/network waterfall view.
//
// Usage: pnpm -F @cabn/demo build && pnpm -F @cabn/demo build:world (already
// done in a normal `build`), then:
//   node scripts/perf-measure.mjs [--base-url=http://127.0.0.1:5091] [--reps=5]
// Never point this at 4180/4181 (reserved for other worktrees' dev servers —
// see this task's own brief); 5091 is this measurement session's port.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "out", "perf");

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		return [k, v ?? "1"];
	}),
);
const BASE_URL = args["base-url"] ?? "http://127.0.0.1:5091";
const REPS = Number(args.reps ?? 5);
const EXEC_PATH =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	`${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

// Chosen to mirror what Chrome DevTools records by default (timeline +
// v8 CPU sampling for JS attribution, network events for the fetch
// waterfall) rather than everything `chrome://tracing` can offer — a
// full firehose trace makes the per-scenario JSON too large to be worth
// the extra categories it'd add here.
const TRACE_CATEGORIES = [
	"devtools.timeline",
	"v8.execute",
	"disabled-by-default-devtools.timeline",
	"disabled-by-default-devtools.timeline.frame",
	"toplevel",
	"blink.console",
	"disabled-by-default-devtools.timeline.stack",
	"disabled-by-default-v8.cpu_profiler",
	"latencyInfo",
	"blink.user_timing",
	"loading",
	"netlog",
];

const SAMPLE_ROOT_PORTAL = "config/settings.json";
const CABIN_POS = { world0: { x: 0, y: -480 }, world1: { x: 0, y: 480 } };

// --- page helpers -----------------------------------------------------

function state(page) {
	return page.evaluate(() => {
		const store = window.__cabnStore;
		const s = store?.getState();
		if (!s) return undefined;
		return {
			mode: s.mode,
			activeWorldBase: s.activeWorldBase,
			playerPos: s.playerPos,
		};
	});
}

async function marks(page) {
	return page.evaluate(() =>
		performance.getEntriesByType("mark").map((m) => ({
			name: m.name,
			t: m.startTime,
		})),
	);
}

/** cabn:*-named resource fetches (world.json, chunks, sidecars) — the fetch waterfall the brief asks for. */
async function relevantResources(page) {
	return page.evaluate(() =>
		performance
			.getEntriesByType("resource")
			.filter((r) =>
				/\/(world|shelf|monsters|media|embeds|signs|history)\.json$|\/chunks\//.test(
					r.name,
				),
			)
			.map((r) => ({
				name: r.name,
				startTime: r.startTime,
				duration: r.duration,
				transferSize: r.transferSize,
			})),
	);
}

async function longTasks(page) {
	return page.evaluate(() => window.__cabnLongTasks ?? []);
}

async function installObservers(page) {
	await page.addInitScript(() => {
		window.__cabnLongTasks = [];
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					window.__cabnLongTasks.push({
						name: entry.name,
						startTime: entry.startTime,
						duration: entry.duration,
					});
				}
			}).observe({ entryTypes: ["longtask"] });
		} catch {
			// Long Tasks API unsupported — this run just won't have that signal.
		}
	});
}

async function holdKey(page, key, ms = 150) {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
}

async function walkToward(page, target, within, maxMs = 20_000) {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		const pos = (await state(page))?.playerPos;
		if (!pos) break;
		const dx = target.x - pos.x;
		const dy = target.y - pos.y;
		if (Math.hypot(dx, dy) <= within) return;
		const keys = [];
		if (Math.abs(dx) > 4) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
		if (Math.abs(dy) > 4) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
		for (const k of keys) await page.keyboard.down(k);
		await page.waitForTimeout(150);
		for (const k of keys) await page.keyboard.up(k);
	}
	throw new Error(`walkToward (${target.x}, ${target.y}) timed out`);
}

async function waitForMark(page, name, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const found = (await marks(page)).find((m) => m.name === name);
		if (found) return found.t;
		await page.waitForTimeout(50);
	}
	throw new Error(`mark "${name}" never fired within ${timeoutMs}ms`);
}

async function markNow(page, name) {
	await page.evaluate((n) => performance.mark(n), name);
}

// Engine scenes re-emit the same mark name every time their create() reruns
// (e.g. "cabn:world:create-end" on every world entry) and marks/resource-
// timing/longtask entries otherwise accumulate for the page's whole lifetime
// — without resetting between repeats on the SAME page, `waitForMark` would
// find the *previous* repeat's stale entry and return immediately instead of
// waiting for the new one. A fresh `page.goto()` (scenarioColdBootToShelf)
// already resets the Performance timeline on its own; every other scenario
// that reruns marks on a page that stays alive calls this first.
async function resetPerf(page) {
	await page.evaluate(() => {
		performance.clearMarks();
		performance.clearResourceTimings();
		window.__cabnLongTasks = [];
	});
}

async function fetchRootClusterPos(page) {
	return page.evaluate(async () => {
		const s = window.__cabnStore.getState();
		const manifest = await (
			await fetch(`${s.activeWorldBase}world.json`)
		).json();
		return (
			manifest.clusters.find((c) => c.path === ".") ?? manifest.clusters[0]
		).pos;
	});
}

// --- scenarios ----------------------------------------------------------
// Each returns { label, ms, marks, resources, longTasks } for one run.

async function scenarioColdBootToShelf(page) {
	await page.goto(`${BASE_URL}/?e2e=1&perf=1`);
	await page.locator("canvas").first().waitFor({ state: "visible" });
	const t = await waitForMark(page, "cabn:shelf:create-end");
	return {
		label: "cold-boot-to-shelf",
		ms: t,
		marks: await marks(page),
		resources: await relevantResources(page),
		longTasks: await longTasks(page),
	};
}

/** Assumes page is already on the shelf. Walks to the given cabin and times Enter -> world walkable. */
async function scenarioShelfToWorld(page, cabinPos, label) {
	await resetPerf(page);
	await walkToward(page, cabinPos, 50);
	await page.waitForTimeout(300); // let the walk-stop settle before the timed keypress
	await markNow(page, "cabn:test:enter-down");
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	await page.waitForTimeout(1);
	const enterAt = (await marks(page)).find(
		(m) => m.name === "cabn:test:enter-down",
	).t;
	const endAt = await waitForMark(page, "cabn:world:create-end", 60_000);
	return {
		label,
		ms: endAt - enterAt,
		marks: await marks(page),
		resources: await relevantResources(page),
		longTasks: await longTasks(page),
	};
}

async function scenarioWorldToShelfToOther(page) {
	await resetPerf(page);
	const root = await fetchRootClusterPos(page);
	await walkToward(page, { x: root.x + 70, y: root.y }, 30);
	await markNow(page, "cabn:test:escape-down");
	await holdKey(page, "Escape");
	await page.waitForTimeout(600);
	await waitForMark(page, "cabn:shelf:create-end", 20_000).catch(() => {});
	// Second world (notes-vault) is at CABIN_POS.world1 regardless of which
	// world we just left — the shelf's own layout is fixed per shelf.json.
	return scenarioShelfToWorld(
		page,
		CABIN_POS.world1,
		"world-to-shelf-to-other",
	);
}

async function scenarioOpenFile(page) {
	await resetPerf(page);
	await page.evaluate((id) => {
		window.__cabnBus.emit("tool:walk-to-portal", { portalId: id });
	}, SAMPLE_ROOT_PORTAL);
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const focused = await page.evaluate(
			() => window.__cabnStore.getState().focusedPortalPreview?.portalId,
		);
		if (focused === SAMPLE_ROOT_PORTAL) break;
		await page.waitForTimeout(50);
	}
	await page.waitForTimeout(900);
	await markNow(page, "cabn:test:enter-down");
	await page.keyboard.down("Enter");
	await page.waitForTimeout(150);
	await page.keyboard.up("Enter");
	const enterAt = (await marks(page)).find(
		(m) => m.name === "cabn:test:enter-down",
	).t;
	const endAt = await waitForMark(page, "cabn:file:create-end", 20_000);
	return {
		label: "open-file",
		ms: endAt - enterAt,
		marks: await marks(page),
		resources: await relevantResources(page),
		longTasks: await longTasks(page),
	};
}

/** Assumes page is already in "file" mode (scenarioOpenFile ran first this session). */
async function scenarioOpenSpellbook(page) {
	await resetPerf(page);
	await markNow(page, "cabn:test:spellbook-key-down");
	await page.keyboard.press("Alt+KeyQ");
	const enterAt = (await marks(page)).find(
		(m) => m.name === "cabn:test:spellbook-key-down",
	).t;
	const endAt = await waitForMark(page, "cabn:spellbook:view-ready", 20_000);
	return {
		label: "open-spellbook",
		ms: endAt - enterAt,
		marks: await marks(page),
		resources: [],
		longTasks: await longTasks(page),
	};
}

// Leaves the spellbook + file so the next repeat starts from a clean "world" state.
async function leaveFileAndSpellbook(page) {
	await page.keyboard.press("Escape"); // close spellbook if open
	await page.waitForTimeout(200);
	const mode = (await state(page))?.mode;
	if (mode !== "world") {
		await page.keyboard.press("Escape"); // leave file view
		await page.waitForTimeout(400);
	}
}

// --- run orchestration ---------------------------------------------------

async function withTracing(page, name, fn) {
	const browser = page.context().browser();
	await browser.startTracing(page, {
		path: join(OUT_DIR, `trace-${name}.json`),
		screenshots: false,
		categories: TRACE_CATEGORIES,
	});
	try {
		return await fn();
	} finally {
		await browser.stopTracing();
	}
}

async function freshPage(browser, { throttle = false } = {}) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await installObservers(page);
	if (throttle) {
		const client = await context.newCDPSession(page);
		await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
	}
	return { context, page };
}

function summarize(results) {
	const byLabel = new Map();
	for (const r of results) {
		if (!byLabel.has(r.label)) byLabel.set(r.label, []);
		byLabel.get(r.label).push(r.ms);
	}
	const rows = [];
	for (const [label, values] of byLabel) {
		const sorted = [...values].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		const p95 =
			sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
		rows.push({
			label,
			n: values.length,
			min: Math.round(Math.min(...values)),
			median: Math.round(median),
			p95: Math.round(p95),
			max: Math.round(Math.max(...values)),
		});
	}
	return rows;
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch({ executablePath: EXEC_PATH });
	const allResults = [];

	console.log(`\n=== normal runs (${REPS}x each) ===`);
	for (let i = 0; i < REPS; i++) {
		const { context, page } = await freshPage(browser);
		const traced = i === 0;

		const run = async () => {
			const cold = await scenarioColdBootToShelf(page);
			allResults.push(cold);

			const first = await scenarioShelfToWorld(
				page,
				CABIN_POS.world0,
				"shelf-to-world-first-visit",
			);
			allResults.push(first);

			// Opening a file/the spellbook needs config/settings.json, which only
			// exists in the sample-project world (CABIN_POS.world0) — do these
			// while still inside it, before "world -> shelf -> other" leaves it
			// for notes-vault.
			const file = await scenarioOpenFile(page);
			allResults.push(file);

			const spellbook = await scenarioOpenSpellbook(page);
			allResults.push(spellbook);
			await leaveFileAndSpellbook(page);

			// Second visit: leave back to shelf via the root cluster, then walk
			// into the SAME cabin again (index 0) — exercises the "everything's
			// already cached" path PreloadScene's Phaser-loader dedupe should hit.
			const root = await fetchRootClusterPos(page);
			await walkToward(page, { x: root.x + 70, y: root.y }, 30);
			await holdKey(page, "Escape");
			await page.waitForTimeout(600);
			await waitForMark(page, "cabn:shelf:create-end", 20_000).catch(() => {});
			const second = await scenarioShelfToWorld(
				page,
				CABIN_POS.world0,
				"shelf-to-world-second-visit",
			);
			allResults.push(second);

			const otherWorld = await scenarioWorldToShelfToOther(page);
			allResults.push(otherWorld);
		};

		if (traced) {
			await withTracing(page, "normal-rep0", run);
		} else {
			await run();
		}
		console.log(`  rep ${i + 1}/${REPS} done`);
		await context.close();
	}

	console.log("\n=== 4x CPU-throttled run (1x) ===");
	{
		const { context, page } = await freshPage(browser, { throttle: true });
		await withTracing(page, "throttled-4x", async () => {
			allResults.push({
				...(await scenarioColdBootToShelf(page)),
				label: "throttled4x:cold-boot-to-shelf",
			});
			allResults.push({
				...(await scenarioShelfToWorld(
					page,
					CABIN_POS.world0,
					"throttled4x:shelf-to-world-first-visit",
				)),
			});
		});
		await context.close();
	}

	console.log("\n=== parallel cold-cache reproduction attempt ===");
	const PARALLEL_N = Number(args.parallel ?? 6);
	const parallelBrowsers = await Promise.all(
		Array.from({ length: PARALLEL_N }, () =>
			chromium.launch({ executablePath: EXEC_PATH }),
		),
	);
	const parallelStart = Date.now();
	const parallelResults = await Promise.all(
		parallelBrowsers.map(async (b, i) => {
			const context = await b.newContext();
			const page = await context.newPage();
			await installObservers(page);
			const client = await context.newCDPSession(page);
			await client.send("Network.setCacheDisabled", { cacheDisabled: true });
			const cold = await scenarioColdBootToShelf(page);
			const first = await scenarioShelfToWorld(
				page,
				CABIN_POS.world0,
				"parallel:shelf-to-world-first-visit",
			);
			await context.close();
			await b.close();
			return { worker: i, cold, first };
		}),
	);
	const parallelWall = Date.now() - parallelStart;
	console.log(
		`  ${PARALLEL_N} parallel browsers, wall clock ${parallelWall}ms`,
	);
	for (const r of parallelResults) {
		allResults.push({ ...r.cold, label: "parallel:cold-boot-to-shelf" });
		allResults.push(r.first);
	}

	await browser.close();

	const summaryRows = summarize(allResults);
	console.log("\n=== summary (ms) ===");
	console.table(summaryRows);

	await writeFile(
		join(OUT_DIR, "results.json"),
		JSON.stringify(
			{ allResults, summaryRows, parallelResults, parallelWall },
			null,
			2,
		),
	);
	console.log(`\nFull results: ${join(OUT_DIR, "results.json")}`);
	console.log(`Traces: ${OUT_DIR}/trace-*.json`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
