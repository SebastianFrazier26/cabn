import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runBuild } from "../src/build.js";

const CANARIES: Record<string, string> = {
	".github/ci.yml": "SHADOW_CANARY_BUILD_GITHUB",
	".vscode/settings.json": "SHADOW_CANARY_BUILD_VSCODE",
	"src/.eslintrc.json": "SHADOW_CANARY_BUILD_ESLINT",
	".env": "SHADOW_CANARY_BUILD_ENV",
};

const temp: string[] = [];
afterEach(async () => {
	for (const d of temp.splice(0)) await rm(d, { recursive: true, force: true });
});

async function listFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(root, {
		withFileTypes: true,
		recursive: true,
	})) {
		if (entry.isFile())
			out.push(relative(root, join(entry.parentPath, entry.name)));
	}
	return out;
}

test("cabn build output carries no hidden path and no hidden content", async () => {
	const src = await mkdtemp(join(tmpdir(), "cabn-build-canary-src-"));
	const out = join(await mkdtemp(join(tmpdir(), "cabn-build-canary-")), "w");
	temp.push(src, dirname(out));
	const files: Record<string, string> = {
		"README.md": "# canary\n",
		"src/app.ts": "export const a = 1;\n",
	};
	for (const [path, canary] of Object.entries(CANARIES))
		files[path] = `value: ${canary}\n`;
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(src, path)), { recursive: true });
		await writeFile(join(src, path), content);
	}

	const summary = await runBuild(src, { outDir: out, offline: true });
	expect(summary.portals).toBe(2);

	const written = await listFiles(out);
	expect(written).toContain("world.json");
	for (const file of written) {
		expect(
			file.split("/").some((s) => s.startsWith(".")),
			file,
		).toBe(false);
		const body = await readFile(join(out, file), "utf8");
		expect(body, file).not.toContain("SHADOW_CANARY");
		for (const name of [".github", ".vscode", ".eslintrc", ".env"])
			expect(body, `${file} names ${name}`).not.toContain(name);
	}
});

test("build.ts never imports the shadow realm", async () => {
	const source = await readFile(
		join(import.meta.dirname, "..", "src", "build.ts"),
		"utf8",
	);
	expect(source).not.toMatch(/convertShadow|shadowLayout|ownerShadow/);
});
