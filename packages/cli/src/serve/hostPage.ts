import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export interface HostPageOptions {
	token: string;
	allowExec: boolean;
}

/**
 * `React.createElement` directly rather than JSX — this string is bundled by
 * esbuild at `cabn serve` startup (see bundleHostApp), and skipping a JSX
 * loader/runtime means one less resolution edge (no `react/jsx-runtime`) for
 * that bundle to depend on. `installLocalRunProvider` is only ever imported
 * here when `--allow-exec` was passed; every other build of this page (and
 * every hosted/demo build of `@cabn/engine` itself, which never imports
 * `@cabn/engine/local-exec` at all) has no reference to it whatsoever — see
 * that module's own docs for why that's the actual dead-code guarantee, not
 * just the `__CABN_ALLOW_LOCAL_EXEC__` constant baked in below.
 */
function entrySource(opts: HostPageOptions): string {
	const localExecWiring = opts.allowExec
		? [
				'import { installLocalRunProvider } from "@cabn/engine/local-exec";',
				"installLocalRunProvider({ baseUrl: window.location.origin, token: window.__CABN_TOKEN__ });",
			].join("\n")
		: "";
	return `
import React from "react";
import { createRoot } from "react-dom/client";
import { CabnGame } from "@cabn/engine";
${localExecWiring}
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(CabnGame, { worldUrl: "/world/world.json" }));
`;
}

// This file lives at packages/cli/dist/serve/hostPage.js once built — two
// levels up is the package root, where pnpm's per-package node_modules
// (containing @cabn/engine, react, react-dom, esbuild's own resolution
// target) actually lives.
const CLI_PACKAGE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);

/** Bundles the tiny host entry (React + `@cabn/engine`, optionally the local-exec wiring) into one browser-ready ESM file, entirely in memory — no build artifact ever touches disk, so a fresh `cabn serve` in any checkout just works once `pnpm install` has run. */
export async function bundleHostApp(opts: HostPageOptions): Promise<string> {
	const result = await esbuild.build({
		stdin: {
			contents: entrySource(opts),
			resolveDir: CLI_PACKAGE_ROOT,
			loader: "js",
		},
		bundle: true,
		write: false,
		minify: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		define: {
			"process.env.NODE_ENV": '"production"',
			__CABN_ALLOW_LOCAL_EXEC__: opts.allowExec ? "true" : "false",
		},
		logLevel: "silent",
	});
	const output = result.outputFiles[0];
	if (!output) throw new Error("esbuild produced no output for the host page");
	return output.text;
}

export function hostPageHtml(token: string): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>cabn serve</title>
<style>html,body,#root{margin:0;height:100%;width:100%;background:#1f2a17;}</style>
</head>
<body>
<div id="root"></div>
<script>window.__CABN_TOKEN__ = ${JSON.stringify(token)};</script>
<script type="module" src="/app.js?token=${encodeURIComponent(token)}"></script>
</body>
</html>`;
}
