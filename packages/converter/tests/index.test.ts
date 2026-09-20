import { expect, test } from "vitest";
import { emptyWorld } from "../src/index.js";

test("emptyWorld builds a versioned cluster root", () => {
	const world = emptyWorld("home");
	expect(world.version).toBe(1);
	expect(world.root).toEqual({ kind: "cluster", name: "home" });
});
