import * as nodeFs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { relative, sep } from "node:path";
import { DEFAULT_MAX_FILE_BYTES, openGitRepo } from "@cabn/converter";
import {
	add,
	branch,
	checkout,
	commit,
	currentBranch,
	getConfig,
	listBranches,
	statusMatrix,
} from "isomorphic-git";
import { z } from "zod";
import {
	checkOwnerRequest,
	type OwnerSession,
	readOwnerJson,
	sendOwnerJson,
} from "./ownerAuth.js";
import { PathConfinementError, resolveConfinedPath } from "./security.js";

/**
 * The owner's git writes, run by isomorphic-git inside this Node process on
 * the real repository: commit in-game edits, create a branch, switch
 * branches. Nothing here talks to a remote — no push, fetch, pull or clone
 * is imported, and no isomorphic-git http client exists in this package.
 */
export const OWNER_GIT_ROUTES = {
	status: "/owner/git/status",
	commit: "/owner/git/commit",
	branch: "/owner/git/branch",
	checkout: "/owner/git/checkout",
} as const;

export interface OwnerGitContext {
	dir: string;
	gitdir?: string;
	port(): number;
	session: OwnerSession;
	/** World path -> the text the current world was converted from (text portals only). */
	worldText(): ReadonlyMap<string, string>;
	/** Re-converts the served world after a write, so the page reloads into it. */
	reconvert(): Promise<void>;
}

// Case-insensitive: macOS and Windows file systems treat ".GIT" as ".git".
function hasGitSegment(path: string): boolean {
	return path.split("/").some((s) => s.toLowerCase() === ".git");
}

const WorldPathSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine(
		(p) =>
			!p.startsWith("/") &&
			!p.includes("\\") &&
			!p.includes("\0") &&
			p.split("/").every((s) => s.length > 0 && s !== "." && s !== "..") &&
			!hasGitSegment(p),
		"must be a relative world path outside .git",
	);

// Conservative subset of git-check-ref-format: enough for real branch names,
// nothing that could be read as an option, a revision expression or a path escape.
export const BranchNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9._/-]+$/, "letters, digits, . _ / - only")
	.refine(
		(n) =>
			!n.startsWith("-") &&
			!n.startsWith("/") &&
			!n.endsWith("/") &&
			!n.endsWith(".") &&
			!n.includes("..") &&
			!n.includes("//") &&
			!n.split("/").some((s) => s.startsWith(".") || s.endsWith(".lock")) &&
			n !== "HEAD",
		"not a valid branch name",
	);

const AuthorSchema = z.object({
	name: z.string().trim().min(1).max(100),
	email: z
		.string()
		.trim()
		.min(3)
		.max(200)
		.regex(/^[^\s<>]+@[^\s<>]+$/, "not an email address"),
});

export const CommitBodySchema = z.strictObject({
	message: z.string().trim().min(1).max(2000),
	author: AuthorSchema.optional(),
	files: z
		.array(
			z.strictObject({
				path: WorldPathSchema,
				content: z.string().max(DEFAULT_MAX_FILE_BYTES),
			}),
		)
		.min(1)
		.max(100),
});

export const BranchBodySchema = z.strictObject({
	name: BranchNameSchema,
	checkout: z.boolean().optional(),
});

export const CheckoutBodySchema = z.strictObject({ branch: BranchNameSchema });

class OwnerGitError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
	}
}

async function repoFor(ctx: OwnerGitContext) {
	const opened = await openGitRepo({
		fs: nodeFs,
		dir: ctx.dir,
		...(ctx.gitdir ? { gitdir: ctx.gitdir } : {}),
	});
	if (!opened.ok)
		throw new OwnerGitError(409, `no usable git repository: ${opened.reason}`);
	return { fs: nodeFs, dir: opened.repo.root, gitdir: opened.repo.gitdir };
}

type Repo = Awaited<ReturnType<typeof repoFor>>;

