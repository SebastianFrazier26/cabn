// The engine's always-loaded slice of the converter (package.json "./core"):
// annotators for the battle re-check, media sniffing, the search-index
// shape and the clearing-fit math. Nothing here reaches convert() or the git
// reader, so a bundler never has to put isomorphic-git in a page's first
// chunk — the engine loads those later through "./browser", only when the
// git UI opens.
export * from "./annotate/index.js";
export * from "./clearingFit.js";
export * from "./media.js";
export * from "./search-index.js";
