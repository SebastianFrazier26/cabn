import { defeatFrames, hitFrame, type MonsterFxTones } from "../monster-fx.js";
import type { PixelMap } from "../pixelmap.js";
import { brambleIdle0, brambleIdle1 } from "../pixelmaps/bramble.js";
import { ghost } from "../pixelmaps/ghost.js";
import { gremlinIdle0, gremlinIdle1 } from "../pixelmaps/gremlin.js";
import { impIdle0, impIdle1 } from "../pixelmaps/imp.js";
import { magpieIdle0, magpieIdle1 } from "../pixelmaps/magpie.js";
import { ouroborosIdle0, ouroborosIdle1 } from "../pixelmaps/ouroboros.js";
import { rotSpriteIdle0, rotSpriteIdle1 } from "../pixelmaps/rot-sprite.js";
import { shadeIdle0, shadeIdle1 } from "../pixelmaps/shade.js";
import { skeletonIdle0, skeletonIdle1 } from "../pixelmaps/skeleton.js";
import {
	wardedMimicIdle0,
	wardedMimicIdle1,
} from "../pixelmaps/warded-mimic.js";
import { willOWispIdle0, willOWispIdle1 } from "../pixelmaps/will-o-wisp.js";
import type { NetherPalette } from "./palette.js";

type N = NetherPalette["n"];

/**
 * The monsters as the nether shows them (2026-09-29): each species' own
 * idle rows with a nether legend, so every frame keeps its original's exact
 * size and layout (and the engine swaps textures without refitting), and the
 * creature keeps its silhouette, face and props — only its materials change.
 * Recolouring the legend, not redrawing, is deliberate: the silhouettes are
 * what make each species recognisable, and the user asked for the same
 * creature seen from the nether. Colours are chosen against netherrack's mid
 * red: light ash, bone and ember tones carry each body, dark ones only
 * where an ink outline already frames them.
 */
export interface NetherMonster {
	/** The normal art's file slug (rot_sprite, ghost, ...). */
	slug: string;
	/** One frame for ghost (a static image), two for every other species. */
	idle: PixelMap[];
	hit: PixelMap;
	defeat: PixelMap[];
}

/** Base palette index -> nether index. */
type Recolour = Record<number, number>;

interface Species {
	slug: string;
	frames: PixelMap[];
	recolour: (n: N) => Recolour;
}

