import type { GameState } from '../state/GameState';
import type { PositionComponent, StatsComponent } from '../ecs/Component';
import type { Direction } from '../state/Commands';
import { DIRECTION_DELTAS } from '../state/Commands';
import { TerrainType } from './TerrainType';
import { TERRAIN_NAME } from '../lore/Flavor';
import { settlementAt } from './Settlement';
import { siteAt, sitesInSight } from './Sites';
import type { Site } from './Sites';
import { atTree, vigilAt } from './Reckoning';
import { getDayPhase, DayPhase } from './TimeOfDay';
import {
  FORAGE_WATER_YIELD,
  FORAGE_YIELD,
  HOURS_PER_DAY,
  MAX_STAT_VALUE,
  TRAVEL_STOP_NEED,
} from '../SimulationConstants';
import { Skill } from '../rules/Skills';
import { DC } from '../rules/Check';
import { isAnySuccess } from '../rules/Check';
import { skillCheck } from '../state/Checks';
import { waterWithinReach } from './Water';
import type { GameEvent } from '../../events/GameEvent';

/**
 * Going somewhere.
 *
 * The game used to be played one tile at a time: press north, read a line of grass,
 * press north again. A playtest crossed eleven days that way and met nobody, because a
 * day of walking was fourteen keystrokes and fourteen lines of weather. The country is
 * far too big for that now, and it should be -- what was missing was a way to cover it.
 *
 * A journey is the unit of play. You set a bearing or name a place you know of and you
 * walk until something is worth stopping for: you arrive, or the light goes, or you come
 * up on something standing in the country, or something comes up on you. The steps in
 * between are still simulated in full -- every hour of the clock, every hour of the
 * Mark, every roll of the encounter process -- they are simply not narrated one at a
 * time. What you get instead is an account of the leg.
 */

/**
 * Why a journey stopped.
 *
 * This is the whole design in one type: a journey ends because the world interrupted it,
 * and which interruption it was is the most interesting thing about the leg.
 */
export enum TravelStop {
  /** The distance asked for was covered */
  DONE = 'done',
  /** The place aimed at was reached */
  ARRIVED = 'arrived',
  /** Something is standing here */
  SITE = 'site',
  /** Woodsmoke, and people */
  SETTLEMENT = 'settlement',
  /** Something found you */
  ENCOUNTER = 'encounter',
  /** The light went */
  NIGHTFALL = 'nightfall',
  /** Hunger, thirst or tiredness that should not be walked through */
  NEED = 'need',
  /** The ground refused */
  BLOCKED = 'blocked',
  /** The run ended */
  OVER = 'over',
}

/**
 * What a journey is trying to do.
 */
export interface TravelPlan {
  /** Bearing to hold, when walking by direction */
  readonly direction?: Direction;
  /** Place aimed at, when walking to somewhere known */
  readonly target?: { readonly x: number; readonly y: number; readonly name: string };
  /** Hours to spend at most; a day's march by default */
  readonly hours: number;
  /** Whether to keep walking after dark */
  readonly throughNight: boolean;
}

/**
 * What came of it.
 */
export interface TravelReport {
  readonly stop: TravelStop;
  /** Tiles actually covered */
  readonly distance: number;
  /** Hours the leg took */
  readonly hours: number;
  /** The account of the leg, ready to be logged */
  readonly account: string;
  /** Anything standing where the journey ended, or passed close enough to name */
  readonly seen: readonly Site[];
}

/** Compass bearings in the order a heading is chosen from. */
const BEARINGS: readonly Direction[] = ['north', 'east', 'south', 'west'];

/**
 * Picks the single step that best closes on a target.
 *
 * Deliberately simple: the character walks toward the place and goes round what is in
 * the way, the same way a person does. Anything cleverer would be a pathfinder drawing
 * a route through country the character has never seen.
 *
 * @param state Game state
 * @param from Where they are
 * @param target Where they are going
 * @returns The direction to step, or null if nothing gets closer
 */
