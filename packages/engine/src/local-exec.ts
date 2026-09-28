// A separate entry point (package.json's "./local-exec" export), not part of
// the main "@cabn/engine" barrel (src/index.ts) — the guarantee that
// hosted/demo builds never ship real code execution rests on this module
// simply never being imported by anything except a `cabn serve --allow-exec`
// host page's own entry script (see cli's hostPage.ts). Same pattern as
// @cabn/converter's "./browser" subpath, for the opposite reason: that one
// separates "safe everywhere" from "needs Node built-ins"; this one separates
// "safe everywhere" from "can run arbitrary code".
export * from "./systems/execution/localRunProvider.js";
