import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 4000);

createServer().listen(PORT, () => {
	console.log(`harvest-log listening on :${PORT}`);
});
