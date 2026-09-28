import {
	createGrid,
	fillEllipse,
	fillRect,
	fillTriangle,
	type Grid,
	type GroundTonesLike,
	setPixel,
	shadeEllipseVolume,
} from "../pixel-shapes.js";

export interface Prop {
	name: string;
	grid: Grid;
	/** Per-prop soften() cell size — one shared value (6) for every prop in this batch, between the ground tiles' 2 and the hero sprites' 16, since props are bigger than a tile decal but smaller than a landmark. */
	cellSize: number;
}

function fence(wood: number, woodDark: number, woodLight: number): Grid {
	const g = createGrid(20, 12);
	fillRect(g, 0, 4, 20, 2, wood);
	fillRect(g, 0, 8, 20, 2, wood);
	for (const px of [2, 10, 18]) {
		fillRect(g, px, 2, 2, 9, wood);
		setPixel(g, px, 2, woodLight);
		setPixel(g, px + 1, 10, woodDark);
	}
	return g;
}

function hedge(tones: GroundTonesLike): Grid {
	const g = createGrid(22, 12);
	fillEllipse(g, 11, 7, 10, 5, tones.shadow);
	fillEllipse(g, 11, 6, 9.3, 4.3, tones.base);
	fillEllipse(g, 7, 5, 3, 2.2, tones.highlight);
	fillEllipse(g, 15, 5, 3, 2.2, tones.highlight);
	return g;
}

function stoneLantern(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
	glow: number,
	glowBright: number,
): Grid {
	const g = createGrid(10, 18);
	fillRect(g, 2, 15, 6, 2, stoneShadow);
	fillRect(g, 3, 9, 4, 6, stone);
	fillRect(g, 1, 6, 8, 3, stone);
	fillRect(g, 3, 7, 4, 1, glow);
	setPixel(g, 4, 7, glowBright);
	setPixel(g, 5, 7, glowBright);
	fillTriangle(g, 0, 6, 9, 6, 4.5, 1, stoneShadow);
	fillRect(g, 3, 0, 4, 1, stoneHighlight);
	return g;
}

/** Shared by the small/large tree sizes and the bush — one silhouette recipe, scaled, is what keeps a "small tree" and a "large tree" reading as the same kind of tree rather than two unrelated shapes. */
function roundCanopyTree(
	width: number,
	height: number,
	trunk: number,
	tones: GroundTonesLike,
	blossomAccent?: number,
): Grid {
	const g = createGrid(width, height);
	const trunkW = Math.max(2, Math.round(width * 0.16));
	const trunkH = Math.round(height * 0.32);
	const trunkX = Math.round(width / 2 - trunkW / 2);
	fillRect(g, trunkX, height - trunkH, trunkW, trunkH, trunk);

	const canopyCY = height - trunkH - height * 0.26;
	const canopyRX = width * 0.42;
	const canopyRY = height * 0.32;
	fillEllipse(g, width / 2, canopyCY, canopyRX, canopyRY, tones.base);
	shadeEllipseVolume(g, width / 2, canopyCY, canopyRX, canopyRY, tones);
	fillEllipse(
		g,
		width * 0.3,
		canopyCY + canopyRY * 0.3,
		canopyRX * 0.55,
		canopyRY * 0.6,
		tones.base,
	);
	fillEllipse(
		g,
		width * 0.7,
		canopyCY + canopyRY * 0.3,
		canopyRX * 0.55,
		canopyRY * 0.6,
		tones.base,
	);

	if (blossomAccent !== undefined) {
		const spots: [number, number][] = [
			[0.3, 0.2],
			[0.58, 0.15],
			[0.72, 0.42],
			[0.38, 0.48],
			[0.5, 0.3],
		];
		for (const [fx, fy] of spots) {
			setPixel(
				g,
				Math.round(width * fx),
				Math.round(canopyCY - canopyRY + fy * canopyRY * 2),
				blossomAccent,
			);
		}
	}
	return g;
}

function bush(tones: GroundTonesLike): Grid {
	const g = createGrid(14, 10);
	fillEllipse(g, 7, 6, 6, 3.6, tones.base);
	shadeEllipseVolume(g, 7, 6, 6, 3.6, tones);
	fillEllipse(g, 4, 7, 3, 2.2, tones.base);
	fillEllipse(g, 10, 7, 3, 2.2, tones.base);
	return g;
}

function well(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
	roofWood: number,
	roofWoodDark: number,
	waterDark: number,
): Grid {
	const g = createGrid(16, 20);
	fillRect(g, 1, 4, 2, 10, roofWoodDark);
	fillRect(g, 13, 4, 2, 10, roofWoodDark);
	fillTriangle(g, 0, 4, 16, 4, 8, 0, roofWood);
	fillEllipse(g, 8, 14, 7, 5, stoneShadow);
	fillEllipse(g, 8, 13, 6.3, 4.3, stone);
	fillEllipse(g, 8, 12, 4.5, 2.2, waterDark);
	setPixel(g, 6, 11, stoneHighlight);
	setPixel(g, 7, 11, stoneHighlight);
	return g;
}

