import { fromB } from "./b.js";

export function fromC(): string {
	return `c sees ${fromB()}`;
}
