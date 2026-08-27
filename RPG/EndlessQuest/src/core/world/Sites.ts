import type { RNG } from '../rng/SeededRNG';
import type { Tile } from './Tile';
import { TerrainType } from './TerrainType';
import { InstanceKind } from '../dm/Instance';
import {
  SITE_DENSITY,
  SITE_MIN_SEPARATION,
  SITE_PLACEMENT_ATTEMPTS,
  SITE_MARGIN,
} from '../SimulationConstants';

/**
 * The things that are out there.
 *
 * A country with nothing in it is a country nobody wants to cross. Eleven days of an
 * early playtest turned up six lines of grass ambience on rotation and not one thing
 * worth stopping for, because there was genuinely nothing to stop for: three settlement
 * tiles and three vigils in ten thousand squares.
 *
 * A site is a small, fixed, findable thing standing somewhere in the march. It has a
 * name, it can be seen from a distance, it is worth walking to, and most of them can be
 * used exactly once. They are what turns travel from a walk into a route.
 */

/**
 * What kind of thing is standing there.
 */
export enum SiteKind {
  /** Running water: the difference between a hard week and a dead one */
  SPRING = 'spring',
  /** Somebody's holding, abandoned or not quite */
  FARMSTEAD = 'farmstead',
  /** Stone that outlasted whoever laid it */
  RUIN = 'ruin',
  /** A fire somebody else built, recently or otherwise */
  CAMP = 'camp',
  /** A stone, a post, a hanged man: something that tells you where you are */
  MARKER = 'marker',
  /** Where the road forks, and somebody has said which way is which */
  CROSSROADS = 'crossroads',
  /** Left in the ground by people who did not come back for it */
  CACHE = 'cache',
}

/**
 * One named thing standing in the country.
 */
export interface Site {
  readonly id: string;
  readonly kind: SiteKind;
  readonly x: number;
  readonly y: number;
  /** What it is called, once you are close enough to call it anything */
  readonly name: string;
  /** What you see on the approach, before you get there */
  readonly approach: string;
  /** What it is like to stand in it */
  readonly detail: string;
  /** Whether the character has stood here */
  visited: boolean;
  /**
   * Whether the character has laid eyes on it from a distance.
   *
   * Seeing is enough to make somewhere a destination. Before this, a journey could only
   * be aimed at a place already stood in, so the ruin on the skyline was scenery: a
   * stress run of forty worlds entered a grand total of nought instances.
   */
  seen: boolean;
  /** Whether whatever it had has been taken */
  spent: boolean;
  /**
   * What sort of adventure is behind it, if it is a way in to one.
   *
   * The country is the first layer of the game and these are the doors to the second.
   * A ruin you can only look at is scenery; a ruin you can go into is somewhere to go.
   */
  readonly instance?: InstanceKind;
}

/** How far off a site announces itself, in tiles. */
export const SITE_SIGHT = 3;

/**
 * The sites that are ways in rather than things to look at.
 *
 * A spring is a spring. A ruin has something under it, a cave goes down, and a camp has
 * people in it who would rather you had not come.
 */
export const SITE_INSTANCE: Partial<Record<SiteKind, InstanceKind>> = {
  [SiteKind.RUIN]: InstanceKind.RUIN,
  [SiteKind.CAMP]: InstanceKind.BANDIT_CAMP,
  [SiteKind.CACHE]: InstanceKind.CAVE,
  [SiteKind.FARMSTEAD]: InstanceKind.DUNGEON,
};

/**
 * The terrain each kind of site is found in. An empty list means anywhere passable.
 */
const SITE_TERRAIN: Record<SiteKind, readonly TerrainType[]> = {
  [SiteKind.SPRING]: [TerrainType.HILLS, TerrainType.FOREST, TerrainType.MOUNTAIN],
  [SiteKind.FARMSTEAD]: [TerrainType.PLAINS, TerrainType.HILLS],
  [SiteKind.RUIN]: [TerrainType.PLAINS, TerrainType.HILLS, TerrainType.FOREST],
  [SiteKind.CAMP]: [TerrainType.FOREST, TerrainType.PLAINS, TerrainType.HILLS],
  [SiteKind.MARKER]: [TerrainType.PLAINS, TerrainType.HILLS, TerrainType.MOUNTAIN],
  [SiteKind.CROSSROADS]: [TerrainType.PLAINS, TerrainType.HILLS],
  [SiteKind.CACHE]: [TerrainType.FOREST, TerrainType.SWAMP, TerrainType.HILLS],
};

/** Roughly how often each kind turns up, as a share of all sites. */
const SITE_WEIGHT: Record<SiteKind, number> = {
  [SiteKind.SPRING]: 5,
  [SiteKind.FARMSTEAD]: 4,
  [SiteKind.RUIN]: 3,
  [SiteKind.CAMP]: 3,
  [SiteKind.MARKER]: 3,
  [SiteKind.CROSSROADS]: 2,
  [SiteKind.CACHE]: 2,
};

