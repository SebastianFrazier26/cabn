import type { PortalFile } from "@cabn/world-schema";
import type { DisplayPreviewKind } from "./archPreview.js";

/**
 * Which portal-type arch a file gets (2026-09-28). Frame order of the overlay
 * sheet tools/asset-pipeline renders (pixelmaps/portal-variants.ts
 * ARCH_VARIANT_IDS) — tests/archVariant.test.ts checks it against the
 * generated portal_arch_variants.json so the two can't drift silently.
 * "generic" has no overlay: it is the plain base arch.
 */
export const ARCH_VARIANTS = [
	"readme",
	"markdown",
	"python",
	"javascript",
	"typescript",
	"csharp",
	"ruby",
	"rust",
	"go",
	"jvm",
	"cfamily",
	"shell",
	"config",
	"web",
	"image",
	"audio",
	"pdf",
	"table",
	"url",
	"sealed",
] as const;
export type ArchVariant = (typeof ARCH_VARIANTS)[number] | "generic";

// What the arch actually shows beats what the file is called: a cabn.json url
// override on pyproject.toml is a live web page, and a media.json audio entry
// is audio even if the extension lied.
// A cabn.json *image* override is only how an author chose to preview a file
// (the sample README shows a banner image) — it stays the file's own type.
const BY_PREVIEW: Partial<Record<DisplayPreviewKind, ArchVariant>> = {
	url: "url",
	audio: "audio",
	pdf: "pdf",
	table: "table",
	sealed: "sealed",
};

const DOC_NAME =
	/^(readme|changelog|changes|history|news|license|licence|copying|contributing|authors|notice|code_of_conduct|security|support)(\.[a-z0-9]+)?$/i;

const BY_NAME: Record<string, ArchVariant> = {
	gemfile: "ruby",
	rakefile: "ruby",
	makefile: "shell",
	dockerfile: "shell",
	justfile: "shell",
	".gitignore": "config",
	".gitattributes": "config",
	".editorconfig": "config",
	".npmrc": "config",
	".env": "config",
};

const BY_EXT: Record<string, ArchVariant> = {
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	rst: "markdown",
	py: "python",
	pyi: "python",
	pyw: "python",
	ipynb: "python",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	cs: "csharp",
	csx: "csharp",
	rb: "ruby",
	rake: "ruby",
	gemspec: "ruby",
	erb: "ruby",
	rs: "rust",
	go: "go",
	java: "jvm",
	kt: "jvm",
	kts: "jvm",
	scala: "jvm",
	groovy: "jvm",
	gradle: "jvm",
	c: "cfamily",
	h: "cfamily",
	cc: "cfamily",
	cpp: "cfamily",
	cxx: "cfamily",
	hpp: "cfamily",
	hh: "cfamily",
	hxx: "cfamily",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	ps1: "shell",
	bat: "shell",
	cmd: "shell",
	json: "config",
	jsonc: "config",
	json5: "config",
	yaml: "config",
	yml: "config",
	toml: "config",
	ini: "config",
	cfg: "config",
	conf: "config",
	env: "config",
	properties: "config",
	lock: "config",
	html: "web",
	htm: "web",
	css: "web",
	scss: "web",
	sass: "web",
	less: "web",
	vue: "web",
	svelte: "web",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	svg: "image",
	webp: "image",
	bmp: "image",
	ico: "image",
	mp3: "audio",
	wav: "audio",
	ogg: "audio",
	oga: "audio",
	flac: "audio",
	m4a: "audio",
	pdf: "pdf",
	csv: "table",
	tsv: "table",
	xlsx: "table",
	xls: "table",
};

/** Converter language ids (packages/converter/src/classify.ts) — reached for shebang-sniffed extensionless scripts. */
const BY_LANGUAGE: Record<string, ArchVariant> = {
	python: "python",
	javascript: "javascript",
	typescript: "typescript",
	csharp: "csharp",
	ruby: "ruby",
	rust: "rust",
	go: "go",
	java: "jvm",
	kotlin: "jvm",
	scala: "jvm",
	c: "cfamily",
	cpp: "cfamily",
	shell: "shell",
	markdown: "markdown",
	json: "config",
	yaml: "config",
	toml: "config",
	ini: "config",
	html: "web",
	css: "web",
	scss: "web",
};

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function archVariantFor(
	file: Pick<PortalFile, "name" | "kind" | "language" | "binary">,
	previewKind?: DisplayPreviewKind,
): ArchVariant {
	const fromPreview = previewKind ? BY_PREVIEW[previewKind] : undefined;
	if (fromPreview) return fromPreview;
	const name = file.name.toLowerCase();
	if (DOC_NAME.test(name)) return "readme";
	const named = BY_NAME[name];
	if (named) return named;
	const byExt = BY_EXT[extensionOf(name)];
	if (byExt) return byExt;
	const byLanguage = file.language ? BY_LANGUAGE[file.language] : undefined;
	if (byLanguage) return byLanguage;
	if (file.kind === "markdown") return "markdown";
	if (file.kind === "config") return "config";
	if (file.kind === "image") return "image";
	if (file.kind === "binary" || file.binary) return "sealed";
	return "generic";
}

/**
 * Each variant's rune ink (pixelmaps/portal-variants.ts SPECS[id].rune[0], as
 * 0xRRGGBB) — WorldScene lights the keystone plaque with it at night so the
 * emblem still reads once the night grade has darkened the stone.
 */
export const ARCH_VARIANT_GLOW: Record<ArchVariant, number> = {
	generic: 0xbfd6e0,
	readme: 0xf2b559,
	markdown: 0xedeee4,
	python: 0xffdc46,
	javascript: 0xffdc46,
	typescript: 0x7994d2,
	csharp: 0xb27cd6,
	ruby: 0xe63c32,
	rust: 0xeb8c3c,
	go: 0x40aece,
	jvm: 0xeb8c3c,
	cfamily: 0x7994d2,
	shell: 0x78c85a,
	config: 0xe6be78,
	web: 0xeb8c3c,
	image: 0xf0d05c,
	audio: 0xe3a5ba,
	pdf: 0xf2b559,
	table: 0x78c85a,
	url: 0x5aa0eb,
	sealed: 0xb04242,
};

/** Overlay-sheet frame for a variant, or null for the plain base arch. */
/** The plaque light's colour: a world skin's arch tint when it has one, else the variant's rune colour. */
export function archVariantGlow(
	variant: ArchVariant,
	skinTint: number | null = null,
): number {
	return skinTint ?? ARCH_VARIANT_GLOW[variant];
}

export function archVariantFrame(variant: ArchVariant): number | null {
	if (variant === "generic") return null;
	return ARCH_VARIANTS.indexOf(variant);
}
