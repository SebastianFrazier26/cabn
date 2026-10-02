#!/usr/bin/env node
// postbuild: the built page must carry exactly the policy in csp-policy.mjs,
// placed before anything it is meant to govern.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CSP } from "../csp-policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = await readFile(join(here, "..", "dist", "index.html"), "utf8");

const failures = [];
const metas = [
	...html.matchAll(
		/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi,
	),
];
if (metas.length !== 1) {
	failures.push(`expected one CSP meta tag, found ${metas.length}`);
} else {
	const [meta] = metas;
	if (meta[1] !== DEMO_CSP)
		failures.push("CSP meta differs from csp-policy.mjs");
	// Ignored in a meta tag; its presence would suggest a protection that isn't there.
	if (/frame-ancestors/i.test(meta[1]))
		failures.push("meta CSP names frame-ancestors");
	const firstGoverned = html.search(/<(script|style|link|iframe|img)\b/i);
	if (firstGoverned !== -1 && meta.index > firstGoverned) {
		failures.push(
			"CSP meta comes after a script, style or link it should govern",
		);
	}
	if (html.indexOf('<meta charset="UTF-8"') > 1024) {
		failures.push("charset meta pushed past the first 1024 bytes");
	}
}

if (failures.length > 0) {
	console.error(`check-csp-in-bundle: FAILED\n  ${failures.join("\n  ")}`);
	process.exit(1);
}
console.log("check-csp-in-bundle: OK — dist/index.html carries the demo CSP.");
