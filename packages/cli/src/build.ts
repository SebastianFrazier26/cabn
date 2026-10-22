import * as nodeFs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	CabnConfigError,
	convert,
	DirSource,
	type EmbedCheckNetwork,
	type EmbedFetch,
	type ExternalFinding,
	FindingsValidationError,
	type GitHistoryInput,
	type GithubFetch,
	type GithubNetwork,
	parseFindingsFile,
	ZipSource,
} from "@cabn/converter";
import {
	type CabnConfigInput,
	EMBED_INDEX_FILENAME,
	type FindingsSummary,
	GIT_META_FILENAME,
	MONSTER_INDEX_FILENAME,
	parseEmbedIndex,
	parseGitMeta,
	parseMonsterIndex,
	parseReleasesFile,
	RELEASES_FILENAME,
} from "@cabn/world-schema";

export interface BuildSummary {
	outDir: string;
	clusters: number;
	portals: number;
	bytes: number;
	elapsedMs: number;
	truncated: boolean;
	skippedFiles: number;
	/** world.json monsters plus monsters.json monsters. */
	monsters: number;
	/** Present only when --findings files were given. */
	findings?: FindingsSummary;
	/** Url previews whose site refuses to be framed (build-time check); empty when offline. */
	embedBlocked: { portalId: string; url: string; detail?: string }[];
	embedCheck: "network" | "offline";
	/** Present when the source was a git repository root and history was written. */
	history?: HistorySummary;
	/** Non-fatal notes from the converter (e.g. why history was skipped). */
	warnings: string[];
}

export interface HistorySummary {
	/** Commits in the shipped pack (all branches, deduplicated by the pack itself). */
	packBytes: number;
	objects: number;
	branches: number;
	tags: number;
	commitsPerBranch: number;
	halvings: number;
	notShipped: number;
	releases: string;
	releaseCount: number;
}

export interface BuildOptions {
	outDir?: string;
	/** World display name (meta.name, and the default output dir's prefix). Beats any cabn.json `world.title`; without it the title, else the input's basename, names the world. */
	name?: string;
	/**
	 * A cabn.json kept outside the source (`--config <path>`): either the
	 * path to that JSON file or the parsed object itself. Merged over the
	 * source's own cabn.json, the injected keys winning (see
	 * ConvertOptions.config).
	 */
	config?: string | CabnConfigInput;
	/** Read secret-pattern files (.env, *.pem, id_rsa*, ...) normally instead of metadata-only. Default false. */
	includeSecrets?: boolean;
	/** ESLint JSON or SARIF results files to turn into monsters (`--findings`, repeatable). */
	findingsPaths?: string[];
	/** Skip the build-time framability check for url previews and the GitHub releases request (no network requests at all). */
	offline?: boolean;
	/** false: no `git/` pack directory or releases.json even for a repository root, and no releases request (`--no-history`). */
	history?: boolean;
	/** Read history from this git directory instead of `<dir>/.git` (`--git-dir`). */
	gitDir?: string;
	/** Replaces the network fetch for GitHub releases — the demo's canned releases and tests use it; GITHUB_TOKEN is still only ever added by cliGithubNetwork. */
	githubFetch?: GithubFetch;
}

// cabn.json itself is never close to this; anything larger is the wrong file.
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

/** Reads `--config`: unreadable, oversized or non-JSON input fails the build naming the file; shape is checked by convert() after the merge. */
export async function loadConfigFile(path: string): Promise<CabnConfigInput> {
	const raw = await readFile(resolve(path));
	if (raw.byteLength > MAX_CONFIG_FILE_BYTES) {
		throw new CabnConfigError(
			`--config ${path} is over ${MAX_CONFIG_FILE_BYTES} bytes`,
		);
	}
	try {
		return JSON.parse(raw.toString("utf8")) as CabnConfigInput;
	} catch (err) {
		throw new CabnConfigError(
			`--config ${path} is not valid JSON: ${(err as Error).message}`,
		);
	}
}

