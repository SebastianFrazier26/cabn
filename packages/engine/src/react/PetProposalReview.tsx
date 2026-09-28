import { isolateHistory } from "@codemirror/commands";
import { useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { diffLines, minimalChange } from "../pets/diff.js";
import { PET_PROVIDERS } from "../pets/providers.js";
import type { PetProposal } from "../pets/tools.js";
import { useCabnStore } from "./useCabnStore.js";

/**
 * Accepting a proposal edits the shared file buffer (the same one the page
 * and the spellbook edit), as its own undo step. It doesn't save: the
 * player seals it with Save like any other edit, which is what re-checks
 * the file's monsters and persists the override. A buffer that no longer
 * matches the text the pet saw marks the proposal stale instead of
 * guessing where the change should go.
 */
export function applyPetProposal(
	store: StoreApi<CabnStore>,
	proposal: PetProposal,
): "applied" | "stale" {
	const s = store.getState();
	const buffer = s.activeFileState;
	if (!buffer || s.activePortalId !== proposal.path) return "stale";
	if (buffer.doc.toString() !== proposal.before) {
		s.setPetProposalStatus(proposal.id, "stale");
		return "stale";
	}
	const change = minimalChange(proposal.before, proposal.after);
	const next = buffer.update({
		changes: change,
		selection: { anchor: change.from + change.insert.length },
		scrollIntoView: true,
		annotations: isolateHistory.of("full"),
	}).state;
	s.setActiveFileState(next);
	s.setPetProposalStatus(proposal.id, "accepted");
	return "applied";
}

/** The spellbook's right page, taken over while a pet proposal for this file waits for a decision. */
export function PetProposalReview({
	store,
}: {
	store: StoreApi<CabnStore>;
}): React.ReactElement | null {
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const proposal = useCabnStore(store, (s) =>
		s.petProposals.find(
			(p) => p.path === s.activePortalId && p.status === "pending",
		),
	);
	const provider = useCabnStore(store, (s) => s.petProvider);
	const rows = useMemo(
		() => (proposal ? diffLines(proposal.before, proposal.after) : []),
		[proposal],
	);
	if (!proposal || !portalId) return null;
	const petName = provider ? PET_PROVIDERS[provider].petName : "Your pet";

	return (
		<div className="cabn-pet-review" data-testid="cabn-pet-proposal">
			<div className="cabn-spellbook-page-header">
				<span>{petName} proposes</span>
			</div>
			<p className="cabn-pet-note" style={{ fontSize: 12 }}>
				{proposal.summary}
			</p>
			<div className="cabn-pet-diff" data-testid="cabn-pet-diff">
				{rows.map((row, i) => {
					const key = `${i}-${row.kind}`;
					if (row.kind === "gap")
						return (
							<div key={key} className="gap">
								⋯ {row.hidden} unchanged line{row.hidden === 1 ? "" : "s"}
							</div>
						);
					const line = row.kind === "add" ? row.newLine : row.oldLine;
					const mark =
						row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
					return (
						<div key={key} className={row.kind} data-kind={row.kind}>
							<span className="ln">{line}</span>
							{mark} {row.text}
						</div>
					);
				})}
			</div>
			<div className="cabn-pet-row">
				<button
					type="button"
					className="cabn-btn confirm"
					data-testid="cabn-pet-accept"
					onClick={() => {
						if (applyPetProposal(store, proposal) === "stale")
							store.getState().addPetMessage({
								id: `stale-${proposal.id}`,
								role: "pet",
								text: `The file changed since I wrote that proposal for ${proposal.path}, so I left it alone. Ask me again and I'll look afresh.`,
								error: true,
							});
					}}
				>
					Accept (then Save)
				</button>
				<button
					type="button"
					className="cabn-btn cancel"
					data-testid="cabn-pet-reject"
					onClick={() =>
						store.getState().setPetProposalStatus(proposal.id, "rejected")
					}
				>
					Reject
				</button>
			</div>
		</div>
	);
}
