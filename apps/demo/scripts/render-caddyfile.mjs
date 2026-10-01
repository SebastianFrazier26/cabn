#!/usr/bin/env node
// Renders the hosted demo's Caddyfile with the CSP from csp-policy.mjs.
// Usage: node scripts/render-caddyfile.mjs <template> <out>
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEMO_CSP_HEADER } from "../csp-policy.mjs";

export const CSP_PLACEHOLDER = "__CABN_DEMO_CSP__";

export function renderCaddyfile(template, csp = DEMO_CSP_HEADER) {
	const count = template.split(CSP_PLACEHOLDER).length - 1;
	if (count !== 1) {
		throw new Error(
			`Caddyfile template must contain ${CSP_PLACEHOLDER} exactly once, found ${count}`,
		);
	}
	// The value sits inside a double-quoted Caddyfile token.
	if (/["\n\\]/.test(csp)) {
		throw new Error("CSP contains a character that breaks the quoted token");
	}
	return template.replace(CSP_PLACEHOLDER, csp);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [templatePath, outPath] = process.argv.slice(2);
	if (!templatePath || !outPath) {
		console.error("usage: render-caddyfile.mjs <template> <out>");
		process.exit(2);
	}
	const rendered = renderCaddyfile(await readFile(templatePath, "utf8"));
	await writeFile(outPath, rendered);
}
