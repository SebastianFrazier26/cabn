import { describe, expect, test } from "vitest";
import { facingFromVelocity } from "../src/systems/facing.js";

describe("facingFromVelocity", () => {
	test("moving straight up faces back", () => {
		expect(facingFromVelocity(0, -1)).toBe("back");
	});

	test("moving straight down faces front", () => {
		expect(facingFromVelocity(0, 1)).toBe("front");
	});

	test("moving left or right faces front", () => {
		expect(facingFromVelocity(-1, 0)).toBe("front");
		expect(facingFromVelocity(1, 0)).toBe("front");
	});

	test("standing still faces front", () => {
		expect(facingFromVelocity(0, 0)).toBe("front");
	});

	test("diagonal movement dominated by upward motion faces back", () => {
		expect(facingFromVelocity(0.3, -1)).toBe("back");
	});

	test("diagonal movement dominated by horizontal motion faces front, even while also moving up", () => {
		expect(facingFromVelocity(-1, -0.3)).toBe("front");
	});

	test("an exact 45-degree up-diagonal (tie) faces front", () => {
		expect(facingFromVelocity(1, -1)).toBe("front");
	});
});
