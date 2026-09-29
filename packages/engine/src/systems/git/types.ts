import type { GitMeta, OmittedBlobReason } from "@cabn/world-schema";

/** What the git UI reads through the lazily loaded browser repository (systems/git/browserRepo.ts). */
export interface RepoCommit {
	oid: string;
	parents: string[];
	message: string;
	author: { name: string; email: string; timestamp: number };
	tree: string;
}

export type ChangeStatus = "added" | "modified" | "deleted";

export interface CommitChanges {
	changes: { path: string; status: ChangeStatus }[];
	/** The commit sits on the shallow boundary: its parent isn't shipped, so there's nothing to compare with. */
	boundary: boolean;
}

export interface FileHistoryEntry {
	commit: RepoCommit;
	status: ChangeStatus;
	/** The earliest shipped commit that has the file; history before it isn't in the world. */
	boundary: boolean;
	blob: string | null;
	parentBlob: string | null;
}

export type BlobRead =
	| { kind: "text"; text: string }
	| { kind: "binary"; size: number }
	| {
			kind: "not-shipped";
			reason: OmittedBlobReason | "unknown";
			size?: number;
	  };

export interface BrowserRepo {
	meta: GitMeta;
	/** A branch's shipped commits, newest first (stops at the shallow boundary). */
	log(branch: string): Promise<RepoCommit[]>;
	changes(commit: RepoCommit): Promise<CommitChanges>;
	fileHistory(branch: string, path: string): Promise<FileHistoryEntry[]>;
	readBlob(oid: string): Promise<BlobRead>;
	/**
	 * The branch's head tree converted into a world bundle, in the browser;
	 * cached per branch for the page's lifetime. Web previews are assumed
	 * framable and no external findings apply (both are build-time inputs).
	 */
	convertUniverse(
		branch: string,
		opts: { name: string; source: string; generatedAt: string },
	): Promise<Map<string, Uint8Array | string>>;
}
