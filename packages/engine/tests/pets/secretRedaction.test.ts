import { describe, expect, it } from "vitest";
import {
	REDACTION_MARKER,
	redactSecrets,
	touchesRedactedSpan,
} from "../../src/pets/secretRedaction.js";
import {
	DEFAULT_TOOL_LIMITS,
	type PetWorldAccess,
	runPetTool,
	type ToolRunContext,
} from "../../src/pets/tools.js";

// Assembled at runtime, same convention as converter/test/annotate/leakedSecret.test.ts,
// so no key-shaped literal ever sits in this file's source.
const j = (...parts: string[]) => parts.join("");
const ANTHROPIC_A = j("sk-", "ant-", "AaBbCcDdEeFf00112233445566");
const ANTHROPIC_B = j("sk-", "ant-", "GgHhIiJjKkLl99887766554433");
const PEM_HEADER = j("-----BEGIN ", "RSA PRIVATE KEY-----");
const PEM_BODY_1 = j(
	"MIIEowIBAAKCAQEA7vq3Zk9Lp2Xw8Rt5Yb1Hn4Mc6Qd0Js3Fg7Ka2Ue9Ti8Wo1",
);
const PEM_BODY_2 = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdEfGh==";
const PEM_FOOTER = j("-----END ", "RSA PRIVATE KEY-----");

function contextFor(
	files: Record<string, string | null>,
	withheld: PetWorldAccess["withheld"] = () => null,
): ToolRunContext {
	const world: PetWorldAccess = {
		files: () =>
			Object.keys(files).map((path) => ({
				path,
				bytes: files[path]?.length ?? 0,
				kind: "code",
			})),
		readText: async (path) => files[path] ?? null,
		search: async () => [],
		withheld,
	};
	return {
		world,
		limits: DEFAULT_TOOL_LIMITS,
		cited: [],
		proposals: [],
		newProposalId: () => "p1",
	};
}

describe("redactSecrets", () => {
	it("redacts several secrets on one line, leaving the rest of the line intact", () => {
		const content = `first=${ANTHROPIC_A} second=${ANTHROPIC_B}\n`;
		const result = redactSecrets(content, "src/keys.ts");
		expect(result.count).toBe(2);
		expect(result.text).toBe(
			`first=${REDACTION_MARKER} second=${REDACTION_MARKER}\n`,
		);
		expect(result.text).not.toContain(ANTHROPIC_A);
		expect(result.text).not.toContain(ANTHROPIC_B);
	});

	it("redacts a secret sitting at the end of a line", () => {
		const content = `line one\ntoken=${ANTHROPIC_A}\nline three\n`;
		const result = redactSecrets(content, "src/keys.ts");
		expect(result.count).toBe(1);
		expect(result.text).toBe(
			`line one\ntoken=${REDACTION_MARKER}\nline three\n`,
		);
		expect(result.text.split("\n").length).toBe(content.split("\n").length);
	});

	it("redacts multiple secrets spread across several lines", () => {
		const content = [
			`const a = "${ANTHROPIC_A}";`,
			"const notASecret = 1;",
			`const b = "${ANTHROPIC_B}";`,
		].join("\n");
		const result = redactSecrets(content, "src/keys.ts");
		expect(result.count).toBe(2);
		expect(result.text).toBe(
			[
				`const a = "${REDACTION_MARKER}";`,
				"const notASecret = 1;",
				`const b = "${REDACTION_MARKER}";`,
			].join("\n"),
		);
	});

	it("extends a private-key span through its END line so the body isn't shipped unredacted, and keeps the line count", () => {
		const content = [
			PEM_HEADER,
			PEM_BODY_1,
			PEM_BODY_2,
			PEM_FOOTER,
			"after",
		].join("\n");
		const result = redactSecrets(content, "src/id_rsa.ts");
		expect(result.count).toBe(1); // one PEM block, one secret — not one marker per line
		expect(result.text).not.toContain(PEM_BODY_1);
		expect(result.text).not.toContain(PEM_BODY_2);
		expect(result.text.split("\n")).toEqual([
			REDACTION_MARKER,
			REDACTION_MARKER,
			REDACTION_MARKER,
			REDACTION_MARKER,
			"after",
		]);
	});

	it("leaves content with no detected secret untouched", () => {
		const content = "const port = 3000;\n";
		const result = redactSecrets(content, "src/server.ts");
		expect(result).toEqual({ text: content, count: 0, spans: [] });
	});
});

