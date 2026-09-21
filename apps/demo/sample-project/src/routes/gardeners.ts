import { Router } from "express";

const gardeners = [
	{ id: "g1", name: "Wren", plots: ["north-bed", "greenhouse"] },
	{ id: "g2", name: "Marigold", plots: ["south-bed"] },
];

export function gardenerRoutes(): Router {
	const router = Router();

	router.get("/", (_req, res) => {
		res.json(gardeners);
	});

	router.get("/:id", (req, res) => {
		const gardener = gardeners.find((g) => g.id === req.params.id);
		if (!gardener) {
			res.status(404).json({ error: "no such gardener" });
			return;
		}
		res.json(gardener);
	});

	return router;
}
