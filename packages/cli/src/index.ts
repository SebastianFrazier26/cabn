export const CLI_VERSION = "0.0.0";

export function helpText(): string {
	return [
		`cabn ${CLI_VERSION}`,
		"",
		"Turn a directory or zipfile into an explorable cottagecore game world.",
		"",
		"Usage:",
		"  cabn <path>    (coming soon)",
		"  cabn --help",
	].join("\n");
}