// 50 MB: comfortably above a large monorepo's SARIF, well below anything that
// would make JSON.parse the slowest part of a build.
const MAX_FINDINGS_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Reads and validates each results file at the boundary: unreadable,
 * oversized, non-JSON, or schema-invalid input fails the build with the
 * file's name rather than silently producing a world without its monsters.
 */
export async function loadFindings(
	paths: readonly string[],
): Promise<ExternalFinding[]> {
	const all: ExternalFinding[] = [];
	for (const path of paths) {
		const raw = await readFile(resolve(path));
		if (raw.byteLength > MAX_FINDINGS_FILE_BYTES) {
			throw new Error(
				`findings file ${path} is over ${MAX_FINDINGS_FILE_BYTES} bytes`,
			);
		}
		let json: unknown;
		try {
			json = JSON.parse(raw.toString("utf8"));
		} catch (err) {
			throw new Error(
				`findings file ${path} is not valid JSON: ${(err as Error).message}`,
			);
		}
		try {
			all.push(...parseFindingsFile(json));
		} catch (err) {
			if (err instanceof FindingsValidationError) {
				throw new Error(`findings file ${path}: ${err.message}`);
			}
			throw err;
		}
	}
	return all;
}

/**
 * The CLI's opt-in to convert()'s network check: Node's own fetch, cast to
 * the structural shape the converter asks for. Only the CLI (a user running
 * cabn on their own project) does this — never apps/backend.
 */
export function cliEmbedNetwork(
	offline: boolean | undefined,
): EmbedCheckNetwork | undefined {
	if (offline) return undefined;
	return { fetch: globalThis.fetch as unknown as EmbedFetch };
}

/**
 * The CLI's opt-in to the build-time GitHub releases request: Node's fetch,
 * plus `Authorization: Bearer $GITHUB_TOKEN` when that env var is set. The
 * token lives only in this closure's request headers — convert() never sees
 * it, and nothing it returns is written into the bundle except the
 * zod-filtered release fields.
 */
export function cliGithubNetwork(
	offline: boolean | undefined,
	override?: GithubFetch,
): GithubNetwork | undefined {
	if (offline) return undefined;
	if (override) return { fetch: override };
	const token = process.env.GITHUB_TOKEN?.trim();
	const fetch: GithubFetch = async (url, init) => {
		const headers: Record<string, string> = { ...init.headers };
		if (token) headers.authorization = `Bearer ${token}`;
		const res = await globalThis.fetch(url, {
			headers,
			signal: init.signal,
			redirect: "error",
		});
		return res;
	};
	return { fetch, authenticated: Boolean(token) };
}

/** The `git` option for convert(): only for a directory source, never a zip. */
export function cliGitInput(
	dir: string,
	opts: Pick<BuildOptions, "history" | "gitDir" | "offline" | "githubFetch">,
): (GitHistoryInput & { github?: GithubNetwork }) | undefined {
	if (opts.history === false) return undefined;
	return {
		fs: nodeFs,
		dir,
		...(opts.gitDir ? { gitdir: resolve(opts.gitDir) } : {}),
		github: cliGithubNetwork(opts.offline, opts.githubFetch),
	};
}

export function historySummary(
	bundle: Map<string, Uint8Array | string>,
): HistorySummary | undefined {
	const raw = bundle.get(GIT_META_FILENAME);
	if (typeof raw !== "string") return undefined;
	const meta = parseGitMeta(JSON.parse(raw));
	if (!meta) return undefined;
	const rawReleases = bundle.get(RELEASES_FILENAME);
	const releases =
		typeof rawReleases === "string"
			? parseReleasesFile(JSON.parse(rawReleases))
			: null;
	return {
		packBytes: meta.pack.bytes,
		objects: meta.pack.objects,
		branches: meta.branches.length,
		tags: meta.tags.length,
		commitsPerBranch: meta.pack.commitsPerBranch,
		halvings: meta.pack.halvings,
		notShipped: Object.keys(meta.omitted).length,
		releases: releases?.source ?? "none",
		releaseCount: releases?.items.length ?? 0,
	};
}

