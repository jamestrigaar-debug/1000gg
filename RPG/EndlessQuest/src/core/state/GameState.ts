import { World } from '../ecs/World';
import { SeededRNG } from '../rng/SeededRNG';
import type { Tile } from '../world/Tile';
import type { Settlement } from '../world/Settlement';
import type { Reckoning } from '../world/Reckoning';
import type { Thread } from '../narrative/Threads';
import type { Person } from '../world/People';
import { populate } from '../world/People';
import type { Errand } from '../narrative/Errands';
import { placeReckoning } from '../world/Reckoning';
import type { CharacterBackground } from '../narrative/Background';
import { FlawTrigger } from '../narrative/Background';
import { getDayPhase, isDaylight } from '../world/TimeOfDay';
import { MARK_BAND_THRESHOLDS } from '../SimulationConstants';
import type { MarkComponent, StatsComponent } from '../ecs/Component';
import { MAP_WIDTH, MAP_HEIGHT } from '../world/Tile';
import type { EntityId } from '../ecs/Entity';
import type { GameEvent } from '../../events/GameEvent';
import type { PositionComponent } from '../ecs/Component';
import {
  HOURS_PER_DAY,
  DAYS_PER_YEAR,
  INITIAL_HOUR,
  INITIAL_DAY,
  INITIAL_YEAR,
  DEFAULT_REVEAL_RADIUS,
} from '../SimulationConstants';

/**
 * Root state interface for EndlessQuest world simulation.
 */
export interface GameState {
  /** Numeric seed used for PRNG initialization */
  seed: number;
  /** String seed identifier */
  seedString: string;
  /** Total elapsed simulation ticks (1 tick = 1 hour) */
  tick: number;
  /** Current world simulation year (1-based) */
  year: number;
  /** Current day of the year (1 to 360) */
  day: number;
  /** Current hour of the day (0 to 23) */
  hour: number;
  /** ECS entity world container */
  entities: World;
  /** 2D grid of world map tiles */
  map: Tile[][];
  /** Named settlements, regenerated from the seed rather than persisted */
  settlements: Settlement[];
  /** Map width in tiles */
  mapWidth: number;
  /** Map height in tiles */
  mapHeight: number;
  /** Seeded pseudorandom number generator */
  rng: SeededRNG;
  /** Chronological history of emitted game events */
  log: GameEvent[];
  /** Primary player EntityId */
  playerId: EntityId;
  /**
   * EntityId of the threat the player is currently engaged with, or null when at
   * liberty. While set, travel and rest commands are refused.
   */
  encounterId: EntityId | null;
  /** Number of combat rounds exchanged in the current encounter */
  encounterRound: number;
  /** Set by a successful feint: the next attack is made with advantage */
  advantageNextAttack: boolean;
  /**
   * Tick until which something is following the character, raising the encounter rate.
   * Set by oracle twists that draw notice; zero when nothing is on the trail.
   */
  stalkedUntil: number;
  /**
   * Identity of the last entry drawn from each narration table, so a small table
   * consulted twice running does not give the same answer twice running.
   */
  lastDraw: Record<string, string>;
  /** True once the player character has died; the world stops advancing */
  gameOver: boolean;
  /** Narration of how the run ended, or null while alive */
  causeOfDeath: string | null;
  /** Who the character was before the rope; null for states created before embark */
  background: CharacterBackground | null;
  /**
   * The gallows-tree and its vigils: the run's objective. Placed from the seed and
   * recomputed on load, though which rites have been kept is progress and is saved.
   */
  reckoning: Reckoning;
  /** True once the debt has been settled at the tree and the character walked away */
  victory: boolean;
  /**
   * Open narrative threads: questions the world has raised and means to come back to.
   * Saved with the run, because a story the reload forgets is not a story.
   */
  threads: Thread[];
  /**
   * The people of the Thornmarch. Generated from the seed like settlements, but what
   * they think of the character is what this run did, so they are saved.
   */
  people: Person[];
  /** What people have asked for, and where each of those asks has got to */
  errands: Errand[];
}

/**
 * Factory creating initial GameState from seed and initialized world objects.
 */
export function createInitialGameState(
  seed: string | number,
  map: Tile[][],
  world: World,
  playerId: EntityId,
  rng: SeededRNG,
  settlements: Settlement[] = [],
  startX: number = 0,
  startY: number = 0
): GameState {
  const seedString = typeof seed === 'string' ? seed : seed.toString();
  const numericSeed = typeof seed === 'number' ? seed : hashString(seed);

  return {
    seed: numericSeed,
    seedString,
    tick: 0,
    year: INITIAL_YEAR,
    day: INITIAL_DAY,
    hour: INITIAL_HOUR,
    entities: world,
    map,
    settlements,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    rng,
    log: [],
    playerId,
    encounterId: null,
    encounterRound: 0,
    stalkedUntil: 0,
    lastDraw: {},
    victory: false,
    threads: [],
    people: populate(seedString, settlements),
    errands: [],
    advantageNextAttack: false,
    gameOver: false,
    causeOfDeath: null,
    background: null,
    reckoning: placeReckoning(seedString, map, startX, startY),
  };
}

