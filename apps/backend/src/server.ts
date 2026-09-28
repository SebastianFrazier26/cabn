import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
	const config = loadConfig();

	let app: ReturnType<typeof buildApp>;
	try {
		app = buildApp(config);
	} catch (err) {
		// No app/logger exists yet if buildApp's own startup guard threw.
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
		return;
	}

	try {
		await app.listen({ port: config.port, host: config.host });
	} catch (err) {
		app.log.error(err);
		process.exitCode = 1;
	}
}

// Guarded the same way apps/demo/scripts/build-world.mjs is, so vitest can
// import buildApp/loadConfig without booting a real server as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
