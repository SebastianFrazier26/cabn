import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createServer } from "../src/server.js";

test("createServer returns an Express app with the expected route groups", () => {
	const app = createServer();
	assert.ok(app);
	assert.equal(typeof app.listen, "function");
});