/**
 * Advances simulation time by a specified number of hours, updating tick, hour, day, and year.
 * @param state GameState to advance
 * @param hours Number of hours elapsed
 */
export function advanceTime(state: GameState, hours: number): void {
  state.tick += hours;
  state.hour += hours;

  while (state.hour >= HOURS_PER_DAY) {
    state.hour -= HOURS_PER_DAY;
    state.day += 1;
  }

  while (state.day > DAYS_PER_YEAR) {
    state.day -= DAYS_PER_YEAR;
    state.year += 1;
  }
}

/**
 * Deterministically hashes a string into a 32-bit signed integer.
 */
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Returns the tile occupied by the player character.
 * @param state Current GameState
 * @returns Tile or undefined if player has no position or position is out of bounds
 */
export function getCurrentTile(state: GameState): Tile | undefined {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  if (!pos) return undefined;
  if (pos.y < 0 || pos.y >= state.mapHeight || pos.x < 0 || pos.x >= state.mapWidth) return undefined;
  return state.map[pos.y][pos.x];
}

/**
 * Marks tiles within a given Chebyshev radius around (cx, cy) as explored.
 * @param state GameState
 * @param cx Center X
 * @param cy Center Y
 * @param radius Chebyshev radius (defaults to DEFAULT_REVEAL_RADIUS = 1)
 */
export function revealArea(
  state: GameState,
  cx: number,
  cy: number,
  radius: number = DEFAULT_REVEAL_RADIUS
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) continue;
      state.map[y][x].explored = true;
    }
  }
}

/**
 * Determines whether a coordinate lies within a Chebyshev radius of any settlement tile.
 *
 * Settlements are sanctuary: hearthfire, salt at the threshold, and other people's noise
 * all cool the Gallowsmark and suppress the encounter rate.
 *
 * @param state GameState
 * @param cx Center X
 * @param cy Center Y
 * @param radius Chebyshev radius to search
 * @returns true if a settlement tile is within radius
 */
export function isNearSettlement(
  state: GameState,
  cx: number,
  cy: number,
  radius: number
): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) continue;
      if (state.map[y][x].settlement) return true;
    }
  }
  return false;
}

/**
 * Formats a game tick into a standard timestamp string: "Y<year> D<day> <hour>:00".
 * @param tick Simulation tick in hours
 * @returns Formatted time string
 */
export function formatGameTime(tick: number): string {
  const totalHours = tick + INITIAL_HOUR;
  const totalDays = Math.floor(totalHours / HOURS_PER_DAY);
  const hour = totalHours % HOURS_PER_DAY;
  const year = Math.floor(totalDays / DAYS_PER_YEAR) + INITIAL_YEAR;
  const dayOfYear = (totalDays % DAYS_PER_YEAR) + INITIAL_DAY;
  return `Y${year} D${dayOfYear} ${String(hour).padStart(2, '0')}:00`;
}

/**
 * Reports the penalty owed to the character's flaw under present circumstances.
 *
 * A flaw is not a permanent tax: it bites only when its trigger is live, which is what
 * makes it a characterisation rather than a stat. The Fear costs you nothing on an
 * empty road and a great deal once something is on you.
 *
 * @param state Current GameState
 * @returns A non-positive modifier to apply to a check
 */
export function flawModifier(state: GameState): number {
  const flaw = state.background?.flaw;
  if (!flaw) return 0;

  switch (flaw.trigger) {
    case FlawTrigger.ENGAGED:
      return state.encounterId !== null ? flaw.modifier : 0;
    case FlawTrigger.NIGHT:
      return isDaylight(getDayPhase(state.hour)) ? 0 : flaw.modifier;
    case FlawTrigger.WOUNDED: {
      const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
      if (!stats) return 0;
      return stats.hp < stats.maxHp / 2 ? flaw.modifier : 0;
    }
    case FlawTrigger.MARK_BURNING: {
      const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
      if (!mark) return 0;
      const burning = MARK_BAND_THRESHOLDS[MARK_BAND_THRESHOLDS.length - 2] ?? 65;
      return mark.intensity >= burning ? flaw.modifier : 0;
    }
    default:
      return 0;
  }
}
