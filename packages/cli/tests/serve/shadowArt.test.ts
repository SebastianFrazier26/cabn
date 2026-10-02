import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("@cabn/shadow-art");
	vi.resetModules();
});

const load = async () => await import("../../src/serve/shadowArt.js");

describe("resolveShadowArtDir", () => {
	it("prefers the installed @cabn/shadow-art package", async () => {
		const { shadowAssetsDir } = await import("@cabn/shadow-art");
		const { resolveShadowArtDir } = await load();
		expect(await resolveShadowArtDir("/nowhere/at/all")).toBe(shadowAssetsDir);
	});

	it("falls back to the repo's assets/generated/shadow without the package", async () => {
		vi.doMock("@cabn/shadow-art", () => {
			throw new Error("Cannot find package '@cabn/shadow-art'");
		});
		const repo = await mkdtemp(join(tmpdir(), "cabn-shadow-repo-"));
		try {
			const { resolveShadowArtDir } = await load();
			expect(await resolveShadowArtDir(repo)).toBe(repo);
			expect(await resolveShadowArtDir(join(repo, "missing"))).toBeUndefined();
		} finally {
			await rm(repo, { recursive: true, force: true });
		}
	});

	it("skips an installed but unbuilt package", async () => {
		vi.doMock("@cabn/shadow-art", () => ({
			shadowAssetsDir: "/nowhere/dist/shadow",
		}));
		const { resolveShadowArtDir } = await load();
		expect(await resolveShadowArtDir("/also/nowhere")).toBeUndefined();
	});
});
