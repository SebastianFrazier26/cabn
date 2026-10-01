import os from "node:os";
import { defineConfig, devices } from "@playwright/test";

// Runs against `vite preview` of an already-built production bundle (see
// package.json's "build"/"e2e" scripts and CLAUDE.md) — this is deliberately
// not `vite dev`, so the smoke test exercises the same artifact the hosted
// demo actually ships, not a dev-server-only code path.
// Overridable so parallel checkouts (worktrees) can each run the suite
// without fighting over one fixed port under --strictPort.
const PREVIEW_PORT = Number(process.env.CABN_E2E_PORT ?? 4173);

// Each worker launches a full Chrome process that spends real wall-clock
// time in WorldScene/ShelfScene's synchronous, CPU-bound ground-field bake
// (see apps/demo/scripts/perf-measure.mjs and its M10 perf-diagnosis
// report) — several of those competing for the same cores at once is what
// reproduced the reported 9-47s world-load times in that measurement, not
// server or network contention. Playwright's own default (50% of logical
// cores) is tuned for lighter, more I/O-bound suites and oversubscribes
// badly for this one; a quarter of the machine's cores leaves real headroom
// per worker's browser process. `pnpm exec playwright test --workers=N`
// still wins over this — Playwright resolves an explicit CLI `--workers`
// before a config file's value.
const DEFAULT_WORKERS = Math.max(1, Math.floor(os.cpus().length / 4));

export default defineConfig({
	testDir: "./e2e",
	// Must exceed walkToward's own 60s budget plus boot and world load, or the
	// test-level timeout fires first with a less useful error.
	timeout: 120_000,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: DEFAULT_WORKERS,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		// --host 127.0.0.1 matters: vite preview's default bind resolves
		// "localhost" to ::1 (IPv6-only) on some machines, which this config's
		// literal 127.0.0.1 URLs then can't reach — verified locally (macOS).
		command: `pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort --host 127.0.0.1`,
		url: `http://127.0.0.1:${PREVIEW_PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				// CI installs its own matching chromium via `playwright install
				// chromium` (see .github/workflows/ci.yml) — never done on a
				// developer machine by this repo's own tooling. Locally, point
				// this at a cached Chrome for Testing binary (e.g.
				// ~/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/
				// Google Chrome for Testing.app/Contents/MacOS/...) if the
				// version bundled with @playwright/test doesn't match what's
				// already cached.
				...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
					? {
							launchOptions: {
								executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
							},
						}
					: {}),
			},
		},
	],
});