function signpost(
	wood: number,
	woodDark: number,
	plankCream: number,
	ink: number,
): Grid {
	const g = createGrid(10, 18);
	fillRect(g, 4, 6, 2, 12, wood);
	setPixel(g, 4, 6, woodDark);
	fillRect(g, 0, 2, 10, 4, plankCream);
	fillRect(g, 0, 8, 8, 3, plankCream);
	for (let x = 1; x < 9; x += 2) setPixel(g, x, 4, ink);
	for (let x = 1; x < 7; x += 2) setPixel(g, x, 9, ink);
	return g;
}

function flowerPot(
	pot: number,
	potShadow: number,
	dirt: number,
	petal: number,
	center: number,
	stem: number,
): Grid {
	const g = createGrid(10, 14);
	fillRect(g, 2, 9, 6, 4, potShadow);
	fillRect(g, 2, 9, 6, 3, pot);
	fillRect(g, 2, 8, 6, 1, dirt);
	for (const [sx, sy] of [
		[3, 7],
		[5, 7],
		[7, 7],
	] as const) {
		setPixel(g, sx, sy, stem);
		setPixel(g, sx, sy + 1, stem);
	}
	fillEllipse(g, 3, 4, 1.2, 1, petal);
	fillEllipse(g, 5, 3, 1.2, 1, petal);
	fillEllipse(g, 7, 4.5, 1.2, 1, petal);
	setPixel(g, 3, 4, center);
	setPixel(g, 5, 3, center);
	setPixel(g, 7, 4, center);
	return g;
}

function logPile(
	logBase: number,
	logShadow: number,
	logHighlight: number,
	ring: number,
): Grid {
	const g = createGrid(18, 10);
	fillEllipse(g, 4, 7, 4, 2.4, logShadow);
	fillEllipse(g, 4, 6.4, 3.6, 2, logBase);
	setPixel(g, 3, 6, ring);
	fillEllipse(g, 10, 7.5, 4, 2.4, logShadow);
	fillEllipse(g, 10, 6.9, 3.6, 2, logBase);
	setPixel(g, 9, 6, ring);
	fillEllipse(g, 14, 6, 3.4, 2, logHighlight);
	setPixel(g, 13, 5, ring);
	return g;
}

export function buildProps(idx: {
	wood: number;
	woodDark: number;
	woodLight: number;
	hedgeTones: GroundTonesLike;
	stone: number;
	stoneShadow: number;
	stoneHighlight: number;
	glow: number;
	glowBright: number;
	treeTones: GroundTonesLike;
	trunk: number;
	blossomAccent: number;
	bushTones: GroundTonesLike;
	waterDark: number;
	plankCream: number;
	ink: number;
	potColor: number;
	potShadow: number;
	dirt: number;
	petal: number;
	petalCenter: number;
	stem: number;
	logBase: number;
	logShadow: number;
	logHighlight: number;
	ringColor: number;
}): Prop[] {
	return [
		{
			name: "fence",
			grid: fence(idx.wood, idx.woodDark, idx.woodLight),
			cellSize: 6,
		},
		{ name: "hedge", grid: hedge(idx.hedgeTones), cellSize: 6 },
		{
			name: "stone-lantern",
			grid: stoneLantern(
				idx.stone,
				idx.stoneShadow,
				idx.stoneHighlight,
				idx.glow,
				idx.glowBright,
			),
			cellSize: 6,
		},
		{
			name: "tree-small",
			grid: roundCanopyTree(
				16,
				20,
				idx.trunk,
				idx.treeTones,
				idx.blossomAccent,
			),
			cellSize: 6,
		},
		{
			name: "tree-large",
			grid: roundCanopyTree(22, 30, idx.trunk, idx.treeTones),
			cellSize: 6,
		},
		{ name: "bush", grid: bush(idx.bushTones), cellSize: 6 },
		{
			name: "well",
			grid: well(
				idx.stone,
				idx.stoneShadow,
				idx.stoneHighlight,
				idx.wood,
				idx.woodDark,
				idx.waterDark,
			),
			cellSize: 6,
		},
		{
			name: "signpost",
			grid: signpost(idx.wood, idx.woodDark, idx.plankCream, idx.ink),
			cellSize: 6,
		},
		{
			name: "flower-pot",
			grid: flowerPot(
				idx.potColor,
				idx.potShadow,
				idx.dirt,
				idx.petal,
				idx.petalCenter,
				idx.stem,
			),
			cellSize: 6,
		},
		{
			name: "log-pile",
			grid: logPile(
				idx.logBase,
				idx.logShadow,
				idx.logHighlight,
				idx.ringColor,
			),
			cellSize: 6,
		},
	];
}
