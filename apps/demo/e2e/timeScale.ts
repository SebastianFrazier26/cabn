// Wall-clock budgets scale with E2E_TIME_SCALE (e.g. 3 on the nightly full-
// suite job) so a CPU-starved software-GL runner gets longer to bake and
// render without any assertion being loosened. Own module, no Playwright
// imports, so playwright.config.ts can read it too.
const raw = Number(process.env.E2E_TIME_SCALE ?? 1);
export const TIME_SCALE = Number.isFinite(raw) && raw > 0 ? raw : 1;

export function scaled(ms: number): number {
	return Math.round(ms * TIME_SCALE);
}
