import type { GameState } from '../state/GameState';
import { advanceTime } from '../state/GameState';
import { removeItem } from '../state/Inventory';
import { getItem } from '../lore/Items';
import { roll } from '../rules/Dice';
import { clamp } from '../../utils/math';
import type { InventoryComponent, MarkComponent, StatsComponent } from '../ecs/Component';
import type { OracleEntry } from './Oracle';
import { ThreadKind, openThread } from './Threads';
import {
  MARK_MAX,
  MARK_MIN,
  MIN_STAT_VALUE,
  STALKED_DURATION_HOURS,
  TWIST_DELAY_DICE,
  TWIST_MARK_RISE,
  TWIST_WOUND_DICE,
} from '../SimulationConstants';

/**
 * Applies what an oracle answer set in motion.
 *
 * A twist that is only narrated is worse than no twist at all: the game tells the player
 * they were hurt, or lost something, or lost the afternoon, and none of it is true, so
 * after a while they stop reading. Every consequence the tables name is spent here
 * against real state, and the cost is handed back as a short tail for the log line so
 * the player can see what it took.
 *
 * @param state Mutable game state
 * @param entry The oracle entry that was rolled
 * @returns A parenthetical describing what it cost, or null if it cost nothing
 */
export function applyTwist(state: GameState, entry: OracleEntry): string | null {
  switch (entry.consequence) {
    case 'mark_rises':
      return raiseMark(state);
    case 'wound':
      return wound(state);
    case 'time_lost':
      return loseTime(state);
    case 'item_lost':
      return loseItem(state);
    case 'observed':
      return stalk(state);
    default:
      return null;
  }
}

/**
 * Fans the Gallowsmark, which is what noise in the dark buys you.
 */
function raiseMark(state: GameState): string | null {
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  if (!mark) return null;

  const before = mark.intensity;
  mark.intensity = clamp(mark.intensity + TWIST_MARK_RISE, MARK_MIN, MARK_MAX);
  if (mark.intensity === before) return null;

  return '(the mark flares)';
}

/**
 * Opens the character up. Small, but it accumulates, and it feeds the Mark through the
 * wound term in MarkSystem.
 */
function wound(state: GameState): string | null {
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (!stats || stats.hp <= 0) return null;

  const damage = roll(state.rng, TWIST_WOUND_DICE).total;
  stats.hp = Math.max(MIN_STAT_VALUE, stats.hp - damage);

  // An open wound is a question the world will come back and ask again.
  openThread(state, ThreadKind.WOUND);

  return `(-${damage} hp)`;
}

/**
 * Spends hours the character did not mean to spend, which is its own kind of damage:
 * the needs keep accruing and the light keeps going.
 */
function loseTime(state: GameState): string | null {
  const hours = roll(state.rng, TWIST_DELAY_DICE).total;
  if (hours <= 0) return null;

  advanceTime(state, hours);
  return `(-${hours}h)`;
}

/**
 * Takes something the character was carrying. Nothing to take is not a twist.
 */
function loseItem(state: GameState): string | null {
  const inventory = state.entities.getComponent<InventoryComponent>(
    state.playerId,
    'inventory'
  );
  if (!inventory) return null;

  const carried = Object.keys(inventory.items);
  if (carried.length === 0) return null;

  const itemId = carried[state.rng.nextInt(0, carried.length - 1)];
  if (!removeItem(inventory, itemId, 1)) return null;

  // What was lost is not gone. It is somewhere, and something may be carrying it.
  openThread(state, ThreadKind.LOST, itemId);

  return `(lost: ${getItem(itemId)?.name ?? itemId})`;
}

/**
 * Marks the character as followed. Being watched is not narration: while it lasts, the
 * encounter rate is raised, so the thing that was watching tends to arrive.
 */
function stalk(state: GameState): string | null {
  state.stalkedUntil = Math.max(state.stalkedUntil, state.tick + STALKED_DURATION_HOURS);
  openThread(state, ThreadKind.FOLLOWED);
  return '(followed)';
}