async function configuredAuthor(
	repo: Repo,
): Promise<{ name: string; email: string } | null> {
	const name = await getConfig({ ...repo, path: "user.name" }).catch(
		() => undefined,
	);
	const email = await getConfig({ ...repo, path: "user.email" }).catch(
		() => undefined,
	);
	return typeof name === "string" && name && typeof email === "string" && email
		? { name, email }
		: null;
}

/** Staged or unstaged changes to tracked files, and anything staged at all. */
async function workingTreeState(repo: Repo) {
	const rows = await statusMatrix({ ...repo });
	const dirty: string[] = [];
	const staged: string[] = [];
	// statusMatrix: head 0/1 absent/present; workdir 1 = same as HEAD; stage 1 = same as HEAD, 0 = absent.
	for (const [file, head, workdir, stage] of rows) {
		const tracked = head === 1;
		const isStaged = tracked ? stage !== 1 : stage !== 0;
		if (isStaged) staged.push(file);
		if (isStaged || (tracked && workdir !== 1)) dirty.push(file);
	}
	return { dirty, staged };
}

async function status(ctx: OwnerGitContext) {
	const repo = await repoFor(ctx);
	const state = await workingTreeState(repo);
	return {
		branch: (await currentBranch({ ...repo, fullname: false })) || null,
		branches: await listBranches({ ...repo }),
		author: await configuredAuthor(repo),
		dirtyFiles: state.dirty.slice(0, 50),
		dirtyCount: state.dirty.length,
	};
}

/**
 * Resolves a world path to the real file it names, refusing anything a
 * world file couldn't be: outside the served directory (traversal or a
 * symlink hop anywhere on the way), inside the git directory, or not a
 * regular text file the world was converted from.
 */
async function confinedWorldFile(
	ctx: OwnerGitContext,
	repo: Repo,
	path: string,
): Promise<string> {
	if (!ctx.worldText().has(path))
		throw new OwnerGitError(403, `"${path}" is not a text file in this world`);
	let real: string;
	try {
		real = await resolveConfinedPath(ctx.dir, path);
	} catch (err) {
		if (err instanceof PathConfinementError)
			throw new OwnerGitError(403, `"${path}" is outside the world`);
		throw err;
	}
	const realRoot = await nodeFs.promises.realpath(ctx.dir);
	const rel = relative(realRoot, real).split(sep).join("/");
	if (rel !== path)
		throw new OwnerGitError(403, `"${path}" is reached through a symlink`);
	const realGitdir = await nodeFs.promises
		.realpath(repo.gitdir)
		.catch(() => repo.gitdir);
	if (real === realGitdir || real.startsWith(`${realGitdir}${sep}`))
		throw new OwnerGitError(403, `"${path}" is inside the git directory`);
	const stat = await nodeFs.promises.lstat(real);
	if (!stat.isFile())
		throw new OwnerGitError(403, `"${path}" is not a regular file`);
	return real;
}

async function commitEdits(
	ctx: OwnerGitContext,
	body: z.infer<typeof CommitBodySchema>,
) {
	const repo = await repoFor(ctx);
	const author = body.author ?? (await configuredAuthor(repo));
	if (!author)
		throw new OwnerGitError(
			409,
			"this repository has no user.name/user.email; enter them to commit",
			{ needsAuthor: true },
		);
	const paths = new Set(body.files.map((f) => f.path));
	if (paths.size !== body.files.length)
		throw new OwnerGitError(400, "each file may appear once");
	const { staged } = await workingTreeState(repo);
	const otherStaged = staged.filter((f) => !paths.has(f));
	if (otherStaged.length > 0)
		throw new OwnerGitError(
			409,
			`other changes are already staged (${otherStaged.slice(0, 5).join(", ")}); commit or unstage them in a terminal first`,
		);
	const targets: { real: string; path: string; content: string }[] = [];
	for (const file of body.files) {
		const real = await confinedWorldFile(ctx, repo, file.path);
		const onDisk = await readFile(real, "utf8");
		if (onDisk !== ctx.worldText().get(file.path))
			throw new OwnerGitError(
				409,
				`"${file.path}" changed on disk since cabn serve converted it; reload to pick up the new version`,
			);
		targets.push({ real, path: file.path, content: file.content });
	}
	for (const t of targets) await writeFile(t.real, t.content, "utf8");
	for (const t of targets) await add({ ...repo, filepath: t.path });
	const oid = await commit({ ...repo, message: body.message, author });
	return { oid, files: targets.map((t) => t.path) };
}

