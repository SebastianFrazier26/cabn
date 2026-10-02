import type { PetToolCall, PetToolResult, PetToolSpec } from "./adapters.js";
import {
	REDACTION_MARKER,
	redactSecrets,
	touchesRedactedSpan,
} from "./secretRedaction.js";

/**
 * The pet's four powers, run locally over the world's own files: list,
 * read (raw text, capped), search (the world's minisearch index) and
 * propose an edit. Nothing here executes code or writes anything — a
 * proposal is only recorded for the player to review in the spellbook.
 */

export interface PetFileInfo {
	path: string;
	bytes: number;
	kind: string;
}

/** What the pet may see of the current world. WorldScene builds one (pets/worldAccess.ts) and publishes it on the store. */
export interface PetWorldAccess {
	files(): readonly PetFileInfo[];
	/** The file's current saved text (quill edits included), or null for binary/unknown paths. */
	readText(path: string): Promise<string | null>;
	search(query: string, limit: number): Promise<{ path: string }[]>;
	/** A reason this file must not be sent to the provider at all, or null. */
	withheld(path: string): string | null;
}

export interface PetProposal {
	id: string;
	path: string;
	summary: string;
	before: string;
	after: string;
	status: "pending" | "accepted" | "rejected" | "stale";
}

export interface PetToolLimits {
	/** Max characters of file text one read_file call returns. */
	maxFileChars: number;
	/** Largest file a proposal may target (the whole file is kept for the diff). */
	maxProposalFileChars: number;
	maxListEntries: number;
	maxSearchResults: number;
}

export const DEFAULT_TOOL_LIMITS: PetToolLimits = {
	maxFileChars: 16_000,
	maxProposalFileChars: 200_000,
	maxListEntries: 400,
	maxSearchResults: 10,
};

export const PET_TOOL_SPECS: readonly PetToolSpec[] = [
	{
		name: "list_files",
		description:
			"List the files in this world (a folder of the player's project): path, size in bytes and kind. Optionally only paths starting with `prefix`.",
		parameters: {
			type: "object",
			properties: {
				prefix: { type: "string", description: "Folder prefix, e.g. src/" },
			},
		},
	},
	{
		name: "read_file",
		description:
			"Read the raw text of one file. Long files are cut off; pass start_line/end_line (1-based, inclusive) to read further.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				start_line: { type: "integer", minimum: 1 },
				end_line: { type: "integer", minimum: 1 },
			},
			required: ["path"],
		},
	},
	{
		name: "search",
		description:
			"Search the world's files by name, path or contents. Returns matching file paths, best first.",
		parameters: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "propose_edit",
		description:
			"Propose a change to one text file. The player sees a before/after diff and decides; nothing changes unless they accept, so never say it has been applied. `old_text` must appear in the file exactly once (include surrounding lines to make it unique); it is replaced by `new_text`.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				old_text: { type: "string" },
				new_text: { type: "string" },
				summary: {
					type: "string",
					description: "One short sentence the player sees above the diff.",
				},
			},
			required: ["path", "old_text", "new_text", "summary"],
		},
	},
];

export interface ToolRunContext {
	world: PetWorldAccess;
	limits: PetToolLimits;
	/** Files this answer has read, in order — the chat shows them as citations. */
	cited: string[];
	proposals: PetProposal[];
	newProposalId(): string;
}

function ok(call: PetToolCall, content: unknown): PetToolResult {
	return {
		id: call.id,
		name: call.name,
		content: typeof content === "string" ? content : JSON.stringify(content),
		isError: false,
	};
}

function fail(call: PetToolCall, message: string): PetToolResult {
	return { id: call.id, name: call.name, content: message, isError: true };
}

