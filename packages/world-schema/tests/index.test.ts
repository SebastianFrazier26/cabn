import { expect, test } from "vitest";
import { CABN_VERSION, type World } from "../src/index.js";

test("schema version is 1", () => {
	expect(CABN_VERSION).toBe(1);
});

test("World shape typechecks", () => {
	const world: World = {
		version: CABN_VERSION,
		root: { kind: "cluster", name: "home" },
	};
	expect(world.root.kind).toBe("cluster");
});
