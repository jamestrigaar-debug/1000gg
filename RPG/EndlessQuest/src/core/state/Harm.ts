import type { GameState } from './GameState';
import type { DyingComponent, StatsComponent } from '../ecs/Component';
import type { GameEvent } from '../../events/GameEvent';
import { woundFrom } from './Conditions';

/**
 * What happens when the character is hurt.
 *
 * There were three places that took hit points off the character -- the fight on the
 * road, the Dungeon Master running a room, and whatever was bleeding -- and only one of
 * them knew what to do when the number reached nought. So a character could be beaten to
 * zero inside a dungeon and simply stand there, neither down nor gone, and a stress run
 * of sixty worlds caught them doing it ten times.
 *
 * One place now knows. Everything that hurts the character goes through here, and here
 * is where falling is decided.
 */

/** What a blow did. */
export interface Harm {
  /** Hit points actually taken */
  readonly taken: number;
  /** Whether it put them on the floor */
  readonly downed: boolean;
  /** Whether it finished them outright */
  readonly killed: boolean;
  /** Anything worth saying about it */
  readonly events: readonly GameEvent[];
}

/**
 * Takes hit points off the character and decides what that means.
 *
 * @param state Game state, mutated
 * @param damage What the blow was worth
 * @param options How to treat it
 * @returns What it did
 */
export function hurt(
  state: GameState,
  damage: number,
  options: {
    /** What did it, for the line if it kills them */
    readonly cause: string;
    /** Whether a blow this size can leave a lasting wound */
    readonly canWound?: boolean;
  }
): Harm {
  const events: GameEvent[] = [];
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');

  if (!stats || damage <= 0) {
    return { taken: 0, downed: false, killed: false, events };
  }

  const taken = Math.min(stats.hp, damage);
  stats.hp = Math.max(0, stats.hp - damage);

  if (options.canWound !== false) {
    const wound = woundFrom(state, damage);
    if (wound) events.push(wound);
  }

  if (stats.hp > 0) {
    return { taken, downed: false, killed: false, events };
  }

  // Damage at or beyond what the character can hold kills outright, which is the
  // handbook's rule and the only way a fight ever ends without a roll.
  if (damage >= stats.maxHp) {
    return { taken, downed: true, killed: true, events: [...events, ...die(state, options.cause)] };
  }

  const already = state.entities.getComponent<DyingComponent>(state.playerId, 'dying');
  if (already) {
    return { taken, downed: true, killed: false, events };
  }

  const dying: DyingComponent = { type: 'dying', successes: 0, failures: 0, stable: false };
  state.entities.addComponent(state.playerId, dying);

  events.push({
    tick: state.tick,
    type: 'death',
    message: 'You go down, and the ground comes up to meet you. What happens now is not yours to decide.',
    data: { down: true, cause: options.cause },
  });

  return { taken, downed: true, killed: false, events };
}

/**
 * Ends the run.
 *
 * @param state Game state, mutated
 * @param cause What did it
 * @returns The line
 */
export function die(state: GameState, cause: string): GameEvent[] {
  if (state.gameOver) return [];

  state.gameOver = true;
  state.causeOfDeath = cause;

  return [
    {
      tick: state.tick,
      type: 'death',
      message: cause,
      data: { death: true, cause },
    },
  ];
}
