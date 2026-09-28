import { undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { createCabnStore } from "../../src/bridge/store.js";
import type { PetProposal } from "../../src/pets/tools.js";
import { applyPetProposal } from "../../src/react/PetProposalReview.js";
import { isActiveFileDirty } from "../../src/systems/fileBuffer.js";

const BEFORE = "const port = 3000;\nlisten(port);\n";
const proposal = (over: Partial<PetProposal> = {}): PetProposal => ({
	id: "p1",
	path: "src/server.ts",
	summary: "Use 8080",
	before: BEFORE,
	after: BEFORE.replace("3000", "8080"),
	status: "pending",
	...over,
});

describe("applyPetProposal", () => {
	it("edits the shared buffer as its own undo step, leaves it unsaved, and marks the proposal accepted", () => {
		const store = createCabnStore();
		store.getState().enterPortal("src/server.ts", BEFORE);
		store.getState().addPetProposals([proposal()]);
		expect(applyPetProposal(store, proposal())).toBe("applied");
		const s = store.getState();
		expect(s.activeFileState?.doc.toString()).toBe(
			BEFORE.replace("3000", "8080"),
		);
		expect(isActiveFileDirty(s)).toBe(true);
		expect(s.activePortalContent).toBe(BEFORE);
		expect(s.petProposals[0]?.status).toBe("accepted");

		let reverted = s.activeFileState;
		if (!reverted) throw new Error("no buffer");
		undo({
			state: reverted,
			dispatch: (tr) => {
				reverted = tr.state;
			},
		});
		expect(reverted.doc.toString()).toBe(BEFORE);
	});

	it("refuses a buffer that no longer matches what the pet saw", () => {
		const store = createCabnStore();
		store.getState().enterPortal("src/server.ts", "something else entirely\n");
		store.getState().addPetProposals([proposal()]);
		expect(applyPetProposal(store, proposal())).toBe("stale");
		expect(store.getState().activeFileState?.doc.toString()).toBe(
			"something else entirely\n",
		);
		expect(store.getState().petProposals[0]?.status).toBe("stale");
	});

	it("does nothing when a different file is open", () => {
		const store = createCabnStore();
		store.getState().enterPortal("README.md", BEFORE);
		expect(applyPetProposal(store, proposal())).toBe("stale");
		expect(store.getState().activeFileState?.doc.toString()).toBe(BEFORE);
	});
});

describe("store pet slice", () => {
	it("leaving a world clears the pet's world, sprite and conversation but keeps the chosen provider", () => {
		const store = createCabnStore();
		const s = store.getState();
		s.setPetProvider("gemini");
		s.setPetChatOpen(true);
		s.addPetMessage({ id: "m1", role: "player", text: "hi" });
		s.setPetNpc({ pos: { x: 1, y: 2 } });
		store.getState().clearWorldContext();
		const after = store.getState();
		expect(after.petProvider).toBe("gemini");
		expect(after.petChatOpen).toBe(false);
		expect(after.petMessages).toEqual([]);
		expect(after.petNpc).toBeNull();
	});

	it("never holds a key: no pet field is a string that looks like one after a full setup", () => {
		const store = createCabnStore();
		store.getState().setPetProvider("openai");
		const petFields = Object.entries(store.getState()).filter(([k]) =>
			k.startsWith("pet"),
		);
		expect(JSON.stringify(petFields)).not.toMatch(/key/i);
	});
});
