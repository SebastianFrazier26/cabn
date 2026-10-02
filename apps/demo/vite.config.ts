import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DEMO_CSP } from "./csp-policy.mjs";

const CHARSET_META = '<meta charset="UTF-8" />';

// Right after the charset tag: a meta policy only governs what the parser
// meets after it, and the charset must stay within the first 1024 bytes.
function cspMeta(): Plugin {
	return {
		name: "cabn-demo-csp",
		apply: "build",
		transformIndexHtml(html) {
			if (!html.includes(CHARSET_META)) {
				throw new Error(
					`index.html lost its ${CHARSET_META} anchor for the CSP`,
				);
			}
			const meta = `<meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}" />`;
			return html.replace(CHARSET_META, `${CHARSET_META}\n\t\t${meta}`);
		},
	};
}

export default defineConfig({
	plugins: [react(), cspMeta()],
	define: {
		// Belt-and-suspenders alongside the real guarantee (this app's source
		// never imports "@cabn/engine/local-exec" at all — see
		// scripts/check-no-exec-in-bundle.mjs and that module's own docs): if
		// anything ever referenced this constant, it would be statically
		// false here rather than merely defaulting to false at runtime.
		__CABN_ALLOW_LOCAL_EXEC__: false,
	},
});
