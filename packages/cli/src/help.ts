export const CLI_VERSION = "0.0.0";

export function helpText(): string {
	return [
		`cabn ${CLI_VERSION}`,
		"",
		"Turn a directory or zipfile into an explorable cottagecore game world.",
		"",
		"Usage:",
		"  cabn build <dir|zipfile> [-o outDir] [--include-secrets] [--offline] [--findings file]...",
		"                                          Convert a source into a world bundle",
		"                                          (--include-secrets reads .env/*.pem/etc content instead of leaving them metadata-only;",
		"                                          --findings turns an ESLint JSON or SARIF results file into monsters, repeatable;",
		"                                          --offline skips the one-request-per-url check of whether url previews can be framed)",
		"  cabn inspect <bundleDir>               Validate and summarize a world bundle",
		"  cabn shelf <bundleDir...> [-o outDir]  Build a shelf.json listing multiple converted worlds",
		"  cabn serve <dir> [--port 5178] [--allow-exec] [--timeout ms] [--offline] [--no-owner]",
		"                                          Convert <dir> in memory and serve it as a walkable game, bound to",
		"                                          127.0.0.1 only. --allow-exec enables REAL code execution of files",
		"                                          you run with the wand tool — only pass it for code you trust.",
		"                                          The page gets the owner's sign item (writes .seyn signs into <dir>);",
		"                                          --no-owner serves it read-only.",
		"  cabn --version                         Print the CLI version",
		"  cabn --help                            Show this help text",
	].join("\n");
}
