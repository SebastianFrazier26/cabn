import { describe, expect, test } from "vitest";
import {
	classify,
	sniffBinary,
	sniffShebangLanguage,
} from "../src/classify.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("classify", () => {
	test("classifies by extension", () => {
		expect(classify("src/index.ts", utf8("export {}")).kind).toBe("code");
		expect(classify("src/index.ts", utf8("export {}")).language).toBe(
			"typescript",
		);
		expect(classify("README.md", utf8("# hi")).kind).toBe("markdown");
		expect(classify("data.csv", utf8("a,b")).kind).toBe("data");
		expect(classify("config.yaml", utf8("a: 1")).kind).toBe("config");
	});

	test("images and known binary extensions are always binary", () => {
		expect(classify("icon.png", utf8("not really png"))).toMatchObject({
			kind: "image",
			binary: true,
		});
		expect(classify("archive.zip", utf8("pk"))).toMatchObject({
			kind: "binary",
			binary: true,
		});
	});

	test("shebang sniff classifies extensionless scripts", () => {
		const script = utf8("#!/usr/bin/env python3\nprint('hi')\n");
		expect(classify("bin/run", script)).toMatchObject({
			kind: "code",
			language: "python",
		});
	});

	test("null-byte content overrides a text extension", () => {
		const corrupted = new Uint8Array([...utf8("some text"), 0, 1, 2]);
		expect(classify("notes.txt", corrupted)).toMatchObject({
			kind: "binary",
			binary: true,
		});
	});

	test("dotfiles classify by their post-dot name, e.g. .env", () => {
		expect(classify(".env", utf8("KEY=1"))).toMatchObject({ kind: "config" });
	});

	test("unrecognized extension with no shebang and no null bytes is unknown", () => {
		expect(classify("mystery.xyz", utf8("plain text"))).toMatchObject({
			kind: "unknown",
			binary: false,
		});
	});

	test("without content, known extensions still classify (metadata-only path)", () => {
		expect(classify("src/index.ts")).toMatchObject({
			kind: "code",
			binary: false,
		});
		expect(classify("icon.png")).toMatchObject({ kind: "image", binary: true });
		expect(classify("mystery.xyz")).toMatchObject({
			kind: "unknown",
			binary: false,
		});
	});
});

describe("sniffBinary", () => {
	test("detects a null byte within the first 8KB", () => {
		expect(sniffBinary(new Uint8Array([1, 2, 0, 3]))).toBe(true);
		expect(sniffBinary(utf8("no null bytes here"))).toBe(false);
	});

	test("ignores null bytes beyond the sniff window", () => {
		const bytes = new Uint8Array(9000);
		bytes.fill(65); // 'A'
		bytes[8500] = 0;
		expect(sniffBinary(bytes)).toBe(false);
	});
});

describe("sniffShebangLanguage", () => {
	test("maps common interpreters", () => {
		expect(sniffShebangLanguage(utf8("#!/bin/bash\necho hi\n"))).toBe("shell");
		expect(sniffShebangLanguage(utf8("#!/usr/bin/env node\n"))).toBe(
			"javascript",
		);
	});

	test("returns undefined without a shebang", () => {
		expect(sniffShebangLanguage(utf8("plain text"))).toBeUndefined();
	});
});
