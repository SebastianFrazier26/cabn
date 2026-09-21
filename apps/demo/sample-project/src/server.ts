import express, { type Express } from "express";
import { gardenerRoutes } from "./routes/gardeners.js";
import { harvestRoutes } from "./routes/harvest.js";
import { healthRoutes } from "./routes/health.js";

export function createServer(): Express {
	const app = express();
	app.use(express.json());

	app.use("/health", healthRoutes());
	app.use("/harvests", harvestRoutes());
	app.use("/gardeners", gardenerRoutes());

	return app;
}
