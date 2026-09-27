import { Router } from "express";
import { gardenerCount } from "./gardeners.js";

interface HarvestEntry {
	id: string;
	crop: string;
	weightGrams: number;
	pickedAt: string;
}

// In-memory only — this is a demo fixture, not a real datastore.
const harvests: HarvestEntry[] = [];

export function harvestCount(): number {
	return harvests.length;
}

export function harvestRoutes(): Router {
	const router = Router();

	router.get("/", (_req, res) => {
		res.json({ harvests, gardenerCount: gardenerCount() });
	});

	router.post("/", (req, res) => {
		const { crop, weightGrams } = req.body as {
			crop?: string;
			weightGrams?: number;
		};
		if (!crop || !weightGrams) {
			res.status(400).json({ error: "crop and weightGrams are required" });
			return;
		}
		const entry: HarvestEntry = {
			id: crypto.randomUUID(),
			crop,
			weightGrams,
			pickedAt: new Date().toISOString(),
		};
		harvests.push(entry);
		res.status(201).json(entry);
	});

	return router;
}