function str(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function int(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null;
}

function normalizePath(path: string): string {
	return path.trim().replace(/^\.?\//, "");
}

function known(ctx: ToolRunContext, path: string): PetFileInfo | undefined {
	return ctx.world.files().find((f) => f.path === path);
}

function cite(ctx: ToolRunContext, path: string): void {
	if (!ctx.cited.includes(path)) ctx.cited.push(path);
}

/**
 * `withheld` used to be the only guard on a magpie-flagged file: block it
 * outright. Now the redaction scan (same patterns the magpie uses) is the
 * real gate — a file with secrets in it gets sent redacted regardless of
 * `withheld`, and `withheld` only still blocks outright when the scan finds
 * nothing, which keeps a future non-secret withholding reason from silently
 * turning into a pass-through.
 */
function guardWithheld(
	ctx: ToolRunContext,
	call: PetToolCall,
	path: string,
	secretCount: number,
): PetToolResult | null {
	if (secretCount > 0) return null;
	const withheld = ctx.world.withheld(path);
	return withheld ? fail(call, withheld) : null;
}

export async function runPetTool(
	call: PetToolCall,
	ctx: ToolRunContext,
): Promise<PetToolResult> {
	switch (call.name) {
		case "list_files": {
			const prefix = normalizePath(str(call.args.prefix) ?? "");
			const files = ctx.world.files().filter((f) => f.path.startsWith(prefix));
			const shown = files.slice(0, ctx.limits.maxListEntries);
			return ok(call, {
				total: files.length,
				truncated: files.length > shown.length,
				files: shown.map((f) => ({
					path: f.path,
					bytes: f.bytes,
					kind: f.kind,
				})),
			});
		}
		case "read_file": {
			const path = normalizePath(str(call.args.path) ?? "");
			if (!known(ctx, path))
				return fail(
					call,
					`No file "${path}" in this world. Use list_files or search.`,
				);
			const text = await ctx.world.readText(path);
			if (text === null)
				return fail(
					call,
					`"${path}" is binary or unreadable; only text files can be read.`,
				);
			const { text: safeText, count: secretsRedacted } = redactSecrets(
				text,
				path,
			);
			const blocked = guardWithheld(ctx, call, path, secretsRedacted);
			if (blocked) return blocked;
			cite(ctx, path);
			const lines = safeText.split("\n");
			const start = Math.max(1, int(call.args.start_line) ?? 1);
			const end = Math.min(
				lines.length,
				int(call.args.end_line) ?? lines.length,
			);
			let content = lines.slice(start - 1, end).join("\n");
			let lastLine = end;
			let truncated = false;
			if (content.length > ctx.limits.maxFileChars) {
				content = content.slice(0, ctx.limits.maxFileChars);
				lastLine = start + content.split("\n").length - 1;
				truncated = true;
			}
			return ok(call, {
				path,
				total_lines: lines.length,
				start_line: start,
				end_line: lastLine,
				truncated,
				content,
				...(secretsRedacted > 0
					? {
							secrets_redacted: secretsRedacted,
							note: `${secretsRedacted} hard-coded secret${secretsRedacted === 1 ? "" : "s"} in this file ${secretsRedacted === 1 ? "was" : "were"} replaced with ${REDACTION_MARKER} before it reached you.`,
						}
					: {}),
			});
		}
		case "search": {
			const query = (str(call.args.query) ?? "").trim();
			if (!query) return fail(call, "search needs a non-empty query.");
			const hits = await ctx.world.search(query, ctx.limits.maxSearchResults);
			return ok(call, { query, results: hits.map((h) => h.path) });
		}
		case "propose_edit": {
			const path = normalizePath(str(call.args.path) ?? "");
			const oldText = str(call.args.old_text);
			const newText = str(call.args.new_text);
			const summary = (str(call.args.summary) ?? "").trim().slice(0, 200);
			if (oldText === null || newText === null)
				return fail(call, "propose_edit needs old_text and new_text strings.");
			if (!known(ctx, path))
				return fail(call, `No file "${path}" in this world.`);
			const text = await ctx.world.readText(path);
			if (text === null) return fail(call, `"${path}" is not a text file.`);
			if (text.length > ctx.limits.maxProposalFileChars)
				return fail(call, `"${path}" is too large to propose edits to.`);
			if (oldText === newText)
				return fail(call, "old_text and new_text are identical.");
			const occurrences = countOccurrences(text, oldText);
			if (occurrences !== 1)
				return fail(
					call,
					occurrences === 0
						? "old_text was not found in the file. Read the file again and copy the exact text."
						: `old_text appears ${occurrences} times; include more surrounding lines so it matches once.`,
				);
			const index = text.indexOf(oldText);
			// Matched against the real text, so a hunk built from the redacted
			// view (old_text containing the marker) already fails to match above
			// in the common case; this also catches the narrower case where
			// old_text is real text that merely overlaps a secret's line — a
			// proposal is never allowed to touch that line at all (see
			// secretRedaction.ts for why rejecting beats re-inserting the secret).
			const { spans: secretSpans } = redactSecrets(text, path);
			if (touchesRedactedSpan(text, secretSpans, index, index + oldText.length))
				return fail(
					call,
					"That range includes a hard-coded secret this file's magpie is guarding. Proposals can't touch those lines — remove the secret (or ask the player to edit that line directly) first.",
				);
			const blocked = guardWithheld(ctx, call, path, secretSpans.length);
			if (blocked) return blocked;
			cite(ctx, path);
			const proposal: PetProposal = {
				id: ctx.newProposalId(),
				path,
				summary: summary || `Edit ${path}`,
				before: text,
				after:
					text.slice(0, index) + newText + text.slice(index + oldText.length),
				status: "pending",
			};
			ctx.proposals.push(proposal);
			return ok(
				call,
				`Proposal ${proposal.id} is waiting for the player's review in the spellbook. It is NOT applied yet.`,
			);
		}
		default:
			return fail(call, `Unknown tool "${call.name}".`);
	}
}

export function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return haystack.length === 0 ? 1 : 0;
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count++;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
}
