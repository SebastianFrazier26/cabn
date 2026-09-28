import { describe, expect, test } from "vitest";
import { leakedSecret } from "../../src/annotate/leakedSecret.js";
import { runOn } from "./helpers.js";

// Every secret-shaped literal in this file is assembled at runtime, so the
// source itself never contains a string a secret scanner (or GitHub push
// protection) would match — only the joined value exists, in memory.
const j = (...parts: string[]) => parts.join("");
const run = (path: string, content: string) =>
	runOn(leakedSecret, path, content);

const AWS = j("AK", "IA", "Q7ZP4M2KX9TRB3LW");
const GITHUB = j("gh", "p_", "rT8kWq2Zp9LmXv4Bn6Yc1Hd3Fg5Js7Ka0Ue2Ti");
const ANTHROPIC = j("sk-", "ant-", "demo-cabnFakeKeyForTheMagpie42");
const OPENAI = j("sk-", "proj-", "Zq8Wn3Lk5Rt7Yp2Hs4Vb6Mc9");
const SLACK = j("xo", "xb-", "2Rt83kLm29Qw-7yHn4Zp");
const PEM = j(
	"-----BEGIN ",
	"RSA PRIVATE KEY-----\n",
	"MIIEowIBAAKCAQEA7vq3Zk9Lp2Xw8Rt5Yb1Hn4Mc6Qd0Js3Fg7Ka2Ue9Ti8Wo1\n",
);
const DB_URL = j(
	"postgres",
	"://garden:",
	"Tr0ub4dor-3xyz",
	"@db.internal:5432/app",
);

