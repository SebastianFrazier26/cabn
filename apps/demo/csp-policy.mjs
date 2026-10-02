// The demo's Content-Security-Policy, injected into the built index.html only
// (vite.config.ts): in `vite dev`, @vitejs/plugin-react adds an inline module
// script for fast refresh that `script-src 'self'` would block.
//
// A <meta> policy cannot carry frame-ancestors (browsers ignore it there). A
// host that wants to forbid framing the demo must send
// `Content-Security-Policy: frame-ancestors 'none'` (or its own origin list)
// as a response header.
export const DEMO_CSP_DIRECTIVES = {
	"default-src": ["'self'"],
	"script-src": ["'self'"],
	// The engine injects <style> elements at runtime (pixelTheme, pet, guide,
	// media, sign and portal styles), and a bundled iOS viewport-height helper
	// sets a style attribute via setAttribute. Both need 'unsafe-inline'; nonces need a per-response
	// server and hashes would break on every engine CSS edit. React `style={}`
	// props write CSSOM properties, which CSP never blocks.
	"style-src": ["'self'", "'unsafe-inline'"],
	// data: for Phaser's built-in base64 textures. blob: because the game's image
	// textures load through object URLs (the e2e run without it logged over a
	// thousand img-src violations), and an in-browser (universe) world
	// serves all its files as object URLs (render/resolveUrl.ts), which is
	// also why media-src needs it for that world's audio and video.
	"img-src": ["'self'", "data:", "blob:"],
	"media-src": ["'self'", "blob:"],
	// The engine ships its pixel font (DotGothic16) as a data: URI.
	"font-src": ["'self'", "data:"],
	// The pets talk to the player's chosen model provider straight from the
	// browser; blob: is how an in-browser world's files are fetched (the rift's
	// universe switch fails without it). An Ollama endpoint other than the
	// default port needs a host that sends its own, wider policy.
	"connect-src": [
		"'self'",
		"blob:",
		"https://api.anthropic.com",
		"https://api.openai.com",
		"https://generativelanguage.googleapis.com",
		"https://dashscope-intl.aliyuncs.com",
		"https://dashscope-us.aliyuncs.com",
		"https://dashscope.aliyuncs.com",
		"https://api.deepseek.com",
		"http://localhost:11434",
		"http://127.0.0.1:11434",
	],
	"worker-src": ["'self'"],
	// The sample world's cabn.json allowedEmbedOrigins, nothing broader.
	"frame-src": [
		"https://example.com",
		"https://threejs.org",
		"https://github.com",
	],
	"base-uri": ["'none'"],
	"object-src": ["'none'"],
	"form-action": ["'none'"],
};

export const DEMO_CSP = Object.entries(DEMO_CSP_DIRECTIVES)
	.map(([name, values]) => `${name} ${values.join(" ")}`)
	.join("; ");

// What the hosted demo's Caddy sends as a response header
// (scripts/render-caddyfile.mjs). Same policy plus the one directive a meta
// tag can't carry.
export const DEMO_CSP_HEADER = `${DEMO_CSP}; frame-ancestors 'none'`;
