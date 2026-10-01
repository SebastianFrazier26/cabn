import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEMO_CSP, DEMO_CSP_HEADER } from "../csp-policy.mjs";
import {
	CSP_PLACEHOLDER,
	renderCaddyfile,
} from "../scripts/render-caddyfile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const template = await readFile(join(here, "..", "Caddyfile"), "utf8");

function cspHeaders(caddyfile) {
	return [
		...caddyfile.matchAll(/^\s*Content-Security-Policy\s+"([^"]*)"/gm),
	].map((m) => m[1]);
}

describe("hosted demo Caddyfile", () => {
	it("sends exactly the csp-policy.mjs policy plus frame-ancestors 'none'", () => {
		const headers = cspHeaders(renderCaddyfile(template));
		expect(headers).toEqual([DEMO_CSP_HEADER]);
		expect(DEMO_CSP_HEADER).toBe(`${DEMO_CSP}; frame-ancestors 'none'`);
	});

	it("keeps the policy out of the template itself", () => {
		expect(cspHeaders(template)).toEqual([CSP_PLACEHOLDER]);
		expect(template).not.toContain("default-src");
	});

	it("sends the other security headers", () => {
		const rendered = renderCaddyfile(template);
		expect(rendered).toMatch(/X-Content-Type-Options\s+"nosniff"/);
		expect(rendered).toMatch(/Referrer-Policy\s+"no-referrer"/);
		expect(rendered).toMatch(/Permissions-Policy\s+"[^"]*camera=\(\)/);
	});

	it("refuses a template without exactly one placeholder", () => {
		expect(() => renderCaddyfile("no placeholder")).toThrow(/exactly once/);
		expect(() =>
			renderCaddyfile(`${CSP_PLACEHOLDER} ${CSP_PLACEHOLDER}`),
		).toThrow(/exactly once/);
	});

	it("refuses a policy that would break the quoted token", () => {
		expect(() => renderCaddyfile(template, 'default-src "x"')).toThrow();
	});
});
