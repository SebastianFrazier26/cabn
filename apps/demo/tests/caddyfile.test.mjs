import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DEMO_CSP,
	DEMO_CSP_HEADER,
	DEMO_FRAME_ANCESTORS,
} from "../csp-policy.mjs";
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
	it("sends exactly the csp-policy.mjs policy plus the portfolio frame-ancestors allowlist", () => {
		const headers = cspHeaders(renderCaddyfile(template));
		expect(headers).toEqual([DEMO_CSP_HEADER]);
		expect(DEMO_FRAME_ANCESTORS).toEqual([
			"'self'",
			"https://sebastianfrazier.com",
			"https://www.sebastianfrazier.com",
		]);
		expect(DEMO_CSP_HEADER).toBe(
			`${DEMO_CSP}; frame-ancestors 'self' https://sebastianfrazier.com https://www.sebastianfrazier.com`,
		);
	});

	it("keeps frame-ancestors out of the meta policy", () => {
		expect(DEMO_CSP).not.toContain("frame-ancestors");
	});

	it("sends no X-Frame-Options, which can't express the allowlist", () => {
		expect(renderCaddyfile(template)).not.toMatch(/^\s*X-Frame-Options\s/im);
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
