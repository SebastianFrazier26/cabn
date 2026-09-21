import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Isolated from cli.test.ts because it mocks runBuild — the CLI itself has no
// flag that can trigger a real truncated build, so this is the only way to
// exercise the "partial world" warning path.
vi.mock("../src/build.js", () => ({
	runBuild: vi.fn().mockResolvedValue({
		outDir: "/tmp/whatever-world",
		clusters: 1,
		portals: 1,
		bytes: 10,
		elapsedMs: 1,
		truncated: true,
		skippedFiles: 7,
	}),
}));

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

test("a truncated build prints a clear partial-world warning", async () => {
	const { run } = await import("../src/cli.js");
	const code = await run(["build", "irrelevant-because-mocked"]);
	expect(code).toBe(0);
	expect(console.warn).toHaveBeenCalledWith(
		expect.stringMatching(/partial world/i),
	);
	expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("7"));
});