const SPECIES: Species[] = [
	{
		// Magma slime: a glowing molten body under dark crust plates, sparks for glitch pixels.
		slug: "rot_sprite",
		frames: [rotSpriteIdle0, rotSpriteIdle1],
		recolour: (n) => ({
			43: n.netherDeep,
			46: n.emberRed,
			47: n.emberOrange,
			48: n.emberYellow,
			29: n.lavaHot,
			52: n.char,
			32: n.netherCrack,
			37: n.emberYellow,
		}),
	},
	{
		// A charred chest bound in iron, its ward a cold soul-fire rune, ember eyes in the dark.
		slug: "warded_mimic",
		frames: [wardedMimicIdle0, wardedMimicIdle1],
		recolour: (n) => ({
			62: n.char,
			61: n.charLight,
			63: n.ashMid,
			18: n.iron,
			38: n.ironLight,
			32: n.obsidianBase,
			33: n.soulCyan,
			29: n.bone,
			2: n.netherCrack,
			54: n.emberYellow,
			52: n.emberOrange,
			39: n.emberRed,
		}),
	},
	{
		// Cinder gremlin: ash-grey hide, ember eyes, the pried-out bracket red-hot.
		slug: "gremlin",
		frames: [gremlinIdle0, gremlinIdle1],
		recolour: (n) => ({
			57: n.charLight,
			56: n.ashMid,
			25: n.ashLight,
			24: n.boneShadow,
			36: n.emberRed,
			54: n.emberYellow,
			29: n.bone,
			2: n.netherCrack,
			58: n.emberYellow,
			60: n.emberRed,
		}),
	},
	{
		// Basalt serpent: blackstone scales over a molten belly, ember diamonds.
		slug: "ouroboros",
		frames: [ouroborosIdle0, ouroborosIdle1],
		recolour: (n) => ({
			67: n.blackstoneDark,
			66: n.blackstone,
			53: n.blackstoneLight,
			51: n.emberOrange,
			26: n.emberRed,
			38: n.emberYellow,
			2: n.netherCrack,
			29: n.bone,
			54: n.lavaHot,
		}),
	},
	{
		// Ember wisp: red-orange tongues round a white-hot core, the TODO on scorched paper.
		slug: "will_o_wisp",
		frames: [willOWispIdle0, willOWispIdle1],
		recolour: (n) => ({
			67: n.netherCrack,
			30: n.emberRed,
			35: n.emberOrange,
			29: n.emberYellow,
			65: n.lavaHot,
			27: n.boneShadow,
			60: n.char,
		}),
	},
	{
		// Still the purple one, in obsidian now, with bone horns and a fire-spark hex.
		slug: "imp",
		frames: [impIdle0, impIdle1],
		recolour: (n) => ({
			32: n.obsidianLight,
			33: n.obsidianGlint,
			27: n.bone,
			54: n.emberYellow,
			29: n.lavaHot,
			52: n.emberRed,
			38: n.emberOrange,
		}),
	},
	{
		// Soot magpie: char plumage, ash belly, an ember wing flash, still clutching its coin.
		slug: "magpie",
		frames: [magpieIdle0, magpieIdle1],
		recolour: (n) => ({
			31: n.charLight,
			29: n.ashLight,
			53: n.emberOrange,
			46: n.emberRed,
			60: n.iron,
			54: n.emberYellow,
			38: n.emberOrange,
			27: n.lavaHot,
		}),
	},
	{
		// Scorched bones: ember-lit sockets, the ear flower an ember bloom on a dead stalk.
		slug: "skeleton",
		frames: [skeletonIdle0, skeletonIdle1],
		recolour: (n) => ({
			62: n.char,
			27: n.bone,
			23: n.boneShadow,
			0: n.netherCrack,
			29: n.emberYellow,
			36: n.emberRed,
			54: n.emberYellow,
			41: n.charLight,
		}),
	},
	{
		// Charred ember bramble: burnt vine, glowing thorns, a live-coal berry.
		slug: "bramble",
		frames: [brambleIdle0, brambleIdle1],
		recolour: (n) => ({
			40: n.charLight,
			41: n.ashMid,
			43: n.char,
			61: n.emberOrange,
			38: n.emberYellow,
			39: n.emberRed,
			36: n.lavaHot,
		}),
	},
	{
		// A shadow lit from below by the realm: obsidian body, ember rim, soul-fire eyes.
		slug: "shade",
		frames: [shadeIdle0, shadeIdle1],
		recolour: (n) => ({
			32: n.obsidianDeep,
			31: n.emberRed,
			35: n.soulCyan,
		}),
	},
	{
		// Ash wraith: pale ash with a soul-fire rim.
		slug: "ghost",
		frames: [ghost],
		recolour: (n) => ({
			31: n.soulDeep,
			30: n.soulCyan,
			29: n.ashLight,
		}),
	},
];

export const NETHER_MONSTER_SLUGS = SPECIES.map((s) => s.slug);

function recolour(map: PixelMap, r: Recolour, name: string): PixelMap {
	const legend: Record<string, number> = {};
	for (const [ch, idx] of Object.entries(map.legend))
		legend[ch] = r[idx] ?? idx;
	return { ...map, name, legend };
}

/** Ash puffs and ember sparks for the defeat poof, an ember hit rim, and bleaching kept on nether tones. */
export function netherFxTones(p: NetherPalette): MonsterFxTones {
	const { n } = p;
	return {
		hitOutline: n.emberRed,
		puff: {
			light: n.ashLight,
			fill: n.ashMid,
			shade: n.charLight,
			rim: n.char,
		},
		spark: { core: n.lavaHot, glow: n.emberOrange },
		lightenPool: [p.ink, ...Object.values(n)],
	};
}

export function netherMonsters(p: NetherPalette): NetherMonster[] {
	const fx = netherFxTones(p);
	return SPECIES.map(({ slug, frames, recolour: pick }) => {
		const r = pick(p.n);
		const idle = frames.map((f, i) =>
			recolour(
				f,
				r,
				frames.length === 1 ? `${slug}_nether` : `${slug}_idle${i}_nether`,
			),
		);
		const first = idle[0] as PixelMap;
		return {
			slug,
			idle,
			hit: hitFrame(first, p.colors, `${slug}_hit_nether`, fx),
			defeat: defeatFrames(first, p.colors, `${slug}_defeat`, fx).map(
				(m, i) => ({ ...m, name: `${slug}_defeat${i}_nether` }),
			),
		};
	});
}

/** The species' normal frames, for tests and the review sheet. */
export function normalMonsterFrames(slug: string): PixelMap[] {
	return SPECIES.find((s) => s.slug === slug)?.frames ?? [];
}
