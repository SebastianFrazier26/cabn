import type { PixelMap } from "../pixelmap.js";

// Shelf centerpiece: a round stone tower, coursed masonry tapering slightly
// wider toward its foundation, one glowing window, moss creeping up the
// lower courses, and a conical roof in the same deep-plum/amethyst pair as
// the spellsword's staff gem (character-idle.ts) so the tower reads as
// "belongs to whoever carries that staff."
export const WIZARD_TOWER_LEGEND: Record<string, number> = {
	"9": 33, // bright amethyst — roof tip
	P: 32, // deep plum — conical roof body
	O: 0, // darkest brown — mortar seams, silhouette edges, window frame, doorway
	e: 28, // steel gray — eaves ledge trim
	S: 28, // steel gray — stone base course
	s: 31, // cool shadow blue-gray — stone shadow course
	k: 31, // cool shadow blue-gray — foundation plinth (darker, grounds the tower)
	F: 0, // darkest brown — window frame
	w: 30, // pale ghost blue — glowing window
	D: 0, // darkest brown — doorway recess
	v: 4, // dark green — moss shadow
	V: 9, // mid green — moss highlight
};

const ROWS: string[] = [
	"................................................",
	"......................O9O.......................",
	"......................O99O......................",
	".....................O9999O.....................",
	"....................OPPPPPPO....................",
	"...................OPPPPPPPPO...................",
	"...................OPPPPPPPPO...................",
	"..................OPPPPPPPPPPO..................",
	".................OPPPPPPPPPPPPO.................",
	"................OPPPPPPPPPPPPPPO................",
	"................OPPPPPPPPPPPPPPO................",
	"...............OPPPPPPPPPPPPPPPPO...............",
	"..............OPPPPPPPPPPPPPPPPPPO..............",
	".............OPPPPPPPPPPPPPPPPPPPPO.............",
	".............OPPPPPPPPPPPPPPPPPPPPO.............",
	"............OPPPPPPPPPPPPPPPPPPPPPPO............",
	"...........OPPPPPPPPPPPPPPPPPPPPPPPPO...........",
	"..........OPPPPPPPPPPPPPPPPPPPPPPPPPPO..........",
	"..........OPPPPPPPPPPPPPPPPPPPPPPPPPPO..........",
	".........OPPPPPPPPPPPPPPPPPPPPPPPPPPPPO.........",
	"........OPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPO........",
	".......OPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPO.......",
	"......OPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPO.......",
	"....eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee....",
	".....eeeeeeeeeeeeeeeevVvVvVveeeeeeeeeeeeeee.....",
	"......OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.....",
	".........OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	".........OssOssssssssOssssssssOsssssssO.........",
	"........OssOssssssssOssssssssOssssssssO.........",
	"........OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO........",
	"........OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSFFFFFFFFSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSFFFFFFFFSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSFwwwwwwFSSSSSOSSSSSO........",
	"........OSSSSSSOSSSSFwwwwwwFSSSSSOSSSSSO........",
	"........OOOOOOOOOOOOFwwwwwwFOOOOOOOOOOOO........",
	"........OssOssssssssFwwwwwwFsOssssssssOO........",
	"........OssOssssssssFwwwwwwFsOssssssssOO........",
	"........OssOssssssssFFFFFFFFsOssssssssOO........",
	"........OssOssssssssFFFFFFFFsOssssssssOO........",
	"........OssOssssssssOssssssssOssssssssOsO.......",
	".......OssOssssssssOssssssssOssssssssOssO.......",
	".......OssOssssssssOssssssssOssssssssOssO.......",
	".......OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSO.......",
	".......OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.......",
	".......OssOssssssssOssssssssOssssssssOssO.......",
	".......OssOssssssssOssssssssOssssssssOssO.......",
	"......OssOssssssssOssssssssOssssssssOsssO.......",
	"......OssOssssssssOssssssssOssssssssOssssO......",
	"......OssOssssssssOssssssssOssssssssOssssO......",
	"......OssOssssssssOssssssssOssssVvVvOssssO......",
	"......OssOssssssssOssssssssOssssssssOssssO......",
	"......OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO......",
	"......OSSSSSSOSSSSSSSSOSSSSSSSSOSVvVvVSSOO......",
	"......OSSSVvVOVSSSSSSSOSSSSSSSSOSSSSSSSSOO......",
	"......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSSOO......",
	"......OSSSSvVOVvVSSSSSOSSSSSSSSOVvVvSSSSOO......",
	"......OSSSSSSOSSSSSSSSOSSSSSSSSOSSSSSSSSOO......",
	"......OSSSSSSOSSSSSSSDDDDDDSSSSOSSSSSSSSOO......",
	"......OSSSSSSOSSSSSSSDDDDDDSSSSOSSSSSSSSOO......",
	"......OOOOOOOOOOOOOOODDDDDDOOOOOOOOOOOOOOO......",
	"......OssOssssssssOssDDDDDDOssssssssOsssssO.....",
	"......OkkkkkkkkkkkkkkDDDDDDkkkkkkkkkkkkkkkO.....",
	"......OkkkkkkkkkkkkkkDDDDDDkkkkkkkkkkkkkkkO.....",
	"......OkkkkkkkkkkkkkkDDDDDDkkkkkkkkkkkkkkkO.....",
	"......OkkkkkkkkkkkkkkDDDDDDkkkkkkkkkkkkkkkO.....",
];

export const wizardTower: PixelMap = {
	name: "wizard_tower",
	width: 48,
	height: 80,
	legend: WIZARD_TOWER_LEGEND,
	rows: ROWS,
};
