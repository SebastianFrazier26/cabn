import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this module's own location (not cwd) so scripts behave the
// same whether invoked via `pnpm -F` (cwd = package dir) or `tsx` directly.
const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

export const sourceIconsDir = path.join(repoRoot, "assets/source/icons");
export const generatedDir = path.join(repoRoot, "assets/generated");
export const recoveredDir = path.join(generatedDir, "recovered");
export const placeholdersDir = path.join(generatedDir, "placeholders");

export const paletteJsonPath = path.join(generatedDir, "palette.json");
export const paletteSwatchPath = path.join(generatedDir, "palette-swatch.png");
export const recoverConfigPath = path.join(here, "..", "recover.config.json");
export const manifestJsonPath = path.join(generatedDir, "manifest.json");
export const previewHtmlPath = path.join(generatedDir, "preview.html");

export const sourceIconNames = [
	"cabin",
	"cabinet",
	"file",
	"key",
	"letter_opener",
] as const;
