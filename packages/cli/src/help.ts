export const CLI_VERSION = "0.0.0";

export function helpText(): string {
	return [
		`cabn ${CLI_VERSION}`,
		"",
		"Turn a directory or zipfile into an explorable cottagecore game world.",
		"",
		"Usage:",
		"  cabn build <dir|zipfile> [-o outDir]   Convert a source into a world bundle",
		"  cabn inspect <bundleDir>               Validate and summarize a world bundle",
		"  cabn --version                         Print the CLI version",
		"  cabn --help                            Show this help text",
	].join("\n");
}
