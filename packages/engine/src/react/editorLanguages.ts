import type { Extension } from "@codemirror/state";

// Keyed by @cabn/converter's classify.ts `language` vocabulary (PortalFile.language),
// not by file extension — one converter-side classification, one lookup here.
// Only the six the milestone scoped in get a real language pack; everything
// else (rust, go, yaml, ...) edits as plain text rather than pulling in a
// CodeMirror language package per possible source language.
const LOADERS: Record<string, () => Promise<Extension>> = {
	javascript: async () =>
		(await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
	typescript: async () =>
		(await import("@codemirror/lang-javascript")).javascript({
			jsx: true,
			typescript: true,
		}),
	python: async () => (await import("@codemirror/lang-python")).python(),
	markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
	json: async () => (await import("@codemirror/lang-json")).json(),
	css: async () => (await import("@codemirror/lang-css")).css(),
	html: async () => (await import("@codemirror/lang-html")).html(),
};

/** Lazily imports and instantiates the CodeMirror language extension for a PortalFile's `language`, or `null` for an unmapped/absent language (plain-text editing, no syntax highlighting beyond the theme's defaults). */
export async function loadLanguageExtension(
	language: string | undefined,
): Promise<Extension | null> {
	const loader = language ? LOADERS[language] : undefined;
	return loader ? loader() : null;
}
