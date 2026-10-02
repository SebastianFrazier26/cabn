import { test as base, expect } from "@playwright/test";

// Specs import `test` from here instead of @playwright/test to fail on any
// Content-Security-Policy violation on the default page. The listener goes in
// through exposeBinding so it survives navigations; the console hook catches
// what a document listener can't see (workers report there).
export interface CspViolation {
	directive: string;
	blocked: string;
	source: string;
}

declare global {
	interface Window {
		__cabnCspViolation?: (v: CspViolation) => void;
	}
}

export const test = base.extend<{ cspViolations: CspViolation[] }>({
	cspViolations: [
		async ({ page }, use) => {
			const violations: CspViolation[] = [];
			await page.exposeBinding(
				"__cabnCspViolation",
				(_source, v: CspViolation) => {
					violations.push(v);
				},
			);
			await page.addInitScript(() => {
				document.addEventListener("securitypolicyviolation", (e) => {
					window.__cabnCspViolation?.({
						directive: e.effectiveDirective,
						blocked: e.blockedURI,
						source: `${e.sourceFile}:${e.lineNumber}`,
					});
				});
			});
			page.on("console", (msg) => {
				const text = msg.text();
				if (/Content Security Policy/i.test(text)) {
					violations.push({ directive: "console", blocked: text, source: "" });
				}
			});
			await use(violations);
			expect(violations, "Content-Security-Policy violations").toEqual([]);
		},
		{ auto: true },
	],
});

export { expect };
