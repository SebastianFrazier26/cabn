import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import {
	ARCH_VARIANTS,
	archVariantFor,
	archVariantFrame,
} from "../src/systems/archVariant.js";

function file(
	name: string,
	extra: Partial<Pick<PortalFile, "kind" | "language" | "binary">> = {},
): Pick<PortalFile, "name" | "kind" | "language" | "binary"> {
	return { name, kind: "code", binary: false, ...extra };
}

describe("archVariantFor", () => {
	test.each([
		["main.py", "python"],
		["index.ts", "typescript"],
		["App.tsx", "typescript"],
		["app.mjs", "javascript"],
		["Program.cs", "csharp"],
		["gem.rb", "ruby"],
		["lib.rs", "rust"],
		["main.go", "go"],
		["Main.kt", "jvm"],
		["Main.java", "jvm"],
		["vec.hpp", "cfamily"],
		["build.sh", "shell"],
		["package.json", "config"],
		["pyproject.toml", "config"],
		["ci.yml", "config"],
		["index.html", "web"],
		["site.scss", "web"],
		["notes.md", "markdown"],
		["photo.JPG", "image"],
		["theme.wav", "audio"],
		["paper.pdf", "pdf"],
		["data.csv", "table"],
		["Gemfile", "ruby"],
		["Makefile", "shell"],
		[".gitignore", "config"],
	] as const)("%s -> %s", (name, expected) => {
		expect(archVariantFor(file(name))).toBe(expected);
	});

	test("README, CHANGELOG, LICENSE and friends are docs regardless of extension", () => {
		for (const name of [
			"README.md",
			"readme",
			"README.rst",
			"CHANGELOG.md",
			"LICENSE",
			"LICENSE.txt",
			"CONTRIBUTING.md",
		]) {
			expect(archVariantFor(file(name, { kind: "markdown" }))).toBe("readme");
		}
		expect(archVariantFor(file("readme_parser.py"))).toBe("python");
	});

	test("the preview the arch shows wins over the file name", () => {
		expect(archVariantFor(file("pyproject.toml"), "url")).toBe("url");
		expect(archVariantFor(file("photo.png"), "image")).toBe("image");
		// ...but a cabn.json image override doesn't retype the file.
		expect(archVariantFor(file("README.md"), "image")).toBe("readme");
		expect(archVariantFor(file("guide.md"), "image")).toBe("markdown");
		expect(archVariantFor(file("clip.bin"), "audio")).toBe("audio");
		expect(archVariantFor(file("data.txt"), "table")).toBe("table");
		expect(archVariantFor(file("blob.dat"), "sealed")).toBe("sealed");
		// code/markdown/text previews don't carry a type of their own.
		expect(archVariantFor(file("main.py"), "code")).toBe("python");
		expect(archVariantFor(file("README.md"), "markdown")).toBe("readme");
	});

	test("extensionless scripts fall back to the sniffed language, then kind", () => {
		expect(archVariantFor(file("deploy", { language: "python" }))).toBe(
			"python",
		);
		expect(archVariantFor(file("run", { language: "shell" }))).toBe("shell");
		expect(archVariantFor(file("settings.weird", { kind: "config" }))).toBe(
			"config",
		);
		expect(archVariantFor(file("blob.dat", { kind: "binary" }))).toBe("sealed");
		expect(
			archVariantFor(file("thing", { binary: true, kind: "unknown" })),
		).toBe("sealed");
	});

	test("unknown files get the generic arch", () => {
		expect(archVariantFor(file("notes.txt", { kind: "data" }))).toBe("generic");
		expect(archVariantFor(file("mystery", { kind: "unknown" }))).toBe(
			"generic",
		);
	});
});

describe("archVariantFrame", () => {
	test("generic has no overlay; every other variant has its own frame", () => {
		expect(archVariantFrame("generic")).toBeNull();
		const frames = ARCH_VARIANTS.map(archVariantFrame);
		expect(new Set(frames).size).toBe(ARCH_VARIANTS.length);
		expect(frames).toEqual(ARCH_VARIANTS.map((_, i) => i));
	});

	test("frame order matches the overlay sheet the asset pipeline generated", () => {
		const indexPath = fileURLToPath(
			new URL(
				"../../../assets/generated/placeholders/portal_arch_variants.json",
				import.meta.url,
			),
		);
		const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
			variants: { id: string; frame: number }[];
		};
		expect(index.variants.map((v) => v.id)).toEqual([...ARCH_VARIANTS]);
		expect(index.variants.map((v) => v.frame)).toEqual(
			ARCH_VARIANTS.map((_, i) => i),
		);
	});
});
