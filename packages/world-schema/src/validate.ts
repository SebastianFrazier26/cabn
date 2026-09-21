import { z } from "zod";
import { type WorldManifest, WorldManifestSchema } from "./manifest.js";
import { type ShelfManifest, ShelfManifestSchema } from "./shelf.js";

export class WorldManifestValidationError extends Error {
	constructor(readonly issues: string) {
		super(`Invalid world manifest:\n${issues}`);
		this.name = "WorldManifestValidationError";
	}
}

export function validateManifest(json: unknown): WorldManifest {
	const result = WorldManifestSchema.safeParse(json);
	if (!result.success) {
		throw new WorldManifestValidationError(z.prettifyError(result.error));
	}
	return result.data;
}

export class ShelfManifestValidationError extends Error {
	constructor(readonly issues: string) {
		super(`Invalid shelf manifest:\n${issues}`);
		this.name = "ShelfManifestValidationError";
	}
}

export function validateShelf(json: unknown): ShelfManifest {
	const result = ShelfManifestSchema.safeParse(json);
	if (!result.success) {
		throw new ShelfManifestValidationError(z.prettifyError(result.error));
	}
	return result.data;
}
