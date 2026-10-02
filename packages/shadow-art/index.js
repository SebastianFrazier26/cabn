import { fileURLToPath } from "node:url";

/** Absolute directory holding the shadow PNGs, served by `cabn serve --owner` as `/assets/shadow/*`. */
export const shadowAssetsDir = fileURLToPath(
	new URL("./dist/shadow", import.meta.url),
);