async function createBranch(
	ctx: OwnerGitContext,
	body: z.infer<typeof BranchBodySchema>,
) {
	const repo = await repoFor(ctx);
	if ((await listBranches({ ...repo })).includes(body.name))
		throw new OwnerGitError(409, `branch "${body.name}" already exists`);
	// A new branch starts at HEAD, so checking it out moves no files.
	await branch({ ...repo, ref: body.name, checkout: body.checkout ?? false });
	return { branch: body.name, checkedOut: body.checkout ?? false };
}

async function switchBranch(
	ctx: OwnerGitContext,
	body: z.infer<typeof CheckoutBodySchema>,
) {
	const repo = await repoFor(ctx);
	if (!(await listBranches({ ...repo })).includes(body.branch))
		throw new OwnerGitError(404, `no local branch "${body.branch}"`);
	const { dirty } = await workingTreeState(repo);
	if (dirty.length > 0)
		throw new OwnerGitError(
			409,
			`the working tree has uncommitted changes (${dirty.slice(0, 5).join(", ")}); commit them first`,
		);
	try {
		await checkout({ ...repo, ref: body.branch });
	} catch (err) {
		throw new OwnerGitError(409, `checkout refused: ${(err as Error).message}`);
	}
	return { branch: body.branch };
}

let queue: Promise<unknown> = Promise.resolve();
// One git operation at a time: two overlapping requests must never interleave index writes.
function serialized<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work);
	queue = next.catch(() => undefined);
	return next;
}

/** Returns false when the path isn't an owner-git route (the caller 404s). */
export async function handleOwnerGit(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	ctx: OwnerGitContext,
): Promise<boolean> {
	const route = Object.entries(OWNER_GIT_ROUTES).find(
		([, p]) => p === pathname,
	)?.[0];
	if (!route) return false;
	const gate = checkOwnerRequest(req, ctx.session, ctx.port());
	if (!gate.ok) {
		sendOwnerJson(res, gate.status, { error: gate.message });
		return true;
	}
	const expected = route === "status" ? "GET" : "POST";
	if (req.method !== expected) {
		sendOwnerJson(res, 405, { error: `use ${expected}` });
		return true;
	}
	try {
		let result: unknown;
		if (route === "status") {
			result = await serialized(() => status(ctx));
		} else if (route === "commit") {
			const body = await readOwnerJson(req, CommitBodySchema);
			if (!body.ok) return sendError(res, body.status, body.message);
			result = await serialized(async () => {
				const out = await commitEdits(ctx, body.value);
				await ctx.reconvert();
				return out;
			});
		} else if (route === "branch") {
			const body = await readOwnerJson(req, BranchBodySchema);
			if (!body.ok) return sendError(res, body.status, body.message);
			result = await serialized(async () => {
				const out = await createBranch(ctx, body.value);
				await ctx.reconvert();
				return out;
			});
		} else {
			const body = await readOwnerJson(req, CheckoutBodySchema);
			if (!body.ok) return sendError(res, body.status, body.message);
			result = await serialized(async () => {
				const out = await switchBranch(ctx, body.value);
				await ctx.reconvert();
				return out;
			});
		}
		sendOwnerJson(res, 200, result);
	} catch (err) {
		if (err instanceof OwnerGitError) {
			sendOwnerJson(res, err.status, { error: err.message, ...err.extra });
		} else {
			console.error("cabn serve: owner git error", err);
			sendOwnerJson(res, 500, { error: "git operation failed" });
		}
	}
	return true;
}

function sendError(res: ServerResponse, status: number, message: string): true {
	sendOwnerJson(res, status, { error: message });
	return true;
}
