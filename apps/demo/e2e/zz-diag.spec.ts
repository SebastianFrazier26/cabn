import { expect, test } from "./cspGuard";
import { getStoreState } from "./helpers";

test("diag: frame rate and walk speed", { tag: "@core" }, async ({ page }) => {
	await page.goto("/?e2e=1");
	await expect(page.locator("canvas")).toBeVisible();
	await page.waitForTimeout(3000);
	const info = await page.evaluate(async () => {
		const gl = document.createElement("canvas").getContext("webgl2");
		const ext = gl?.getExtension("WEBGL_debug_renderer_info");
		const renderer =
			ext && gl ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "n/a";
		let frames = 0;
		const t0 = performance.now();
		await new Promise<void>((res) => {
			const tick = () => {
				frames++;
				if (performance.now() - t0 > 3000) res();
				else requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		return {
			renderer,
			rafFps: frames / ((performance.now() - t0) / 1000),
			cores: navigator.hardwareConcurrency,
		};
	});
	const p0 = (await getStoreState(page))?.playerPos;
	const t0 = Date.now();
	await page.keyboard.down("ArrowRight");
	await page.waitForTimeout(3000);
	await page.keyboard.up("ArrowRight");
	const p1 = (await getStoreState(page))?.playerPos;
	const secs = (Date.now() - t0) / 1000;
	console.log(
		`DIAG ${JSON.stringify({ ...info, p0, p1, secs, pxPerSec: p0 && p1 ? (p1.x - p0.x) / secs : null })}`,
	);
});