export function stepToward(
  state: GameState,
  from: { x: number; y: number },
  target: { x: number; y: number }
): Direction | null {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return null;

  // The bearing that closes the most ground first, then the other axis, then the
  // sidesteps that at least do not lose ground.
  const wanted: Direction[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx !== 0) wanted.push(dx > 0 ? 'east' : 'west');
    if (dy !== 0) wanted.push(dy > 0 ? 'south' : 'north');
  } else {
    if (dy !== 0) wanted.push(dy > 0 ? 'south' : 'north');
    if (dx !== 0) wanted.push(dx > 0 ? 'east' : 'west');
  }
  for (const bearing of BEARINGS) {
    if (!wanted.includes(bearing)) wanted.push(bearing);
  }

  for (const direction of wanted) {
    if (passable(state, from, direction)) return direction;
  }
  return null;
}

/**
 * Whether a step in a direction can be taken at all.
 */
export function passable(
  state: GameState,
  from: { x: number; y: number },
  direction: Direction
): boolean {
  const delta = DIRECTION_DELTAS[direction];
  const x = from.x + delta.dx;
  const y = from.y + delta.dy;
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return false;
  return state.map[y][x].movementCost !== Infinity;
}

/**
 * Chooses the step for the next leg of a journey.
 *
 * A journey by bearing holds the bearing where it can and goes round what it cannot,
 * which is what turns a wall of mountain into a detour rather than a full stop.
 *
 * @param state Game state
 * @param plan What the journey is trying to do
 * @param from Current position
 * @returns The direction to step, or null when there is nowhere to go
 */
export function nextStep(
  state: GameState,
  plan: TravelPlan,
  from: { x: number; y: number }
): Direction | null {
  if (plan.target) return stepToward(state, from, plan.target);
  if (!plan.direction) return null;
  if (passable(state, from, plan.direction)) return plan.direction;

  // Blocked on the bearing: try the two flanks before giving it up.
  const flanks: Record<Direction, readonly Direction[]> = {
    north: ['east', 'west'],
    south: ['east', 'west'],
    east: ['north', 'south'],
    west: ['north', 'south'],
  };
  for (const flank of flanks[plan.direction]) {
    if (passable(state, from, flank)) return flank;
  }
  return null;
}

/**
 * Decides whether the journey should stop where it now stands.
 *
 * @param state Game state, after the step and after the systems have run on it
 * @param plan What the journey is trying to do
 * @param startedTick The tick the leg began on
 * @returns Why it should stop, or null to keep walking
 */
export function shouldStop(
  state: GameState,
  plan: TravelPlan,
  startedTick: number,
  startedInDaylight: boolean = true,
  startedFresh: boolean = true
): TravelStop | null {
  if (state.gameOver) return TravelStop.OVER;
  if (state.encounterId !== null) return TravelStop.ENCOUNTER;

  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  if (!pos) return TravelStop.BLOCKED;

  if (plan.target && pos.x === plan.target.x && pos.y === plan.target.y) {
    return TravelStop.ARRIVED;
  }

  // Woodsmoke and people are always worth stopping for.
  if (settlementAt(state.settlements, pos.x, pos.y)) return TravelStop.SETTLEMENT;

  // So is standing in front of something, the first time.
  const here = siteAt(state.sites, pos.x, pos.y);
  if (here && !here.visited) return TravelStop.SITE;
  if (atTree(state.reckoning, pos.x, pos.y)) return TravelStop.SITE;
  const vigil = vigilAt(state.reckoning, pos.x, pos.y);
  if (vigil && !vigil.kept) return TravelStop.SITE;

  // Walking into the dark is a choice, not a default -- but only the walking *into* it.
  // A leg begun after dark is a character who has already made that choice, and stopping
  // them again every hour turns a night march into a stutter.
  if (
    !plan.throughNight &&
    startedInDaylight &&
    getDayPhase(state.hour) === DayPhase.NIGHT
  ) {
    return TravelStop.NIGHTFALL;
  }

  // Stopping for a need is a warning the first time it is crossed, not a wall. A
  // character who is starving with nothing to eat has to be able to keep walking toward
  // somewhere with food in it -- an earlier version halted twenty-three marches out of
  // forty on a need that could not be relieved, which is not a warning, it is a cage.
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (startedFresh && stats) {
    const worst = Math.max(stats.hunger, stats.thirst, stats.fatigue);
    if (worst >= TRAVEL_STOP_NEED) return TravelStop.NEED;
  }

  if (state.tick - startedTick >= plan.hours) return TravelStop.DONE;
  return null;
}

