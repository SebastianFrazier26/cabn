// zod builds its object schemas with a caught `new Function("")` probe, and
// this page's CSP (no 'unsafe-eval') reports that probe as a violation even
// though zod falls back fine. `jitless` skips it. It has to be set before any
// bundled chunk constructs a schema, and the bundler hoists shared chunks
// above anything in main.tsx, so it runs here: a classic script executes
// before the deferred module script. zod 4 keeps this config on globalThis
// (zod/v4/core/core.js: `globalThis.__zod_globalConfig ??= {}`) and adopts an
// object that is already there.
globalThis.__zod_globalConfig = Object.assign(
	globalThis.__zod_globalConfig || {},
	{ jitless: true },
);
