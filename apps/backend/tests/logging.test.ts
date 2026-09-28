import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { makeApiKey, testConfig } from "./helpers/testConfig.js";

class CollectingStream extends Writable {
	lines: string[] = [];
	_write(chunk: Buffer, _enc: string, cb: () => void): void {
		this.lines.push(chunk.toString("utf8"));
		cb();
	}
}

describe("logger redaction", () => {
	test("a presented key never appears in logs, header or otherwise", async () => {
		const { plaintext, sha256Hex: hash } = makeApiKey();
		const stream = new CollectingStream();
		const app = buildApp(
			testConfig({ apiKeyHashes: [Buffer.from(hash, "hex")] }),
			{ loggerStream: stream },
		);

		await app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: { authorization: `Bearer ${plaintext}` },
		});
		await app.close();

		const output = stream.lines.join("\n");
		expect(output).not.toContain(plaintext);
		expect(output).not.toContain(`Bearer ${plaintext}`);
	});
});
