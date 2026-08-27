import { SeededRNG } from '../rng/SeededRNG';
import type { Tile } from './Tile';
import { TerrainType } from './TerrainType';
import {
  RECKONING_TREE_MIN_DISTANCE,
  RECKONING_TREE_MAX_DISTANCE,
  VIGIL_COUNT,
  VIGIL_MIN_SEPARATION,
  VIGIL_WANDER,
  VIGIL_PLACEMENT_ATTEMPTS,
} from '../SimulationConstants';

/**
 * A place where the debt can be cut down a notch.
 *
 * Vigils are the run's middle game. They are worth going to because keeping one cools
 * the Gallowsmark for good and makes the reckoning at the tree survivable, and they are
 * dangerous to reach because they sit out in the country where nothing is watching the
 * road for you.
 */
export interface Vigil {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Player-facing name of the site */
  readonly name: string;
  /** What the character does here, narrated when the rite is kept */
  readonly rite: string;
  /** True once the rite has been kept; progress, so it is saved with the run */
  kept: boolean;
}

/**
 * The debt, and the ground it is written on.
 *
 * The gallows-tree is where the run can end standing up. Everything else in the
 * simulation pushes the character toward dying somewhere in the mud; this is the one
 * thing pulling the other way, and it is deliberately a long walk.
 */
export interface Reckoning {
  /** Where the gallows-tree stands */
  readonly treeX: number;
  readonly treeY: number;
  readonly vigils: Vigil[];
}

/**
 * The three sites, in the order they are placed.
 *
 * Kept deliberately few and specific. A hundred procedural shrines would be less of a
 * destination than three named places a player can come to recognise.
 */
const VIGIL_SITES: readonly { id: string; name: string; rite: string }[] = [
  {
    id: 'ossuary',
    name: 'the Ossuary at Kell',
    rite: 'You lay your hands on the stacked dead and say the name you were hanged under. It is the first time you have said it aloud since.',
  },
  {
    id: 'drowned_chapel',
    name: 'the Drowned Chapel',
    rite: 'You wade to the altar-stone with the water at your chest and hold there until the cold has taken everything you can spare.',
  },
  {
    id: 'hanging_stone',
    name: 'the Hanging Stone',
    rite: 'You cut your palm on the old iron ring and let it run into the grooves worn there by everyone who came before you.',
  },
];

/**
 * Terrain a site can be placed on. Water is out, and so is bare mountain: the point is
 * that a player can reach these on foot before the Mark burns through them.
 */
const SITE_TERRAIN: readonly TerrainType[] = [
  TerrainType.PLAINS,
  TerrainType.FOREST,
  TerrainType.HILLS,
  TerrainType.SWAMP,
];

/**
 * Places the tree and the vigils for a world.
 *
 * The draws come from a generator forked off the world seed rather than from the map's
 * own generator, so adding the reckoning to the game did not move a single tile of any
 * world that already existed. Like settlements, the placement is a pure function of the
 * seed and is recomputed on load rather than stored.
 *
 * @param seedString The world seed
 * @param map The generated tile grid
 * @param startX Where the character wakes
 * @param startY Where the character wakes
 * @returns The tree and its vigils
 */
