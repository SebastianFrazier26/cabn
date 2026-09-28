import { describe, expect, it } from "vitest";
import {
	isRunnableExtension,
	runtimeForPath,
} from "../../src/serve/runtime.js";

describe("runtimeForPath", () => {
	it("maps .py to python3, traced", () => {
		const runtime = runtimeForPath("/repo/main.py");
		expect(runtime?.command).toBe("python3");
		expect(runtime?.traced).toBe(true);
		expect(runtime?.buildArgs("/repo/main.py")).toEqual([
			"-c",
			expect.stringContaining("settrace"),
			"/repo/main.py",
		]);
	});

	it("maps .js and .mjs to node, untraced", () => {
		expect(runtimeForPath("/repo/main.js")).toMatchObject({
			command: "node",
			traced: false,
		});
		expect(runtimeForPath("/repo/main.mjs")).toMatchObject({
			command: "node",
			traced: false,
		});
	});

	it("maps .ts to node --experimental-strip-types", () => {
		const runtime = runtimeForPath("/repo/main.ts");
		expect(runtime?.command).toBe("node");
		expect(runtime?.buildArgs("/repo/main.ts")).toEqual([
			"--experimental-strip-types",
			"/repo/main.ts",
		]);
	});

	it("is case-insensitive on extension", () => {
		expect(runtimeForPath("/repo/MAIN.PY")).toBeDefined();
	});

	it("is undefined for anything not on the allowlist", () => {
		expect(runtimeForPath("/repo/main.rb")).toBeUndefined();
		expect(runtimeForPath("/repo/main.sh")).toBeUndefined();
		expect(runtimeForPath("/repo/README.md")).toBeUndefined();
		expect(runtimeForPath("/repo/noext")).toBeUndefined();
	});
});

describe("isRunnableExtension", () => {
	it("agrees with runtimeForPath", () => {
		expect(isRunnableExtension("/repo/main.py")).toBe(true);
		expect(isRunnableExtension("/repo/main.rb")).toBe(false);
	});
});
