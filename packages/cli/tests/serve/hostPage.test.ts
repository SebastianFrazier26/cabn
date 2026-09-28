import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleHostApp, hostPageHtml } from "../../src/serve/hostPage.js";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "cabn-hostpage-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("bundleHostApp", () => {
	it("produces syntactically valid ESM", async () => {
		const js = await bundleHostApp({ token: "abc123", allowExec: false });
		expect(js.length).toBeGreaterThan(0);
		const file = join(dir, "app.mjs");
		await writeFile(file, js);
		// `node --check` parses without executing (so it never tries to resolve
		// this bundle's own browser-only imports like "react-dom/client") — a
		// syntax check is what actually matters here; real behavior is covered
		// by the manual `cabn serve` smoke test (see CHANGELOG).
		expect(() => execFileSync("node", ["--check", file])).not.toThrow();
	});

	it("only references the local-exec wiring when allowExec is true", async () => {
		// "installLocalRunProvider" itself is just an identifier — minification
		// renames it, so it can't be grepped for reliably (this is the same
		// distinction check-no-exec-in-bundle.mjs makes: look for a *string
		// literal* the exec wire protocol uses, which minification never
		// touches).
		const withoutExec = await bundleHostApp({
			token: "abc123",
			allowExec: false,
		});
		const withExec = await bundleHostApp({ token: "abc123", allowExec: true });
		expect(withoutExec).not.toContain("x-cabn-token");
		expect(withExec).toContain("x-cabn-token");
	});
}, 20_000);

describe("hostPageHtml", () => {
	it("embeds the token and points at /app.js", () => {
		const html = hostPageHtml("my-token");
		expect(html).toContain("my-token");
		expect(html).toContain("/app.js");
	});
});
