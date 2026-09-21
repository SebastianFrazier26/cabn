import { configDefaults, defineConfig } from "vitest/config";

// sample-project/ is a fixture repo (see scripts/build-world.mjs) that
// deliberately looks like a real, believable codebase — including its own
// server.test.ts written for Node's test runner, not vitest. Without this
// exclude, vitest's default include glob picks that file up too and fails
// trying to resolve its dependencies (e.g. express, which sample-project
// declares but never actually installs).
export default defineConfig({
	test: {
		exclude: [...configDefaults.exclude, "sample-project/**"],
	},
});
