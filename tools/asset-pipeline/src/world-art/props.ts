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

/** Batch 2 upgrade, replacing the squat "stone-lantern" — a proper lamp post: thin pole, a small housing with a bright glow slit at the top. The glow slit is the whole point: a bright, saturated warm pixel here is what the night glow preset's lowered bloom threshold catches (see fx/glowParams.ts), turning this into the "warm lantern glow" the batch-2 brief asks for without a bespoke additive-light sprite system. */
function lampPost(
	pole: number,
	poleDark: number,
	glow: number,
	glowBright: number,
): Grid {
	const g = createGrid(8, 22);
	fillRect(g, 3, 10, 2, 11, pole);
	setPixel(g, 3, 10, poleDark);
	fillRect(g, 1, 20, 6, 2, poleDark);
	fillTriangle(g, 0, 3, 7, 3, 3.5, 0, poleDark);
	fillRect(g, 1, 3, 6, 3, poleDark);
	fillRect(g, 2, 4, 4, 1, glow);
	setPixel(g, 3, 4, glowBright);
	setPixel(g, 4, 4, glowBright);
	return g;
}

/** Short stone wall segment, replacing the weaker "log-pile" — mortar seams at fixed intervals (not per-pixel noise, matching the rest of this batch's clean-shading direction) and a highlight top edge. */
function stoneWall(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
): Grid {
	const g = createGrid(20, 10);
	fillRect(g, 0, 3, 20, 7, stoneShadow);
	fillRect(g, 0, 2, 20, 6, stone);
	for (let x = 0; x < 20; x += 5) fillRect(g, x, 2, 1, 6, stoneShadow);
	fillRect(g, 0, 2, 20, 1, stoneHighlight);
	return g;
}

/** Warm cottage with a lit window and a chimney — the window color is deliberately bright/saturated for the same "night bloom catches it" reason as lampPost's glow slit. */
function cottage(
	wall: number,
	wallShadow: number,
	roof: number,
	roofShadow: number,
	windowFrame: number,
	windowGlow: number,
	door: number,
	chimney: number,
): Grid {
	const g = createGrid(20, 24);
	fillRect(g, 2, 12, 16, 10, wallShadow);
	fillRect(g, 2, 12, 16, 8, wall);
	fillTriangle(g, 0, 12, 20, 12, 10, 2, roof);
	fillRect(g, 0, 11, 20, 2, roofShadow);
	fillRect(g, 14, 3, 3, 9, chimney);
	fillRect(g, 8, 16, 4, 6, door);
	fillRect(g, 4, 14, 4, 4, windowFrame);
	fillRect(g, 5, 15, 2, 2, windowGlow);
	return g;
}

/** A small bordered flower bed — soil inside a raised border, a few blossoms in fixed (not scattered) positions for a clean planted-row look. */
function flowerBed(
	border: number,
	soil: number,
	petalA: number,
	petalB: number,
	center: number,
): Grid {
	const g = createGrid(16, 8);
	fillRect(g, 0, 2, 16, 6, border);
	fillRect(g, 1, 3, 14, 4, soil);
	const spots: [number, number, 0 | 1][] = [
		[3, 5, 0],
		[6, 4, 1],
		[9, 5, 0],
		[12, 4, 1],
	];
	for (const [x, y, which] of spots) {
		setPixel(g, x, y, which === 0 ? petalA : petalB);
		setPixel(g, x, y - 1, center);
	}
	return g;
}

/** Side-view park bench — backrest posts, a rail, a seat plank, two front legs. */
function bench(wood: number, woodDark: number): Grid {
	const g = createGrid(18, 12);
	fillRect(g, 1, 2, 2, 6, woodDark);
	fillRect(g, 15, 2, 2, 6, woodDark);
	fillRect(g, 1, 2, 16, 2, wood);
	fillRect(g, 0, 6, 18, 2, wood);
	fillRect(g, 2, 8, 2, 4, woodDark);
	fillRect(g, 14, 8, 2, 4, woodDark);
	return g;
}

/**
 * A one-off decorative keep near the shelf's tower — deliberately squarer and
 * more crenellated than the wizard tower (a round, tapering silhouette) so
 * the two don't read as the same building at different sizes. Not part of
 * PROP_NAMES' random scatter pool; placed once, by name, near the tower.
 */
