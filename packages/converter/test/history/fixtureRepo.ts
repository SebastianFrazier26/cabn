import * as fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as git from "isomorphic-git";

/** Built at runtime so no credential-shaped literal sits in this repo's own source. */
export const FAKE_AWS_KEY = ["AKIA", "Q7N2XK4PLM9RT3VW"].join("");
export const FAKE_ANTHROPIC_KEY = [
	"sk-ant-",
	"api03-",
	"Zq8vN3mB6xR1tK9pW4sL7hJ2dF5gC0aY",
].join("");
export const ENV_SECRET_VALUE = "hunter2-env-value-9f8e7d";
export const AUTHOR_EMAIL = "wren@hollow.example";

export interface FixtureRepo {
	dir: string;
	cleanup(): Promise<void>;
	commit(
		files: Record<string, string | null>,
		message: string,
		day: number,
	): Promise<string>;
	branch(name: string, checkout?: boolean): Promise<void>;
	checkout(name: string): Promise<void>;
	tag(name: string, message?: string): Promise<void>;
}

const BASE_TIME = Date.UTC(2026, 5, 1, 9, 0, 0) / 1000;

export async function createFixtureRepo(): Promise<FixtureRepo> {
	const dir = await mkdtemp(join(tmpdir(), "cabn-git-fixture-"));
	await git.init({ fs, dir, defaultBranch: "main" });
	const author = (day: number) => ({
		name: "Wren Hollow",
		email: AUTHOR_EMAIL,
		timestamp: BASE_TIME + day * 86400,
		timezoneOffset: 0,
	});
	let lastDay = 0;
	return {
		dir,
		cleanup: () => rm(dir, { recursive: true, force: true }),
		async commit(files, message, day) {
			lastDay = day;
			for (const [path, content] of Object.entries(files)) {
				const full = join(dir, path);
				if (content === null) {
					await rm(full, { force: true });
					await git.remove({ fs, dir, filepath: path });
				} else {
					await mkdir(dirname(full), { recursive: true });
					await writeFile(full, content);
					await git.add({ fs, dir, filepath: path });
				}
			}
			return git.commit({
				fs,
				dir,
				message,
				author: author(day),
				committer: author(day),
			});
		},
		async branch(name, checkout = false) {
			await git.branch({ fs, dir, ref: name, checkout });
		},
		async checkout(name) {
			await git.checkout({ fs, dir, ref: name });
		},
		async tag(name, message) {
			if (message) {
				await git.annotatedTag({
					fs,
					dir,
					ref: name,
					message,
					tagger: author(lastDay),
				});
			} else {
				await git.tag({ fs, dir, ref: name });
			}
		},
	};
}

/** The standard history most tests read: secrets that come and go, an ignored dir, a feature branch and two tags. */
export async function createStandardFixture(): Promise<FixtureRepo> {
	const repo = await createFixtureRepo();
	await repo.commit(
		{
			"README.md": "# Lantern Garden\n\nA tiny garden.\n",
			"src/app.js": "export function grow() {\n\treturn 1;\n}\n",
			".env": `API_TOKEN=${ENV_SECRET_VALUE}\n`,
		},
		"Plant the garden",
		0,
	);
	await repo.tag("v0.1.0");
	await repo.commit(
		{
			"src/app.js":
				"export function grow() {\n\treturn 2;\n}\n\nexport function water() {\n\treturn true;\n}\n",
			"src/config.js": `export const awsKey = "${FAKE_AWS_KEY}";\n`,
		},
		"Water the seedlings",
		1,
	);
	await repo.tag("v0.2.0", "Second harvest");
	await repo.commit(
		{
			"src/config.js": "export const awsKey = process.env.AWS_KEY;\n",
			".env": null,
		},
		`Rotate keys (was ${FAKE_ANTHROPIC_KEY})`,
		2,
	);
	await repo.commit(
		{
			"node_modules/dep/index.js": "module.exports = 1;\n",
			"notes.md": "# Notes\n\n- water daily\n",
		},
		"Add notes",
		3,
	);
	await repo.branch("feature/lanterns", true);
	await repo.commit(
		{
			"lanterns.md": "# Lanterns\n\nHang them at dusk.\n",
			"README.md": "# Lantern Garden\n\nA tiny garden with lanterns.\n",
			"src/secret.js": `export const k = "${FAKE_AWS_KEY}";\n`,
		},
		"Hang lanterns",
		4,
	);
	await repo.checkout("main");
	return repo;
}
