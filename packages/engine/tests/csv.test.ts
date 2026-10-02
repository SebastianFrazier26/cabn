import { describe, expect, test } from "vitest";
import {
	csvDelimiterForPath,
	isDelimitedTextPath,
	parseCsv,
} from "../src/systems/csv.js";

describe("parseCsv (RFC 4180)", () => {
	test("plain records with CRLF, LF and bare CR endings", () => {
		expect(parseCsv("a,b\r\nc,d\ne,f\rg,h").rows).toEqual([
			["a", "b"],
			["c", "d"],
			["e", "f"],
			["g", "h"],
		]);
	});

	test("quoted fields keep delimiters, newlines and doubled quotes", () => {
		const { rows, truncated } = parseCsv(
			'name,note\n"Smith, J","said ""hi""\nthen left"\n',
		);
		expect(rows).toEqual([
			["name", "note"],
			["Smith, J", 'said "hi"\nthen left'],
		]);
		expect(truncated).toBe(false);
	});

	test("empty fields, trailing delimiter, and no phantom row after a final newline", () => {
		expect(parseCsv('a,,c,\n"",x\n').rows).toEqual([
			["a", "", "c", ""],
			["", "x"],
		]);
		expect(parseCsv("").rows).toEqual([]);
		expect(parseCsv("\n").rows).toEqual([[""]]);
	});

	test("strips a UTF-8 BOM and supports a tab delimiter", () => {
		expect(parseCsv("﻿a\tb\n1\t2", { delimiter: "\t" }).rows).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("lenient on malformed input: unterminated quote, stray quotes", () => {
		expect(parseCsv('a,"open\nstill open').rows).toEqual([
			["a", "open\nstill open"],
		]);
		expect(parseCsv('ab"c,"x"y').rows).toEqual([['ab"c', "xy"]]);
	});

	test("row, column and cell caps set truncated", () => {
		const many = Array.from({ length: 10 }, (_, i) => `r${i}`).join("\n");
		const capped = parseCsv(many, { maxRows: 3 });
		expect(capped.rows).toEqual([["r0"], ["r1"], ["r2"]]);
		expect(capped.truncated).toBe(true);
		expect(parseCsv("a\nb\n", { maxRows: 2 }).truncated).toBe(false);

		const wide = parseCsv("1,2,3,4", { maxCols: 2 });
		expect(wide.rows).toEqual([["1", "2"]]);
		expect(wide.truncated).toBe(true);

		const long = parseCsv("abcdefgh", { maxCellChars: 3 });
		expect(long.rows).toEqual([["abc"]]);
		expect(long.truncated).toBe(true);
	});
});

describe("delimiter by path", () => {
	test("tsv/tab use tabs, csv uses commas", () => {
		expect(csvDelimiterForPath("data/x.TSV")).toBe("\t");
		expect(csvDelimiterForPath("data/x.tab")).toBe("\t");
		expect(csvDelimiterForPath("data/x.csv")).toBe(",");
		expect(isDelimitedTextPath("a/b.csv")).toBe(true);
		expect(isDelimitedTextPath("a/b.csv.bak")).toBe(false);
	});
});
