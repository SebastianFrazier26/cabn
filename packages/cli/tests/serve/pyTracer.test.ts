import { describe, expect, it } from "vitest";
import {
	flushTraceCarry,
	LINE_MARKER_PREFIX,
	parseTraceChunk,
} from "../../src/serve/pyTracer.js";

describe("parseTraceChunk", () => {
	it("extracts a single complete marker and leaves surrounding text intact", () => {
		const result = parseTraceChunk(
			"",
			`before\n${LINE_MARKER_PREFIX}3\nafter\n`,
		);
		expect(result.events).toEqual([{ line: 3 }]);
		expect(result.text).toBe("before\nafter\n");
		expect(result.carry).toBe("");
	});

	it("extracts multiple markers in order", () => {
		const result = parseTraceChunk(
			"",
			`${LINE_MARKER_PREFIX}1\nout1\n${LINE_MARKER_PREFIX}2\nout2\n`,
		);
		expect(result.events).toEqual([{ line: 1 }, { line: 2 }]);
		expect(result.text).toBe("out1\nout2\n");
	});

	it("holds back a marker split across two chunks", () => {
		const first = parseTraceChunk("", "before\n\x1eLIN");
		expect(first.events).toEqual([]);
		expect(first.text).toBe("before\n");
		expect(first.carry).toBe("\x1eLIN");

		const second = parseTraceChunk(first.carry, "E 7\nafter\n");
		expect(second.events).toEqual([{ line: 7 }]);
		expect(second.text).toBe("after\n");
		expect(second.carry).toBe("");
	});

	it("holds back a marker whose trailing newline hasn't arrived yet", () => {
		const first = parseTraceChunk("", `${LINE_MARKER_PREFIX}5`);
		expect(first.events).toEqual([]);
		expect(first.carry).toBe(`${LINE_MARKER_PREFIX}5`);

		const second = parseTraceChunk(first.carry, "\n");
		expect(second.events).toEqual([{ line: 5 }]);
		expect(second.text).toBe("");
	});

	it("treats a chunk with no marker prefix at all as plain text, carry empty", () => {
		const result = parseTraceChunk("", "just some stderr output\n");
		expect(result.events).toEqual([]);
		expect(result.text).toBe("just some stderr output\n");
		expect(result.carry).toBe("");
	});
});

describe("flushTraceCarry", () => {
	it("returns whatever carry was left as plain text — it was never going to complete", () => {
		expect(flushTraceCarry("\x1eLIN")).toBe("\x1eLIN");
		expect(flushTraceCarry("")).toBe("");
	});
});
