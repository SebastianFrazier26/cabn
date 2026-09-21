import { z } from "zod";
import { type WorldManifest, WorldManifestSchema } from "./manifest.js";

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
