import { DEMO_CSP } from "../csp-policy.mjs";
import { expect, test } from "./cspGuard";

// The guard in cspGuard.ts is only worth something if the policy is live and
// a violation actually reaches it.
test("the served page enforces the demo CSP and the guard sees violations", async ({
	page,
	cspViolations,
}) => {
	await page.goto("/");
	const policy = await page
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute("content");
	expect(policy).toBe(DEMO_CSP);

	const ran = await page.evaluate(() => {
		const w = window as unknown as { __cspProbe?: boolean };
		const s = document.createElement("script");
		s.textContent = "window.__cspProbe = true";
		document.head.append(s);
		return w.__cspProbe === true;
	});
	expect(ran).toBe(false);
	await expect
		.poll(() => cspViolations.map((v) => v.directive).sort())
		.toEqual(["console", "script-src-elem"]);
	// Expected here; cleared so the guard's own after-check passes.
	cspViolations.length = 0;
});
