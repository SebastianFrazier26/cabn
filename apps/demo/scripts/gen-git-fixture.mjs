#!/usr/bin/env node
// Builds a throwaway git object store whose history ends at exactly the
// files in sample-project/, so the demo world has branches, tags, releases
// and file history to show without this repo ever containing a nested .git.
// Called by build-world.mjs on every sample build, into a fresh temp dir it
// deletes afterwards. Everything is deterministic (fixed author, fixed
// dates, content derived from the committed sample files), so the commit
// ids — and therefore the built world — are the same on every machine.
//
// Objects are written directly (writeBlob/writeTree/writeCommit), never
// through a work tree: the work tree is sample-project/ itself, and its
// files must stay exactly as committed in this repo.
import * as fs from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import * as git from "isomorphic-git";

const encoder = new TextEncoder();
const DAY = 86400;
const START = Date.UTC(2026, 5, 1, 9, 0, 0) / 1000;
const AUTHORS = [
	{ name: "Wren Hollow", email: "wren@lantern-garden.example" },
	{ name: "Bramble Finch", email: "bramble@lantern-garden.example" },
];

/** The canned GitHub API the demo build uses instead of the network — see build-world.mjs. */
export const DEMO_GITHUB_REMOTE =
	"https://github.com/cabn-demo/lantern-garden.git";
export function demoGithubFetch(url) {
	const releases = [
		{
			tag_name: "v1.0.0",
			name: "Full bloom",
			body: [
				"## What's new",
				"",
				"- **Forecasts** for every bed (`lib/forecast.py`)",
				"- Harvest routes and a tidier README",
				"- The weather key now comes from the environment — see the *Rotate* commit",
				"",
				"Thanks to everyone who pulled weeds. Notes: https://github.com/cabn-demo/lantern-garden",
			].join("\n"),
			draft: false,
			prerelease: false,
			published_at: "2026-06-08T12:00:00Z",
			html_url:
				"https://github.com/cabn-demo/lantern-garden/releases/tag/v1.0.0",
			assets: [
				{
					name: "lantern-garden-1.0.0.zip",
					size: 48213,
					download_count: 12,
					browser_download_url:
						"https://github.com/cabn-demo/lantern-garden/releases/download/v1.0.0/lantern-garden-1.0.0.zip",
				},
			],
		},
		{
			tag_name: "v0.2.0",
			name: "Seedlings",
			body: "First tests and scripts. <script>alert('stays text')</script>",
			draft: false,
			prerelease: true,
			published_at: "2026-06-05T12:00:00Z",
			html_url:
				"https://github.com/cabn-demo/lantern-garden/releases/tag/v0.2.0",
			assets: [],
		},
	];
	const body = url.includes("/releases") ? releases : [];
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	});
}

async function readTree(dir) {
	const files = new Map();
	async function visit(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) await visit(full);
			else if (entry.isFile())
				files.set(
					relative(dir, full).split(sep).join("/"),
					await readFile(full),
				);
		}
	}
	await visit(dir);
	return files;
}

function headLines(buf, fraction) {
	const lines = new TextDecoder().decode(buf).split("\n");
	return encoder.encode(
		`${lines.slice(0, Math.max(1, Math.floor(lines.length * fraction))).join("\n")}\n`,
	);
}

function appendText(buf, extra) {
	return encoder.encode(`${new TextDecoder().decode(buf)}${extra}`);
}

// A key-shaped value assembled at runtime so this repo's own source never
// contains one; the converter must withhold every diff that shows it.
const FAKE_WEATHER_KEY = ["AKIA", "LG7Q2WN4XK9PR3TV"].join("");

