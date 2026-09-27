import { Router } from "express";
import { getBuildInfo } from "../lib/buildInfo.js";

export function healthRoutes(): Router {
	const router = Router();

	router.get("/", (_req, res) => {
		res.json({
			status: "ok",
			uptimeSeconds: Math.round(process.uptime()),
			build: getBuildInfo(),
		});
	});

	return router;
}