/**
 * Writes the leg up.
 *
 * One paragraph for a day's walk rather than fourteen lines of weather: what the country
 * was like, what was passed, how far it got, and why it stopped.
 *
 * @param state Game state at the end of the leg
 * @param plan What the journey was trying to do
 * @param stop Why it stopped
 * @param crossed How many tiles of each terrain were covered
 * @param hours Hours the leg took
 * @param passed Sites named along the way
 * @returns The account
 */
export function describeLeg(
  state: GameState,
  plan: TravelPlan,
  stop: TravelStop,
  crossed: Map<TerrainType, number>,
  hours: number,
  passed: readonly Site[],
  villages: readonly string[] = []
): string {
  const distance = [...crossed.values()].reduce((sum, n) => sum + n, 0);
  const heading = plan.target ? `toward ${plan.target.name}` : `${plan.direction}`;

  if (distance === 0) {
    return stop === TravelStop.BLOCKED
      ? `There is no way ${heading} from here.`
      : `You do not get going.`;
  }

  // Named by what most of the walk was through, which is what a person would say.
  const ground = [...crossed.entries()].sort((a, b) => b[1] - a[1])[0];
  const through = ground ? TERRAIN_NAME[ground[0]] : 'the country';
  const span = hours >= 2 ? `${hours} hours` : 'an hour';
  const miles = distance === 1 ? '1 mile' : `${distance} miles`;

  const opening = `You walk ${heading} for ${span}, ${miles} through ${through}.`;
  const named = [...villages, ...passed.map((site) => site.name)];
  const alongside =
    named.length > 0 ? ` You pass ${named.join(', and then ')}.` : '';

  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const here = pos ? siteAt(state.sites, pos.x, pos.y) : undefined;
  const settlement = pos ? settlementAt(state.settlements, pos.x, pos.y) : undefined;

  const ending = ((): string => {
    switch (stop) {
      case TravelStop.ARRIVED:
        return ` You are at ${plan.target?.name ?? 'it'}.`;
      case TravelStop.SETTLEMENT:
        return settlement
          ? ` This is ${settlement.name}. Woodsmoke, and the sound of people who have not yet noticed you.`
          : ' There is woodsmoke ahead.';
      case TravelStop.SITE:
        return here ? ` ${here.detail}` : ' Something stands here.';
      case TravelStop.ENCOUNTER:
        return ' You are not alone.';
      case TravelStop.NIGHTFALL:
        return ' The light goes, and you stop while you can still choose where.';
      case TravelStop.NEED:
        return ' You cannot keep this up without seeing to yourself.';
      case TravelStop.BLOCKED:
        return ' The ground gives out, and you stop rather than swim it.';
      case TravelStop.OVER:
        return '';
      case TravelStop.DONE:
      default:
        break;
    }

    // Nothing interrupted the leg, so the closing line is what can be seen from here:
    // the reason to pick the next bearing.
    const ahead = pos ? sitesInSight(state.sites, pos.x, pos.y) : [];
    if (ahead.length > 0) return ` ${ahead[0].approach}`;
    return '';
  })();

  return `${opening}${alongside}${ending}`;
}

/**
 * The most a body will do in one push before it has to be talked into more.
 *
 * @param stats The character's condition, if they have any
 * @returns Hours of walking
 */
