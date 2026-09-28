import { defineConfig, devices } from "@playwright/test";

// Runs against `vite preview` of an already-built production bundle (see
// package.json's "build"/"e2e" scripts and CLAUDE.md) — this is deliberately
// not `vite dev`, so the smoke test exercises the same artifact the hosted
// demo actually ships, not a dev-server-only code path.
// Overridable so parallel checkouts (worktrees) can each run the suite
// without fighting over one fixed port under --strictPort.
const PREVIEW_PORT = Number(process.env.CABN_E2E_PORT ?? 4173);

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
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
