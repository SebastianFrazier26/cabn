import { readFileSync } from "node:fs";

// Read at runtime rather than inlined: tsc emits dist/help.js one level
// below package.json, the same relative spot as src/help.ts, and the
// published package always ships package.json.
export const CLI_VERSION: string = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string }
).version;

export function helpText(): string {
	return [
		`cabn ${CLI_VERSION}`,
		"",
		"Turn a directory or zipfile into an explorable cottagecore game world.",
		"",
		"Usage:",
		"  cabn build <dir|zipfile> [-o outDir] [--include-secrets] [--offline] [--findings file]... [--no-history] [--git-dir path]",
		"                                          Convert a source into a world bundle",
		"                                          (a git repository root also ships its recent git history, author emails included, and",
		"                                          GitHub releases; --no-history skips that, --git-dir reads another git directory,",
		"                                          the opt-in for a .git symlink or a worktree/submodule .git pointer file;",
		"                                          (--include-secrets reads .env/*.pem/etc content instead of leaving them metadata-only;",
		"                                          --findings turns an ESLint JSON or SARIF results file into monsters, repeatable;",
		"                                          --offline skips the one-request-per-url check of whether url previews can be framed",
		"                                          and the GitHub releases request)",
		"  cabn inspect <bundleDir>               Validate and summarize a world bundle",
		"  cabn shelf <bundleDir...> [-o outDir]  Build a shelf.json listing multiple converted worlds",
		"  cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms] [--offline] [--owner] [--no-history] [--git-dir path]",
		"                                          Convert <dir> in memory and serve it as a walkable game, bound to",
		"                                          127.0.0.1 only. --allow-exec enables REAL code execution of files",
		"                                          you run with the wand tool — only pass it for code you trust.",
		"                                          --owner turns on owner mode: the page can write .seyn signs into <dir>,",
		"                                          commit your in-game edits and create/switch branches in the real",
		"                                          repository (local only; never push/fetch), and show hidden files.",
		"                                          In the game, O opens the owner's toolkit for all of these. Off by default.",
		"  cabn --version                         Print the CLI version",
		"  cabn --help                            Show this help text",
	].join("\n");
}