export function marchLimit(stats: StatsComponent | undefined): number {
  if (!stats) return 8;
  const spare = MAX_STAT_VALUE - Math.max(stats.hunger, stats.thirst, stats.fatigue);
  return spare <= 0 ? 1 : 8;
}


/**
 * How hard the country is to live off, by what is growing on it.
 *
 * Straight out of the Guide's wilderness rules: land with food on it gives food up to
 * anybody competent, and land without it does not, however good you are.
 */
export const WATER_ABUNDANCE: Record<TerrainType, number> = {
  [TerrainType.WATER]: 1,
  [TerrainType.SWAMP]: 1,
  [TerrainType.FOREST]: 0.9,
  [TerrainType.PLAINS]: 0.6,
  [TerrainType.HILLS]: 0.5,
  [TerrainType.MOUNTAIN]: 0.35,
};

export const FORAGE_DC: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: DC.EASY,
  [TerrainType.FOREST]: DC.EASY,
  [TerrainType.SWAMP]: DC.MEDIUM,
  [TerrainType.HILLS]: DC.MEDIUM,
  [TerrainType.WATER]: DC.MEDIUM,
  [TerrainType.MOUNTAIN]: DC.HARD,
};

/**
 * Living off the country while crossing it.
 *
 * A march is not a fast, and this is where the survival game actually happens: you are
 * walking anyway, so what the ground will give up as you pass is the difference between
 * arriving and not. An early playtest died of thirst in hill country over three days
 * with no way to do anything about it, because the only way to eat was to stop and
 * spend an hour on a separate action nobody thinks to take while travelling.
 *
 * @param state Game state, mutated
 * @returns What the day's walking turned up
 */
export function forageOnTheMarch(state: GameState): GameEvent | null {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (!pos || !stats) return null;

  const tile = state.map[pos.y]?.[pos.x];
  if (!tile) return null;

  const got: string[] = [];

  // Water first, because it kills first. Anything running is drunk on the spot and the
  // skin is filled; foul water is a decision the player makes deliberately elsewhere.
  const water = waterWithinReach(state, pos.x, pos.y);
  if (water === 'clean' && stats.thirst > 0) {
    got.push(`thirst \u2212${Math.round(stats.thirst)}`);
    stats.thirst = 0;
  }

  // One check, for both, which is how the Guide has it: a day spent moving through
  // country you know how to read turns up something to eat and something to drink.
  //
  // Water used to come only from open water or a spring within a tile of the line of
  // march, which over a stress run of forty worlds meant thirst pinned at a hundred
  // from the fifth day and stayed there for the rest of every run. Dew, rain caught in
  // a cloak, snow, the water in roots -- a person crossing country finds these, and if
  // they cannot, the country is barren and that is the interesting case rather than the
  // default one.
  const check = skillCheck(state, Skill.SURVIVAL, FORAGE_DC[tile.terrain]);
  const found = isAnySuccess(check.outcome);

  if (found && stats.hunger > 0) {
    const fed = Math.min(stats.hunger, FORAGE_YIELD);
    stats.hunger -= fed;
    got.push(`hunger \u2212${Math.round(fed)}`);
  }

  if (found && stats.thirst > 0 && water !== 'clean') {
    // Less than a spring gives, and less in barren country: enough to keep walking,
    // not enough to stop looking for the real thing.
    const drawn = Math.min(stats.thirst, FORAGE_WATER_YIELD * WATER_ABUNDANCE[tile.terrain]);
    stats.thirst -= drawn;
    got.push(`thirst \u2212${Math.round(drawn)}`);
  }

  if (got.length === 0) return null;

  return {
    tick: state.tick,
    type: 'system',
    message: `Living off the country as you walk: ${got.join(', ')}.`,
    data: { foraged: got },
  };
}

/** Whether an hour of the clock crosses into a new day. */
export function crossesDay(fromTick: number, toTick: number): boolean {
  return Math.floor(toTick / HOURS_PER_DAY) !== Math.floor(fromTick / HOURS_PER_DAY);
}