describe("touchesRedactedSpan", () => {
	const content = `keep this\nsecret=${ANTHROPIC_A}\nkeep this too\n`;
	const { spans } = redactSecrets(content, "src/keys.ts");

	it("is false for a range on an untouched line", () => {
		expect(touchesRedactedSpan(content, spans, 0, 4)).toBe(false);
	});

	it("is true for a range overlapping the secret's line", () => {
		const secretLineStart = content.indexOf("secret=");
		expect(
			touchesRedactedSpan(content, spans, secretLineStart, secretLineStart + 3),
		).toBe(true);
	});

	it("is false when there are no spans at all", () => {
		expect(touchesRedactedSpan(content, [], 0, 100)).toBe(false);
	});
});

describe("runPetTool — read_file redaction", () => {
	it("sends redacted content and tells the model how many secrets it swapped out", async () => {
		const content = `const key = "${ANTHROPIC_A}";\nconsole.log("hi");\n`;
		const ctx = contextFor({ "src/keys.ts": content });
		const result = await runPetTool(
			{ id: "1", name: "read_file", args: { path: "src/keys.ts" } },
			ctx,
		);
		expect(result.isError).toBe(false);
		expect(result.content).not.toContain(ANTHROPIC_A);
		expect(result.content).toContain(REDACTION_MARKER);
		const parsed = JSON.parse(result.content);
		expect(parsed.secrets_redacted).toBe(1);
		expect(parsed.content).toContain('console.log("hi")');
		expect(ctx.cited).toEqual(["src/keys.ts"]);
	});

	it("still fully withholds a file when withheld() says so and no secret is actually detected", async () => {
		const ctx = contextFor({ "src/notes.md": "just some notes\n" }, (path) =>
			path === "src/notes.md" ? "sealed for some other reason" : null,
		);
		const result = await runPetTool(
			{ id: "1", name: "read_file", args: { path: "src/notes.md" } },
			ctx,
		);
		expect(result.isError).toBe(true);
		expect(result.content).toBe("sealed for some other reason");
		expect(ctx.cited).toEqual([]);
	});

	it("sends a file through untouched once its only secret is gone (magpie defeated)", async () => {
		const ctx = contextFor({ "src/keys.ts": "console.log('hi');\n" });
		const result = await runPetTool(
			{ id: "1", name: "read_file", args: { path: "src/keys.ts" } },
			ctx,
		);
		expect(result.isError).toBe(false);
		const parsed = JSON.parse(result.content);
		expect(parsed.secrets_redacted).toBeUndefined();
		expect(parsed.content).toBe("console.log('hi');\n");
	});
});

describe("runPetTool — propose_edit safety around redacted lines", () => {
	it("rejects a proposal whose hunk touches the secret's line", async () => {
		const content = `const key = "${ANTHROPIC_A}";\nconsole.log("hi");\n`;
		const ctx = contextFor({ "src/keys.ts": content });
		const result = await runPetTool(
			{
				id: "1",
				name: "propose_edit",
				args: {
					path: "src/keys.ts",
					old_text: `const key = "${ANTHROPIC_A}";`,
					new_text: "const key = process.env.KEY;",
					summary: "Move the key to an env var",
				},
			},
			ctx,
		);
		expect(result.isError).toBe(true);
		expect(result.content).toContain("secret");
		expect(ctx.proposals).toEqual([]);
	});

	it("allows a proposal touching an unrelated line in the same guarded file", async () => {
		const content = `const key = "${ANTHROPIC_A}";\nconsole.log("hi");\n`;
		const ctx = contextFor({ "src/keys.ts": content });
		const result = await runPetTool(
			{
				id: "1",
				name: "propose_edit",
				args: {
					path: "src/keys.ts",
					old_text: `console.log("hi");`,
					new_text: `console.log("bye");`,
					summary: "Change the greeting",
				},
			},
			ctx,
		);
		expect(result.isError).toBe(false);
		expect(ctx.proposals).toHaveLength(1);
		// The real secret is preserved untouched in the stored before/after text —
		// a proposal never runs against the redacted view.
		expect(ctx.proposals[0]?.before).toBe(content);
		expect(ctx.proposals[0]?.after).toContain(ANTHROPIC_A);
		expect(ctx.proposals[0]?.after).toContain("bye");
	});

	it("a hunk built from the redacted view (containing the marker) simply doesn't match the real file", async () => {
		const content = `const key = "${ANTHROPIC_A}";\nconsole.log("hi");\n`;
		const ctx = contextFor({ "src/keys.ts": content });
		const result = await runPetTool(
			{
				id: "1",
				name: "propose_edit",
				args: {
					path: "src/keys.ts",
					old_text: `const key = "${REDACTION_MARKER}";`,
					new_text: "const key = process.env.KEY;",
					summary: "Move the key to an env var",
				},
			},
			ctx,
		);
		expect(result.isError).toBe(true);
		expect(result.content).toContain("not found");
		expect(ctx.proposals).toEqual([]);
	});
});