describe("leakedSecret (magpie)", () => {
	test.each([
		["aws-access-key", `aws_key = "${AWS}"\n`, "AKIA…"],
		["github-token", `const t = "${GITHUB}";\n`, "ghp_…"],
		["anthropic-key", `ANTHROPIC_API_KEY = "${ANTHROPIC}"\n`, "sk-ant-…"],
		["openai-key", `client = OpenAI(api_key="${OPENAI}")\n`, "sk-…"],
		["slack-token", `const slack = '${SLACK}';\n`, "xoxb-…"],
	])(
		"flags a %s and redacts it to prefix + length",
		(kind, content, prefix) => {
			const results = run("src/config.py", content);
			expect(results).toHaveLength(1);
			const [r] = results;
			expect(r).toMatchObject({
				code: "LeakedSecret",
				species: "magpie",
				tier: 3,
			});
			expect(r?.rule).toMatch(new RegExp(`^secret:${kind}:[0-9a-f]{8}$`));
			expect(r?.message).toContain(prefix);
			expect(r?.message).toMatch(/\d+ chars/);
		},
	);

	test("never puts the secret value into the message or rule", () => {
		const secrets = [AWS, GITHUB, ANTHROPIC, OPENAI, SLACK, "Tr0ub4dor-3xyz"];
		const content = [
			`a = "${AWS}"`,
			`b = "${GITHUB}"`,
			`c = "${ANTHROPIC}"`,
			`d = "${OPENAI}"`,
			`e = "${SLACK}"`,
			`DATABASE_URL = "${DB_URL}"`,
		].join("\n");
		const results = run("settings.py", content);
		expect(results.length).toBe(5); // per-file cap
		for (const r of results) {
			for (const s of secrets) {
				expect(r.message).not.toContain(s);
				expect(r.message).not.toContain(s.slice(8));
				expect(r.rule).not.toContain(s.slice(8));
			}
		}
	});

	test("flags a PEM private key block only when key material follows", () => {
		const hit = run("deploy/key.ts", `export const key = \`${PEM}\`;\n`);
		expect(hit).toHaveLength(1);
		expect(hit[0]?.message).toContain("RSA private key block");

		const detector = j(
			"const HEADER = /-----BEGIN ",
			"(RSA )?PRIVATE KEY-----/;\n",
		);
		expect(run("scan.ts", detector)).toEqual([]);
		const doc = j(
			"Paste the block that starts with -----BEGIN ",
			"PRIVATE KEY----- here.\n",
		);
		expect(run("README.md", doc)).toEqual([]);
	});

	test("flags a connection string with an inline password, not one with a placeholder or env var", () => {
		expect(run("db.ts", `const url = "${DB_URL}";\n`)).toHaveLength(1);
		for (const safe of [
			j("postgres", "://user:password@localhost/db"),
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
			j("postgres", "://user:${DB_PASSWORD}@localhost/db"),
			j("mongodb", "+srv://admin:<password>@cluster0.example.net"),
			j("redis", "://:changeme@cache:6379"),
			"https://user:Tr0ub4dor-3xyz@example.org/repo.git",
		]) {
			expect(run("db.ts", `const url = "${safe}";\n`)).toEqual([]);
		}
	});

	test("generic secret-ish assignment needs a high-entropy value", () => {
		expect(
			run(
				"app.ts",
				j("const clientSecret = ", '"Qm9vZ2llV29vZ2llMTIz4f!x";\n'),
			),
		).toHaveLength(1);
		expect(run("app.py", j("DB_PASSWORD = ", "'h7#Kp2$wLq9z'\n"))).toHaveLength(
			1,
		);
		for (const benign of [
			'const tokenType = "bearer_token";\n',
			'const passwordField = "input#password";\n',
			'const token = "abcdefghijkl";\n',
			'PASSWORD_URL = "https://example.org/reset/9f8e7d"\n',
			'const apiKeyHeader = "X-Api-Key-Header-Name";\n',
			'password = os.environ["DB_PASSWORD_VALUE_1"]\n',
		]) {
			expect(run("app.ts", benign)).toEqual([]);
		}
	});

	test.each([
		`AWS_ACCESS_KEY_ID=${j("AK", "IA", "IOSFODNN7EXAMPLE")}`,
		`OPENAI_API_KEY=${j("sk-", "your-key-here-0000000000000")}`,
		`ANTHROPIC_API_KEY=${j("sk-", "ant-", "xxxxxxxxxxxxxxxxxxxxxxxx")}`,
		`GITHUB_TOKEN=${j("gh", "p_", "000000000000000000000000000000000000")}`,
		`ANTHROPIC_API_KEY=${j("sk-", "ant-", "REPLACE_WITH_YOUR_KEY_123")}`,
		`API_KEY="${j("sk-", "ant-", "aaaaaaaaaaaaaaaaaaaaaaaa")}"`,
	])("skips placeholder value %s", (line) => {
		expect(run(".env.example", `${line}\n`)).toEqual([]);
		expect(run("src/config.ts", `const x = "${line}";\n`)).toEqual([]);
	});

	test("generic assignments are ignored in tests and example files; provider keys are not", () => {
		const generic = j("const password = ", '"h7#Kp2$wLq9z";\n');
		expect(run("tests/login.test.ts", generic)).toEqual([]);
		expect(run("config.sample.ts", generic)).toEqual([]);
		expect(run("tests/login.test.ts", `const k = "${AWS}";\n`)).toHaveLength(1);
	});

	test("an Anthropic key is reported once, not also as an OpenAI key", () => {
		const results = run("a.ts", `const k = "${ANTHROPIC}";\n`);
		expect(results).toHaveLength(1);
		expect(results[0]?.rule).toMatch(/^secret:anthropic-key:/);
	});

	test("rules stay unique when the same line repeats", () => {
		const results = run("a.ts", `const a = "${AWS}";\nconst a = "${AWS}";\n`);
		expect(results.map((r) => r.rule)).toEqual([
			expect.stringMatching(/^secret:aws-access-key:[0-9a-f]{8}$/),
			expect.stringMatching(/^secret:aws-access-key:[0-9a-f]{8}#2$/),
		]);
	});
});
