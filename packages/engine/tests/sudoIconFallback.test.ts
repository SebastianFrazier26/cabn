import type { SyntheticEvent } from "react";
import { describe, expect, it } from "vitest";
import { uiIconPath } from "../src/assetPaths.js";
import { iconFallback } from "../src/react/layerIcons.js";
import { SUDO_ICON_PATH } from "../src/shadow/assets.js";
import { createSudoTool } from "../src/shadow/sudoTool.js";
import { ownerToolkitEntries } from "../src/systems/ownerToolkit.js";
import type { WorldLayerProvider } from "../src/systems/worldLayer.js";

/** An <img> as far as iconFallback touches it: its src attribute. */
function fakeImg(src: string) {
	const img = {
		src,
		getAttribute: (name: string) => (name === "src" ? img.src : null),
	};
	return img;
}

const errorOn = (img: ReturnType<typeof fakeImg>) =>
	({ currentTarget: img }) as unknown as SyntheticEvent<HTMLImageElement>;

describe("the Sudo entry without @cabn/shadow-art", () => {
	const sudoEntry = () => {
		const layer = {
			id: "shadow",
			tools: [createSudoTool("shadow")],
		} as unknown as WorldLayerProvider;
		const entry = ownerToolkitEntries({
			signs: false,
			git: false,
			layers: [layer],
			signPlacing: false,
			activeLayerId: null,
		})[0];
		if (!entry) throw new Error("no sudo entry");
		return entry;
	};

	it("carries a bundled, non-shadow fallback icon", () => {
		const entry = sudoEntry();
		expect(entry.icon).toBe(SUDO_ICON_PATH);
		expect(entry.fallbackIcon).toBe(uiIconPath("key"));
		expect(entry.fallbackIcon).not.toMatch(/shadow/i);
	});

	it("swaps the missing sudo art for the key icon once, and doesn't loop if that fails too", () => {
		const entry = sudoEntry();
		const onError = iconFallback(entry.fallbackIcon ?? (entry.icon as string));
		const img = fakeImg(SUDO_ICON_PATH);
		onError(errorOn(img));
		expect(img.src).toBe(uiIconPath("key"));
		onError(errorOn(img));
		expect(img.src).toBe(uiIconPath("key"));
	});
});