/** Pulls blocked url previews out of a bundle's embeds.json for the CLI's summary line. */
export function embedSummary(bundle: Map<string, Uint8Array | string>): {
	mode: "network" | "offline";
	blocked: BuildSummary["embedBlocked"];
} {
	const raw = bundle.get(EMBED_INDEX_FILENAME);
	if (typeof raw !== "string") return { mode: "offline", blocked: [] };
	const json = JSON.parse(raw) as { mode?: string };
	const blocked: BuildSummary["embedBlocked"] = [];
	for (const [portalId, v] of parseEmbedIndex(json)) {
		if (!v.framable)
			blocked.push({
				portalId,
				url: v.url,
				...(v.detail !== undefined ? { detail: v.detail } : {}),
			});
	}
	return { mode: json.mode === "network" ? "network" : "offline", blocked };
}

export async function runBuild(
	inputPath: string,
	opts: BuildOptions = {},
): Promise<BuildSummary> {
	const start = performance.now();
	const resolvedInput = resolve(inputPath);
	const isZip = extname(resolvedInput).toLowerCase() === ".zip";
	const inputName = isZip
		? basename(resolvedInput, extname(resolvedInput))
		: basename(resolvedInput);
	const name = opts.name ?? inputName;
	const outDir = resolve(opts.outDir ?? `./${name}-world`);
	const config =
		typeof opts.config === "string"
			? await loadConfigFile(opts.config)
			: opts.config;

	const source = isZip
		? new ZipSource(await readFile(resolvedInput))
		: new DirSource(resolvedInput);
	const findings = opts.findingsPaths?.length
		? await loadFindings(opts.findingsPaths)
		: undefined;
	const warnings: string[] = [];
	const bundle = await convert(source, {
		name: inputName,
		...(opts.name !== undefined ? { nameOverride: opts.name } : {}),
		// world.json is published; an absolute path would leak the builder's
		// directory layout (home directory, user name) to every visitor.
		source: name,
		...(config ? { config } : {}),
		includeSecrets: opts.includeSecrets,
		findings,
		// Tools report paths relative to (or absolute under) the directory they
		// ran in, which for `cabn build <dir>` is that dir.
		findingsRoot: isZip ? undefined : resolvedInput,
		embedNetwork: cliEmbedNetwork(opts.offline),
		git: isZip ? undefined : cliGitInput(resolvedInput, opts),
		onWarning: (message) => warnings.push(message),
	});

	for (const [relPath, content] of bundle) {
		const dest = join(outDir, relPath);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, content);
	}

	const manifestRaw = bundle.get("world.json");
	if (typeof manifestRaw !== "string") {
		throw new Error("convert() did not produce a world.json entry");
	}
	const manifest = JSON.parse(manifestRaw) as {
		clusters: unknown[];
		portals: unknown[];
		monsters: unknown[];
		meta: { totalBytes: number; truncated: boolean; skippedFiles: number };
	};

	const indexRaw = bundle.get(MONSTER_INDEX_FILENAME);
	const indexJson: unknown =
		typeof indexRaw === "string" ? JSON.parse(indexRaw) : undefined;
	const extraMonsters = parseMonsterIndex(indexJson).length;
	const findingsSummary = (
		indexJson as { findings?: FindingsSummary } | undefined
	)?.findings;

	const embeds = embedSummary(bundle);
	const history = historySummary(bundle);
	return {
		outDir,
		clusters: manifest.clusters.length,
		portals: manifest.portals.length,
		bytes: manifest.meta.totalBytes,
		elapsedMs: Math.round(performance.now() - start),
		truncated: manifest.meta.truncated,
		skippedFiles: manifest.meta.skippedFiles,
		monsters: manifest.monsters.length + extraMonsters,
		...(findingsSummary ? { findings: findingsSummary } : {}),
		embedBlocked: embeds.blocked,
		embedCheck: embeds.mode,
		...(history ? { history } : {}),
		warnings,
	};
}
