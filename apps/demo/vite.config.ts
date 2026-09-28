import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	define: {
		// Belt-and-suspenders alongside the real guarantee (this app's source
		// never imports "@cabn/engine/local-exec" at all — see
		// scripts/check-no-exec-in-bundle.mjs and that module's own docs): if
		// anything ever referenced this constant, it would be statically
		// false here rather than merely defaulting to false at runtime.
		__CABN_ALLOW_LOCAL_EXEC__: false,
	},
});