/**
 * Names, and what each kind looks like coming up on it and standing in it.
 *
 * Written per kind rather than per site so that the country can carry hundreds of these
 * without hundreds of hand-written entries, and still not repeat itself within a run.
 */
const SITE_WORDS: Record<
  SiteKind,
  { readonly names: readonly string[]; readonly approach: readonly string[]; readonly detail: readonly string[] }
> = {
  [SiteKind.SPRING]: {
    names: ['the Cold Well', 'Ladywater', 'the Seep', 'Thirstmen’s Head', 'the Weeping Rock'],
    approach: [
      'Green, where the rest of it is not. Something is running down there.',
      'A line of alder in country that has no business growing alder.',
    ],
    detail: [
      'Water coming out of the rock, cold enough to hurt the teeth. Somebody has set a flat stone to kneel on.',
      'A spring in a cut of the hill, running clear and running all year by the look of the moss.',
    ],
  },
  [SiteKind.FARMSTEAD]: {
    names: ['the Long Acre', 'Marrow’s Holding', 'the Orchard', 'Ninefields', 'the Steading'],
    approach: [
      'Straight lines, a long way off. Nothing in nature is that straight.',
      'A roof, or most of one, and no smoke coming off it.',
    ],
    detail: [
      'A holding gone over: the door off, the thatch down at one end, and the garden still trying.',
      'Byre, house and midden, all of it standing and none of it lived in since the spring.',
    ],
  },
  [SiteKind.RUIN]: {
    names: ['the Old Keep', 'Stonefall', 'the Broken Course', 'Kell’s Wall', 'the Watchtower'],
    approach: [
      'Squared stone on the skyline, and nothing squares stone but people.',
      'A tooth of masonry standing where nothing else does.',
    ],
    detail: [
      'Cut stone, courses still true at the base, and everything above it come down into the nettles.',
      'What is left of a tower. The stair goes up eleven steps and then goes nowhere.',
    ],
  },
  [SiteKind.CAMP]: {
    names: ['the Cold Fire', 'Drovers’ Ground', 'the Bivouac', 'Three Stones', 'the Lee'],
    approach: [
      'Smoke, or the memory of it, hanging where the ground dips.',
      'The grass is flat in a circle. Somebody slept here.',
    ],
    detail: [
      'A fire ring, ash gone grey, and the marks of three men who did not stay the night.',
      'A camp with its back to a bank, well chosen. Whoever picked it knew the country.',
    ],
  },
  [SiteKind.MARKER]: {
    names: ['the Standing Man', 'the Tithe Stone', 'the Hanging Post', 'Greystone', 'the Mile Cross'],
    approach: [
      'One stone upright where all the others are lying down.',
      'A shape on the ridge that does not move when you move.',
    ],
    detail: [
      'A stone twice your height, cut with a hand and a wound, and nobody has cleared the base in years.',
      'A post with a crosspiece, set deep. It has been used for what posts like this get used for.',
    ],
  },
  [SiteKind.CROSSROADS]: {
    names: ['the Four Ways', 'Gallowsmeet', 'the Fork', 'Beggar’s Cross', 'the Turning'],
    approach: [
      'Two tracks running together, and the ground beaten hard where they meet.',
      'A finger-post, a long way off, leaning.',
    ],
    detail: [
      'Where the roads cross, with a board nailed up naming what is down each of them and how far.',
      'A crossing, with the ruts deep enough to tell you which way most people choose.',
    ],
  },
  [SiteKind.CACHE]: {
    names: ['the Hollow Oak', 'the Dry Stone', 'Poacher’s Bank', 'the Sunk Barrel', 'the Notch'],
    approach: [
      'A mark cut in the bark at shoulder height, and a newer one under it.',
      'Stones stacked in a way that stones do not stack themselves.',
    ],
    detail: [
      'A hollow under the roots, lined with slate, with the lid still on it.',
      'Somebody buried this and meant to come back. They marked it well and they did not come back.',
    ],
  },
};

/**
 * Scatters sites across the country.
 *
 * @param map The generated terrain
 * @param rng Seeded generator, so a seed produces the same country
 * @param avoid Coordinates nothing may be placed on, such as settlements and vigils
 * @returns Every site in the march
 */