function castleKeep(
	stone: number,
	stoneShadow: number,
	stoneHighlight: number,
	roofColor: number,
	flagColor: number,
): Grid {
	const g = createGrid(32, 44);
	fillRect(g, 2, 10, 8, 32, stone);
	fillTriangle(g, 0, 10, 10, 10, 5, 2, roofColor);
	setPixel(g, 5, 1, flagColor);
	setPixel(g, 6, 1, flagColor);
	setPixel(g, 5, 0, flagColor);
	fillRect(g, 4, 16, 24, 26, stone);
	fillRect(g, 4, 16, 24, 3, stoneHighlight);
	fillRect(g, 4, 39, 24, 3, stoneShadow);
	for (let x = 4; x < 28; x += 4) fillRect(g, x, 12, 2, 4, stone);
	fillRect(g, 14, 34, 6, 8, stoneShadow);
	fillRect(g, 16, 22, 2, 5, stoneShadow);
	return g;
}

/**
 * Shared by the small/large tree sizes and the bush — one silhouette recipe,
 * scaled, is what keeps a "small tree" and a "large tree" reading as the
 * same kind of tree rather than two unrelated shapes. Batch 2 adds a third,
 * smaller top tier in the highlight tone for the "tall, layered canopy"
 * cottagecore look the brief asks for, on top of batch 1's two-blob canopy.
 */
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

	const canopyCY = height - trunkH - height * 0.3;
	const canopyRX = width * 0.42;
	const canopyRY = height * 0.28;
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
	// Third, higher tier — layered/tiered silhouette instead of one round blob.
	const topCY = canopyCY - canopyRY * 0.85;
	fillEllipse(
		g,
		width / 2,
		topCY,
		canopyRX * 0.62,
		canopyRY * 0.55,
		tones.base,
	);
	shadeEllipseVolume(
		g,
		width / 2,
		topCY,
		canopyRX * 0.62,
		canopyRY * 0.55,
		tones,
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

export interface PropPaletteIndices {
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
	wallColor: number;
	wallShadow: number;
	roofColor: number;
	roofShadow: number;
	windowFrame: number;
	windowGlow: number;
	doorColor: number;
	chimneyColor: number;
	bedBorder: number;
	bedSoil: number;
	flagColor: number;
}

/** The random-scatter prop pool — see gen-world-art.ts's castleKeep call for the one-off shelf accent that's deliberately *not* in this list. */
export function buildProps(idx: PropPaletteIndices): Prop[] {
	return [
		{
			name: "fence",
			grid: fence(idx.wood, idx.woodDark, idx.woodLight),
			cellSize: 6,
		},
		{ name: "hedge", grid: hedge(idx.hedgeTones), cellSize: 6 },
		{
			name: "lamp-post",
			grid: lampPost(idx.wood, idx.woodDark, idx.glow, idx.glowBright),
			cellSize: 6,
		},
		{
			name: "tree-small",
			grid: roundCanopyTree(
				16,
				24,
				idx.trunk,
				idx.treeTones,
				idx.blossomAccent,
			),
			cellSize: 6,
		},
		{
			name: "tree-large",
			grid: roundCanopyTree(22, 34, idx.trunk, idx.treeTones),
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
			name: "stone-wall",
			grid: stoneWall(idx.stone, idx.stoneShadow, idx.stoneHighlight),
			cellSize: 6,
		},
		{
			name: "cottage",
			grid: cottage(
				idx.wallColor,
				idx.wallShadow,
				idx.roofColor,
				idx.roofShadow,
				idx.windowFrame,
				idx.windowGlow,
				idx.doorColor,
				idx.chimneyColor,
			),
			cellSize: 6,
		},
		{
			name: "flower-bed",
			grid: flowerBed(
				idx.bedBorder,
				idx.bedSoil,
				idx.petal,
				idx.blossomAccent,
				idx.petalCenter,
			),
			cellSize: 6,
		},
		{ name: "bench", grid: bench(idx.wood, idx.woodDark), cellSize: 6 },
	];
}

export function buildCastleKeep(idx: PropPaletteIndices): Prop {
	return {
		name: "castle-keep",
		grid: castleKeep(
			idx.stone,
			idx.stoneShadow,
			idx.stoneHighlight,
			idx.roofColor,
			idx.flagColor,
		),
		cellSize: 6,
	};
}
