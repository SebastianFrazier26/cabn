import { afterEach, describe, expect, it } from "vitest";
import {
	getActiveExecutionProvider,
	resetExecutionProvider,
	setExecutionProvider,
	traceProvider,
} from "../../src/systems/execution/executionProvider.js";

describe("executionProvider registry", () => {
	afterEach(() => {
		resetExecutionProvider();
	});

	it("defaults to traceProvider", () => {
		expect(getActiveExecutionProvider()).toBe(traceProvider);
	});

	it("traceProvider never executes content — it just heuristically traces it", async () => {
		const steps = await traceProvider.run({
			content: "import os\nx = 1",
			language: "python",
			filePath: "a.py",
		});
		expect(steps.map((s) => s.kind)).toEqual(["import", "stmt"]);
	});

	it("setExecutionProvider swaps the active provider; resetExecutionProvider restores traceProvider", () => {
		const fake = { id: "fake", run: async () => [] };
		setExecutionProvider(fake);
		expect(getActiveExecutionProvider()).toBe(fake);
		resetExecutionProvider();
		expect(getActiveExecutionProvider()).toBe(traceProvider);
	});
});
