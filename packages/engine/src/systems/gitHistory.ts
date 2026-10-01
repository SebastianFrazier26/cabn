import type { OmittedBlobReason } from "@cabn/world-schema";

/** Pure helpers for the rift, map timeline and pensieve; the git reads themselves live in systems/git/. */

export function shortOid(oid: string): string {
	return oid.slice(0, 7);
}

export function commitSubject(message: string): string {
	return message.split("\n", 1)[0] ?? "";
}

export function formatCommitDate(time: number): string {
	return new Date(time * 1000).toISOString().slice(0, 10);
}

function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Stable, url- and key-safe id for a branch's universe (tint, memory-world key, save slot suffix is the branch itself). */
export function universeSlug(branch: string): string {
	const base = branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return `${base || "branch"}-${fnv1a(branch).toString(16).padStart(8, "0").slice(0, 6)}`;
}

/** Deterministic per-universe hue from its slug; the main world (null) gets none. */
export function universeTint(slug: string | null): number | null {
	if (slug === null) return null;
	const hue = fnv1a(slug) % 360;
	return hslToRgb(hue / 360, 0.65, 0.55);
}

function hslToRgb(h: number, s: number, l: number): number {
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const channel = (t: number) => {
		let x = t;
		if (x < 0) x += 1;
		if (x > 1) x -= 1;
		if (x < 1 / 6) return p + (q - p) * 6 * x;
		if (x < 1 / 2) return q;
		if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
		return p;
	};
	const r = Math.round(channel(h + 1 / 3) * 255);
	const g = Math.round(channel(h) * 255);
	const b = Math.round(channel(h - 1 / 3) * 255);
	return (r << 16) | (g << 8) | b;
}

export function cssColor(rgb: number): string {
	return `#${rgb.toString(16).padStart(6, "0")}`;
}

export const NOT_SHIPPED_LABEL: Record<OmittedBlobReason | "unknown", string> =
	{
		"secret-name":
			"Not shipped: files with secret-looking names (.env, keys) or a key in their text are left out of the world's history.",
		"too-large":
			"Not shipped: this version is larger than the world's per-file history cap.",
		ignored: "Not shipped: this folder is one the world ignores.",
		"pack-cap":
			"Not shipped: left out to keep the world's history under its size cap.",
		unknown: "Not shipped with this world.",
	};