export function generateSites(
  map: Tile[][],
  rng: RNG,
  avoid: readonly { x: number; y: number }[] = []
): Site[] {
  const height = map.length;
  const width = map[0]?.length ?? 0;
  const target = Math.round((width * height) / SITE_DENSITY);

  const kinds = pickList();
  const sites: Site[] = [];
  const taken = new Set(avoid.map((place) => `${place.x},${place.y}`));
  const used: Record<string, Set<string>> = {};

  let attempts = 0;
  while (sites.length < target && attempts < target * SITE_PLACEMENT_ATTEMPTS) {
    attempts++;

    const x = rng.nextInt(SITE_MARGIN, width - 1 - SITE_MARGIN);
    const y = rng.nextInt(SITE_MARGIN, height - 1 - SITE_MARGIN);
    const tile = map[y]?.[x];
    if (!tile || tile.settlement) continue;
    if (taken.has(`${x},${y}`)) continue;

    const kind = kinds[rng.nextInt(0, kinds.length - 1)];
    const allowed = SITE_TERRAIN[kind];
    if (allowed.length > 0 && !allowed.includes(tile.terrain)) continue;

    // Sites standing in each other's pockets read as one cluttered place rather than
    // as several worth walking between.
    if (sites.some((site) => chebyshev(site.x, site.y, x, y) < SITE_MIN_SEPARATION)) continue;

    const words = SITE_WORDS[kind];
    const seen = (used[kind] ??= new Set());
    const name = drawName(words.names, seen, rng, sites.length);

    sites.push({
      id: `${kind}-${sites.length}`,
      kind,
      x,
      y,
      name,
      approach: words.approach[rng.nextInt(0, words.approach.length - 1)],
      detail: words.detail[rng.nextInt(0, words.detail.length - 1)],
      visited: false,
      seen: false,
      spent: false,
      instance: SITE_INSTANCE[kind],
    });
    taken.add(`${x},${y}`);
  }

  return sites;
}

/**
 * Builds the weighted list the placement draws kinds from.
 */
function pickList(): SiteKind[] {
  const list: SiteKind[] = [];
  for (const kind of Object.values(SiteKind)) {
    for (let i = 0; i < SITE_WEIGHT[kind]; i++) list.push(kind);
  }
  return list;
}

/**
 * Draws a name, and qualifies it once the pool has been used up, so that a country with
 * forty springs in it does not have four called Ladywater with nothing to tell them apart.
 */
function drawName(
  pool: readonly string[],
  seen: Set<string>,
  rng: RNG,
  ordinal: number
): string {
  const base = pool[rng.nextInt(0, pool.length - 1)];
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  const qualifiers = ['Upper', 'Lower', 'Far', 'Old', 'Little', 'North', 'South'];
  const qualifier = qualifiers[(ordinal + rng.nextInt(0, qualifiers.length - 1)) % qualifiers.length];
  const qualified = base.startsWith('the ')
    ? `the ${qualifier} ${base.slice(4)}`
    : `${qualifier} ${base}`;
  seen.add(qualified);
  return qualified;
}

/** Chebyshev distance, which is how this game measures a walk. */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Sites indexed by where they stand, so looking one up is not a walk of the whole march.
 *
 * There are several hundred sites and they are consulted on every step of every journey
 * -- for what is underfoot, for what is in sight, and for whether there is water within
 * reach. Scanning the array each time made the country's size cost something it should
 * not. The index is built once per array and thrown away with it.
 */
const INDEX = new WeakMap<readonly Site[], Map<string, Site>>();

/**
 * The lookup table for a set of sites, built on first use.
 */
function indexOf(sites: readonly Site[]): Map<string, Site> {
  let index = INDEX.get(sites);
  if (!index) {
    index = new Map(sites.map((site) => [`${site.x},${site.y}`, site]));
    INDEX.set(sites, index);
  }
  return index;
}

/**
 * The site standing on a tile, if any.
 * @param sites Every site in the march
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns The site there, or undefined
 */
export function siteAt(sites: readonly Site[], x: number, y: number): Site | undefined {
  return indexOf(sites).get(`${x},${y}`);
}

/**
 * Sites of a kind within a distance of a point.
 *
 * Walks the small square around the point rather than the whole country, which is what
 * makes it cheap enough to ask on every step.
 *
 * @param sites Every site in the march
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @param radius How far to look, in tiles
 * @param kind Which sort of site, if only one sort is wanted
 * @returns The first match, or undefined
 */
export function siteNear(
  sites: readonly Site[],
  x: number,
  y: number,
  radius: number,
  kind?: SiteKind
): Site | undefined {
  const index = indexOf(sites);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const found = index.get(`${x + dx},${y + dy}`);
      if (found && (kind === undefined || found.kind === kind)) return found;
    }
  }
  return undefined;
}

/**
 * Sites close enough to be seen from a position.
 *
 * @param sites Every site in the march
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @param radius How far the eye carries here
 * @returns Sites in sight, nearest first, excluding one underfoot
 */
export function sitesInSight(
  sites: readonly Site[],
  x: number,
  y: number,
  radius: number = SITE_SIGHT
): Site[] {
  const index = indexOf(sites);
  const found: Site[] = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const site = index.get(`${x + dx},${y + dy}`);
      if (site) found.push(site);
    }
  }

  return found.sort((a, b) => chebyshev(a.x, a.y, x, y) - chebyshev(b.x, b.y, x, y));
}
