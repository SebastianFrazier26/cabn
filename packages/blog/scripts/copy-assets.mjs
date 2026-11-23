// tsc emits only .js and .d.ts; the stylesheet and the font it points at by
// relative url() have to land beside them in dist/.
import { copyFileSync } from "node:fs";

for (const name of ["styles.css", "DotGothic16-Latin.woff2"]) {
	copyFileSync(
		new URL(`../src/${name}`, import.meta.url),
		new URL(`../dist/${name}`, import.meta.url),
	);
}
