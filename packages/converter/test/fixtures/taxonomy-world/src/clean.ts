import { total } from "./total.js";

export function average(values: number[]): number {
	return values.length === 0 ? 0 : total(values) / values.length;
}
