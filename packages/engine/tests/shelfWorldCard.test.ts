import type { ShelfWorldEntry } from "@cabn/world-schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import { ShelfWorldCard } from "../src/react/ShelfWorldCard.js";

const base: ShelfWorldEntry = {
	id: "w",
	name: "Climbing risk",
	worldUrl: "w/world.json",
	themeSeed: 1,
	fileCount: 1,
	totalBytes: 1,
};

function render(world: ShelfWorldEntry): string {
	const store = createCabnStore();
	store.getState().setNearShelfWorld(world);
	return renderToStaticMarkup(createElement(ShelfWorldCard, { store }));
}

describe("ShelfWorldCard", () => {
	test("shows nothing away from a cabin", () => {
		const store = createCabnStore();
		expect(renderToStaticMarkup(createElement(ShelfWorldCard, { store }))).toBe(
			"",
		);
	});

	test("shows nothing for a world without showcase info", () => {
		expect(render(base)).toBe("");
	});

	test("shows the title, description, hero host and links", () => {
		const html = render({
			...base,
			description: "Route risk from similar climbs.",
			heroUrl: "https://demo.example.org/app",
			links: [{ label: "Repo", url: "https://github.com/x/y" }],
		});
		expect(html).toContain("Climbing risk");
		expect(html).toContain("Route risk from similar climbs.");
		expect(html).toContain("demo.example.org");
		expect(html).toContain("Repo ↗");
	});
});
