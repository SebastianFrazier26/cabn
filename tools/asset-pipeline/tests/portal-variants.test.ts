import { describe, expect, test } from "vitest";
import {
	PORTAL_GRID,
	PORTAL_INTERIOR,
	portalArch,
} from "../src/pixelmaps/portal-arch.js";
import {
	ARCH_VARIANT_IDS,
	portalVariantMap,
} from "../src/pixelmaps/portal-variants.js";

const inOpening = (x: number, y: number) =>
	x >= PORTAL_INTERIOR.x &&
	x < PORTAL_INTERIOR.x + PORTAL_INTERIOR.width &&
	y >= PORTAL_INTERIOR.y &&
	y < PORTAL_INTERIOR.y + PORTAL_INTERIOR.height;

describe("portal-type arch variants", () => {
	test.each(ARCH_VARIANT_IDS)(
		"%s keeps the base opening empty and never removes base stone",
		(id) => {
			const map = portalVariantMap(id);
			expect(map.rows).toHaveLength(PORTAL_GRID);
			for (let y = 0; y < PORTAL_GRID; y++) {
				for (let x = 0; x < PORTAL_GRID; x++) {
					const ch = map.rows[y]?.[x];
					if (inOpening(x, y)) expect(ch).toBe(".");
					// The engine can only stack the overlay onto the base, never erase.
					if (portalArch.rows[y]?.[x] !== ".") expect(ch).not.toBe(".");
					if (ch !== ".") expect(map.legend[ch ?? ""]).toBeTypeOf("number");
				}
			}
		},
	);

	test("is deterministic and every variant differs from the base and from each other", () => {
		expect(portalVariantMap("python").rows).toEqual(
			portalVariantMap("python").rows,
		);
		const signatures = ARCH_VARIANT_IDS.map((id) => {
			const map = portalVariantMap(id);
			return JSON.stringify([map.rows, map.legend]);
		});
		expect(new Set(signatures).size).toBe(ARCH_VARIANT_IDS.length);
		for (const id of ARCH_VARIANT_IDS) {
			expect(portalVariantMap(id).rows).not.toEqual(portalArch.rows);
		}
	});
});
