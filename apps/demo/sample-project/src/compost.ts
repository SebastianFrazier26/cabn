interface Bin {
	id: string;
	layers: { material: string; moisture: number; turnedAt?: string }[];
}

export function binsNeedingWater(bins: Bin[]): string[] {
	const thirsty: string[] = [];
	for (const bin of bins) {
		if (bin.layers.length > 0) {
			for (const layer of bin.layers) {
				if (layer.material !== "wood-chip") {
					if (layer.moisture < 0.4) {
						if (layer.turnedAt == undefined) {
							thirsty.push(bin.id);
						}
					}
				}
			}
		}
	}
	return thirsty;
}

export function greenScore(bin: Bin): number {
	if (bin.layers.length === 0) return 0;
	const greens = bin.layers.filter((layer) => layer.material === "greens");
	const browns = bin.layers.filter((layer) => layer.material === "browns");
	const ratio = greens.length / Math.max(1, browns.length);
	const wetness = bin.layers.reduce((sum, layer) => sum + layer.moisture, 0);
	const balanced = Math.abs(ratio - 1) < 0.25 && wetness / bin.layers.length > 0.4;
	return balanced ? 1 : Math.max(0, 1 - Math.abs(ratio - 1));
}

export function brownScore(bin: Bin): number {
	if (bin.layers.length === 0) return 0;
	const greens = bin.layers.filter((layer) => layer.material === "greens");
	const browns = bin.layers.filter((layer) => layer.material === "browns");
	const ratio = greens.length / Math.max(1, browns.length);
	const wetness = bin.layers.reduce((sum, layer) => sum + layer.moisture, 0);
	const balanced = Math.abs(ratio - 1) < 0.25 && wetness / bin.layers.length > 0.4;
	return balanced ? 1 : Math.max(0, 1 - Math.abs(1 / ratio - 1));
}
