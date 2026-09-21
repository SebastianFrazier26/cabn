import type { FileKind } from "@cabn/world-schema";

interface ExtEntry {
	kind: FileKind;
	language?: string;
}

// Extension (no leading dot, lowercase) -> {kind, language}. Not exhaustive —
// covers mainstream languages/formats; anything missing falls through to
// shebang sniffing (extensionless) or "unknown".
const EXTENSIONS: Record<string, ExtEntry> = {
	ts: { kind: "code", language: "typescript" },
	tsx: { kind: "code", language: "typescript" },
	mts: { kind: "code", language: "typescript" },
	cts: { kind: "code", language: "typescript" },
	js: { kind: "code", language: "javascript" },
	jsx: { kind: "code", language: "javascript" },
	mjs: { kind: "code", language: "javascript" },
	cjs: { kind: "code", language: "javascript" },
	py: { kind: "code", language: "python" },
	rs: { kind: "code", language: "rust" },
	go: { kind: "code", language: "go" },
	java: { kind: "code", language: "java" },
	kt: { kind: "code", language: "kotlin" },
	scala: { kind: "code", language: "scala" },
	c: { kind: "code", language: "c" },
	h: { kind: "code", language: "c" },
	cpp: { kind: "code", language: "cpp" },
	cc: { kind: "code", language: "cpp" },
	hpp: { kind: "code", language: "cpp" },
	cs: { kind: "code", language: "csharp" },
	rb: { kind: "code", language: "ruby" },
	php: { kind: "code", language: "php" },
	sh: { kind: "code", language: "shell" },
	bash: { kind: "code", language: "shell" },
	zsh: { kind: "code", language: "shell" },
	sql: { kind: "code", language: "sql" },
	swift: { kind: "code", language: "swift" },
	lua: { kind: "code", language: "lua" },
	pl: { kind: "code", language: "perl" },
	r: { kind: "code", language: "r" },
	html: { kind: "code", language: "html" },
	htm: { kind: "code", language: "html" },
	css: { kind: "code", language: "css" },
	scss: { kind: "code", language: "scss" },

	md: { kind: "markdown", language: "markdown" },
	mdx: { kind: "markdown", language: "markdown" },
	markdown: { kind: "markdown", language: "markdown" },

	json: { kind: "config", language: "json" },
	jsonc: { kind: "config", language: "json" },
	yaml: { kind: "config", language: "yaml" },
	yml: { kind: "config", language: "yaml" },
	toml: { kind: "config", language: "toml" },
	ini: { kind: "config", language: "ini" },
	cfg: { kind: "config", language: "ini" },
	env: { kind: "config" },

	csv: { kind: "data" },
	tsv: { kind: "data" },
	xml: { kind: "data" },
	ndjson: { kind: "data" },
	txt: { kind: "data" },

	png: { kind: "image" },
	jpg: { kind: "image" },
	jpeg: { kind: "image" },
	gif: { kind: "image" },
	svg: { kind: "image" },
	webp: { kind: "image" },
	ico: { kind: "image" },
	bmp: { kind: "image" },

	pdf: { kind: "binary" },
	zip: { kind: "binary" },
	tar: { kind: "binary" },
	gz: { kind: "binary" },
	exe: { kind: "binary" },
	dll: { kind: "binary" },
	so: { kind: "binary" },
	dylib: { kind: "binary" },
	mp3: { kind: "binary" },
	mp4: { kind: "binary" },
	wav: { kind: "binary" },
	mov: { kind: "binary" },
	woff: { kind: "binary" },
	woff2: { kind: "binary" },
	ttf: { kind: "binary" },
	otf: { kind: "binary" },
};

const SHEBANG_LANGUAGES: Record<string, string> = {
	python: "python",
	python3: "python",
	node: "javascript",
	bash: "shell",
	sh: "shell",
	zsh: "shell",
	ruby: "ruby",
	perl: "perl",
	php: "php",
};

const BINARY_SNIFF_WINDOW = 8192;

export function sniffBinary(bytes: Uint8Array): boolean {
	const end = Math.min(bytes.length, BINARY_SNIFF_WINDOW);
	for (let i = 0; i < end; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

export function sniffShebangLanguage(bytes: Uint8Array): string | undefined {
	if (bytes.length < 2 || bytes[0] !== 0x23 || bytes[1] !== 0x21)
		return undefined;
	const end = bytes.indexOf(0x0a);
	const line = new TextDecoder().decode(
		bytes.subarray(0, end === -1 ? bytes.length : end),
	);
	const interpreter = line
		.replace("#!", "")
		.trim()
		.split(/[\s/]+/)
		.pop();
	return interpreter ? SHEBANG_LANGUAGES[interpreter] : undefined;
}

function extensionOf(filename: string): string | undefined {
	const dot = filename.lastIndexOf(".");
	if (dot === -1) return undefined;
	// A bare dotfile (".env", ".gitignore") has no name before the dot — treat
	// what follows the dot as its "extension" so ".env" still hits the config
	// table entry, same as "app.env" would.
	return filename.slice(dot + 1).toLowerCase();
}

export interface ClassifyResult {
	kind: FileKind;
	language?: string;
	binary: boolean;
}

/**
 * Classifies a file by extension, falling back to shebang sniffing (for
 * extensionless files) and null-byte binary detection. `content` is optional
 * because oversized files skip content reads entirely (see walk.ts) — in that
 * case classification is extension-only and `binary` is a best guess.
 */
export function classify(path: string, content?: Uint8Array): ClassifyResult {
	const name = path.split("/").pop() ?? path;
	const ext = extensionOf(name);
	const known = ext ? EXTENSIONS[ext] : undefined;

	if (known?.kind === "image" || known?.kind === "binary") {
		return { kind: known.kind, language: known.language, binary: true };
	}

	if (known) {
		if (content === undefined) {
			return { kind: known.kind, language: known.language, binary: false };
		}
		if (sniffBinary(content)) {
			// Extension claimed text but content isn't — treat as corrupted/binary
			// rather than trusting a possibly-wrong extension.
			return { kind: "binary", binary: true };
		}
		return { kind: known.kind, language: known.language, binary: false };
	}

	if (content === undefined) {
		return { kind: "unknown", binary: false };
	}

	const shebangLanguage = sniffShebangLanguage(content);
	if (shebangLanguage) {
		return { kind: "code", language: shebangLanguage, binary: false };
	}

	if (sniffBinary(content)) {
		return { kind: "binary", binary: true };
	}

	return { kind: "unknown", binary: false };
}
