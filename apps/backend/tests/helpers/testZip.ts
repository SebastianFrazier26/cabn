import { zipSync } from "fflate";

/** A minimal, honestly-labeled zip a converted world can come from. */
export function makeValidZip(): Uint8Array {
	const utf8 = (s: string) => new TextEncoder().encode(s);
	return zipSync({
		"README.md": utf8("# hello\n\nsample upload\n"),
		"src/index.ts": utf8("export const answer = 42;\n"),
	});
}
