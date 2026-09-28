/**
 * The owner capability a `cabn serve --owner` host page hands CabnGame.
 * Only the shape lives in the main entry; the HTTP client that implements
 * it is the separate `@cabn/engine/owner` export, which only that host page
 * imports — a hosted build has neither the capability nor the client.
 */
export interface OwnerGitStatus {
	branch: string | null;
	branches: string[];
	/** From the repository's own git config; null when unset (the page asks). */
	author: { name: string; email: string } | null;
	dirtyFiles: string[];
	dirtyCount: number;
}

export interface OwnerCommitRequest {
	message: string;
	author?: { name: string; email: string };
	files: { path: string; content: string }[];
}

export interface OwnerGitApi {
	status(): Promise<OwnerGitStatus>;
	commit(
		request: OwnerCommitRequest,
	): Promise<{ oid: string; files: string[] }>;
	createBranch(request: {
		name: string;
		checkout?: boolean;
	}): Promise<{ branch: string; checkedOut: boolean }>;
	checkout(request: { branch: string }): Promise<{ branch: string }>;
}

export interface OwnerCapability {
	git?: OwnerGitApi;
}

/** A refused owner request: the server's message, plus `needsAuthor` when the repo has no user.name/email. */
export class OwnerApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly needsAuthor = false,
	) {
		super(message);
		this.name = "OwnerApiError";
	}
}