async function writeFiles(gitdir, files) {
	const root = { dirs: new Map(), blobs: [] };
	for (const [path, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const parts = path.split("/");
		let node = root;
		for (const dir of parts.slice(0, -1)) {
			if (!node.dirs.has(dir))
				node.dirs.set(dir, { dirs: new Map(), blobs: [] });
			node = node.dirs.get(dir);
		}
		const oid = await git.writeBlob({ fs, gitdir, blob: bytes });
		node.blobs.push({
			mode: "100644",
			path: parts[parts.length - 1],
			oid,
			type: "blob",
		});
	}
	async function write(node) {
		const entries = [...node.blobs];
		for (const [name, child] of node.dirs)
			entries.push({
				mode: "040000",
				path: name,
				oid: await write(child),
				type: "tree",
			});
		return git.writeTree({ fs, gitdir, tree: entries });
	}
	return write(root);
}

/**
 * @param {string} sampleDir absolute path of apps/demo/sample-project
 * @returns {Promise<{ gitdir: string, cleanup: () => Promise<void> }>}
 */
export async function createSampleHistory(sampleDir) {
	const gitdir = await mkdtemp(join(tmpdir(), "cabn-demo-history-"));
	await git.init({ fs, gitdir, bare: true, defaultBranch: "main" });
	await git.addRemote({
		fs,
		gitdir,
		remote: "origin",
		url: DEMO_GITHUB_REMOTE,
	});
	const final = await readTree(sampleDir);
	const pick = (prefixes) =>
		new Map(
			[...final].filter(([p]) => prefixes.some((pre) => p.startsWith(pre))),
		);

	let day = 0;
	async function commit(files, message, parents, authorIndex = 0) {
		const tree = await writeFiles(gitdir, files);
		const who = AUTHORS[authorIndex % AUTHORS.length];
		const stamp = { ...who, timestamp: START + day * DAY, timezoneOffset: 0 };
		day++;
		return git.writeCommit({
			fs,
			gitdir,
			commit: {
				message: `${message}\n`,
				tree,
				parent: parents,
				author: stamp,
				committer: stamp,
			},
		});
	}
	async function tag(name, oid, message) {
		if (!message) {
			await git.writeRef({ fs, gitdir, ref: `refs/tags/${name}`, value: oid });
			return;
		}
		const tagger = {
			...AUTHORS[0],
			timestamp: START + day * DAY,
			timezoneOffset: 0,
		};
		const tagOid = await git.writeTag({
			fs,
			gitdir,
			tag: {
				object: oid,
				type: "commit",
				tag: name,
				tagger,
				message: `${message}\n`,
			},
		});
		await git.writeRef({ fs, gitdir, ref: `refs/tags/${name}`, value: tagOid });
	}

	const s1 = pick([
		"src/",
		"lib/",
		"config/",
		"package.json",
		"pyproject.toml",
		".gitignore",
		"cabn.json",
		"assets/",
	]);
	s1.delete("src/routes/harvest.ts");
	s1.delete("src/plantNamer.ts");
	s1.set(
		"README.md",
		appendText(
			headLines(final.get("README.md"), 0.3),
			"\n## TODO\n\n- write the rest of this README\n",
		),
	);
	s1.set("lib/forecast.py", headLines(final.get("lib/forecast.py"), 0.5));
	s1.set("src/server.ts", headLines(final.get("src/server.ts"), 0.6));
	s1.set(
		".env",
		encoder.encode("WEATHER_TOKEN=demo-env-value-never-shipped\n"),
	);
	s1.set(
		"notes/old-plan.md",
		encoder.encode("# Old plan\n\n- raised beds\n- a pond, maybe\n"),
	);
	const c1 = await commit(s1, "Plant the garden: first seeds", []);

	const s2 = new Map([...s1, ...pick(["docs/", "media/", "data/"])]);
	const c2 = await commit(s2, "Add docs, media and the legacy notes", [c1], 1);
	await tag("v0.1.0", c2, "First bloom");

	const s3 = new Map(s2);
	s3.set(
		"src/weather.ts",
		encoder.encode(`export const weatherKey = "${FAKE_WEATHER_KEY}";\n`),
	);
	s3.set("src/routes/harvest.ts", final.get("src/routes/harvest.ts"));
	const c3 = await commit(
		s3,
		"Hard-code the weather key (oops) and add harvest routes",
		[c2],
	);

	const s4 = new Map(s3);
	s4.set(
		"src/weather.ts",
		encoder.encode(
			'export const weatherKey = process.env.WEATHER_KEY ?? "";\n',
		),
	);
	s4.delete(".env");
	s4.set("lib/forecast.py", final.get("lib/forecast.py"));
	const c4 = await commit(
		s4,
		"Rotate the weather key and finish forecasts",
		[c3],
		1,
	);

	const s5 = new Map([...s4, ...pick(["tests/", "scripts/"])]);
	s5.delete("notes/old-plan.md");
	s5.set("src/plantNamer.ts", final.get("src/plantNamer.ts"));
	const c5 = await commit(s5, "Tests, the seed script and a plant namer", [c4]);
	await tag("v0.2.0", c5);

	const s6 = new Map(s5);
	s6.set("README.md", final.get("README.md"));
	s6.set("src/server.ts", final.get("src/server.ts"));
	s6.delete("src/weather.ts");
	const c6 = await commit(
		s6,
		"Polish the README and wire up the server",
		[c5],
		1,
	);

	// Whatever else differs from sample-project today lands here, so HEAD is exactly the demo's files.
	const c7 = await commit(final, "Full bloom", [c6]);
	await tag("v1.0.0", c7, "Full bloom — the demo garden as it ships");

	const festival = new Map(s5);
	festival.set(
		"docs/lantern-festival.md",
		encoder.encode(
			"# Lantern festival\n\nOn the longest night the gardeners hang a lantern over every bed.\n\n- paper lanterns over the herbs\n- jars of fireflies by the pond\n",
		),
	);
	festival.set(
		"README.md",
		appendText(
			s5.get("README.md"),
			"\n## Lantern festival\n\nSee `docs/lantern-festival.md`.\n",
		),
	);
	festival.set(
		"src/index.ts",
		appendText(
			final.get("src/index.ts"),
			'\nexport const festival = "lanterns";\n',
		),
	);
	const f1 = await commit(festival, "Plan the lantern festival", [c5], 1);

	const moon = new Map(s4);
	moon.delete("docs/code-host.md");
	moon.set(
		"docs/moon-phases.md",
		encoder.encode("# Moon phases\n\nPlant leafy greens on a waxing moon.\n"),
	);
	moon.set(
		"lib/utils.py",
		appendText(
			final.get("lib/utils.py"),
			"\n\ndef moon_phase(day):\n    return (day % 29) / 29\n",
		),
	);
	const m1 = await commit(moon, "Try planting by the moon", [c4]);

	await git.writeRef({
		fs,
		gitdir,
		ref: "refs/heads/main",
		value: c7,
		force: true,
	});
	await git.writeRef({
		fs,
		gitdir,
		ref: "refs/heads/feature/lantern-festival",
		value: f1,
	});
	await git.writeRef({
		fs,
		gitdir,
		ref: "refs/heads/experiment/moonlit-garden",
		value: m1,
	});

	return {
		gitdir,
		cleanup: () => rm(gitdir, { recursive: true, force: true }),
	};
}