export function placeReckoning(
  seedString: string,
  map: Tile[][],
  startX: number,
  startY: number
): Reckoning {
  const rng = new SeededRNG(`${seedString}:reckoning`);
  const height = map.length;
  const width = map[0]?.length ?? 0;

  const suitable = (x: number, y: number): boolean =>
    y >= 0 && y < height && x >= 0 && x < width && SITE_TERRAIN.includes(map[y][x].terrain);

  // The tree is put as far from the character as the map allows, because the walk is
  // the game. Candidates are drawn and the most distant suitable one is taken.
  let treeX = startX;
  let treeY = startY;
  let bestDistance = -1;
  for (let attempt = 0; attempt < VIGIL_PLACEMENT_ATTEMPTS; attempt++) {
    const x = rng.nextInt(0, width - 1);
    const y = rng.nextInt(0, height - 1);
    if (!suitable(x, y)) continue;

    const distance = chebyshev(x, y, startX, startY);

    // The walk to the tree is a fixed length of run, not a fraction of the map. Taking
    // the furthest candidate found put the tree eighty miles out once the country grew
    // to two hundred and forty squares a side, which turned a tuned endgame into a
    // march nobody survived. What is wanted is a place inside the band: far enough to
    // be a journey, near enough to be a journey anybody comes back from.
    if (distance < RECKONING_TREE_MIN_DISTANCE || distance > RECKONING_TREE_MAX_DISTANCE) {
      // Keep the best near miss, so a cramped map still gets a tree somewhere.
      if (bestDistance < RECKONING_TREE_MIN_DISTANCE && distance > bestDistance) {
        bestDistance = distance;
        treeX = x;
        treeY = y;
      }
      continue;
    }

    bestDistance = distance;
    treeX = x;
    treeY = y;
    break;
  }

  // The vigils are strung along the road rather than scattered over the whole map. A
  // rite the player can only reach by crossing the Thornmarch twice is a rite nobody
  // will ever keep, and the run then has no middle game at all -- so each site is placed
  // a fraction of the way from where the character woke to where the tree stands, pushed
  // off the straight line by a wander so the route is a journey and not a corridor.
  const vigils: Vigil[] = [];
  VIGIL_SITES.slice(0, VIGIL_COUNT).forEach((site, index) => {
    const along = (index + 1) / (VIGIL_COUNT + 1);
    const anchorX = Math.round(startX + (treeX - startX) * along);
    const anchorY = Math.round(startY + (treeY - startY) * along);

    for (let attempt = 0; attempt < VIGIL_PLACEMENT_ATTEMPTS; attempt++) {
      // The wander opens up as attempts fail, so a site whose stretch of road is all
      // water still finds somewhere rather than going unplaced.
      const wander = VIGIL_WANDER + Math.floor(attempt / 40);
      const x = clampTo(anchorX + rng.nextInt(-wander, wander), 0, width - 1);
      const y = clampTo(anchorY + rng.nextInt(-wander, wander), 0, height - 1);
      if (!suitable(x, y)) continue;
      if (chebyshev(x, y, startX, startY) < VIGIL_MIN_SEPARATION) continue;
      if (chebyshev(x, y, treeX, treeY) < VIGIL_MIN_SEPARATION) continue;
      if (vigils.some((v) => chebyshev(x, y, v.x, v.y) < VIGIL_MIN_SEPARATION)) continue;

      vigils.push({ id: site.id, x, y, name: site.name, rite: site.rite, kept: false });
      break;
    }
  });

  return { treeX, treeY, vigils };
}

/**
 * Keeps a coordinate on the map.
 */
function clampTo(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Chebyshev distance, which is the metric the map's four-way movement actually pays.
 */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Finds the vigil standing on a tile, if any.
 * @param reckoning The world's reckoning
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns The vigil on that tile, or undefined
 */
export function vigilAt(reckoning: Reckoning, x: number, y: number): Vigil | undefined {
  return reckoning.vigils.find((v) => v.x === x && v.y === y);
}

/**
 * Reports whether a coordinate is the gallows-tree itself.
 * @param reckoning The world's reckoning
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns true if the tree stands here
 */
export function atTree(reckoning: Reckoning, x: number, y: number): boolean {
  return reckoning.treeX === x && reckoning.treeY === y;
}

/**
 * Counts the rites already kept.
 * @param reckoning The world's reckoning
 * @returns How many vigils have been kept
 */
export function vigilsKept(reckoning: Reckoning): number {
  return reckoning.vigils.filter((v) => v.kept).length;
}

/**
 * Names the compass direction from one point to another.
 *
 * The character can always feel roughly where the tree is -- that is what the weal on
 * their throat is for -- so the bearing is given even through unexplored country, while
 * the distance is left vague enough that they still have to go and look.
 *
 * @param fromX Origin X
 * @param fromY Origin Y
 * @param toX Target X
 * @param toY Target Y
 * @returns A bearing such as "north-east"
 */
export function bearingTo(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return 'here';

  const vertical = Math.abs(dy) * 2 >= Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : '';
  const horizontal = Math.abs(dx) * 2 >= Math.abs(dy) ? (dx < 0 ? 'west' : 'east') : '';

  return [vertical, horizontal].filter(Boolean).join('-');
}

/**
 * Describes how far off something is, in terms a traveller would use.
 * @param distance Chebyshev distance in tiles
 * @returns A phrase such as "a few days' walk"
 */
export function describeDistance(distance: number): string {
  if (distance === 0) return 'here';
  if (distance <= 3) return 'close';
  if (distance <= 10) return 'a day or two off';
  if (distance <= 25) return "a few days' walk";
  return 'far off';
}
