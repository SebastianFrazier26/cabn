import type { ShelfWorldEntry } from "@cabn/world-schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	ShelfWorldCard,
	ShelfWorldCardView,
} from "../src/react/ShelfWorldCard.js";

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

interface ElementLike {
	type: unknown;
	props: { children?: unknown; onClick?: (e: unknown) => void };
}

function buttons(node: unknown): ElementLike[] {
	if (Array.isArray(node)) return node.flatMap(buttons);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const el = node as ElementLike;
	return [...(el.type === "button" ? [el] : []), ...buttons(el.props.children)];
}

describe("ShelfWorldCard links", () => {
	afterEach(() => vi.unstubAllGlobals());

	const click = (button: ElementLike) =>
		button.props.onClick?.({ currentTarget: { blur() {} } });

	test("a link click goes through openShowcaseLink: https in a noopener tab", () => {
		const open = vi.fn();
		vi.stubGlobal("window", { open });
		const tree = ShelfWorldCardView({
			world: {
				...base,
				links: [{ label: "Repo", url: "https://github.com/x/y" }],
			},
		});
		const [repo] = buttons(tree);
		expect(repo).toBeDefined();
		click(repo as ElementLike);
		expect(open).toHaveBeenCalledWith(
			"https://github.com/x/y",
			"_blank",
			"noopener,noreferrer",
		);
	});

	test("a non-https link from a tampered shelf.json never opens", () => {
		const open = vi.fn();
		vi.stubGlobal("window", { open });
		const tree = ShelfWorldCardView({
			world: {
				...base,
				links: [{ label: "Evil", url: "javascript:alert(1)" }],
			},
		});
		for (const b of buttons(tree)) click(b);
		expect(open).not.toHaveBeenCalled();
	});
});
