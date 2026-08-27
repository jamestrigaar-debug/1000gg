import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { Instance } from './Instance';
import { InstanceKind } from './Instance';
import { settlementAt, nearestSettlement } from '../world/Settlement';
import { peopleAt } from '../world/People';
import { GRUDGE_RANGE, RELIEF_RANGE, REPUTATION_STEP } from '../SimulationConstants';

/**
 * What follows from what.
 *
 * The world knows a few things about itself -- who preys on whom, who is glad to see
 * them stopped, and who will take it personally -- and it reasons from them. Clearing a
 * bandit camp is not a number going up: the villages within a day of it hear about it
 * and are warmer to whoever did it, and whatever was left of the camp takes it up.
 *
 * This is a small ontology rather than a large one, on purpose. Three relations, stated
 * plainly, produce most of the cause and effect a player will ever notice, and every one
 * of them is legible in the log rather than hidden in a score.
 */

/** How the country feels about a kind of place being cleared out. */
interface Reaction {
  /** Whether the parish is glad of it */
  readonly welcome: boolean;
  /** What the neighbours say */
  readonly word: string;
  /** Whether anything is left to hold a grudge */
  readonly survivors: boolean;
}

/** What each sort of place means to the people near it. */
const MEANING: Record<InstanceKind, Reaction> = {
  [InstanceKind.BANDIT_CAMP]: {
    welcome: true,
    word: 'The road is walkable again, and everybody within a day of it knows who walked it.',
    survivors: true,
  },
  [InstanceKind.DUNGEON]: {
    welcome: true,
    word: 'Whatever was coming up out of the ground has stopped coming up.',
    survivors: false,
  },
  [InstanceKind.CAVE]: {
    welcome: true,
    word: 'The stream runs clean again, and the sheep come back off the hill.',
    survivors: false,
  },
  [InstanceKind.RUIN]: {
    welcome: true,
    word: 'The old walls are quiet. People start using the road past them again.',
    survivors: false,
  },
  [InstanceKind.DEEP_WOOD]: {
    welcome: true,
    word: 'The wood lets people through in a straight line again, which it had stopped doing.',
    survivors: false,
  },
  [InstanceKind.HOLDFAST]: {
    // The Iron Chain is not a monster. Putting one of their houses down is a thing with
    // two sides to it, and the parish is not uniformly glad.
    welcome: false,
    word: 'A house of the Iron Chain has been emptied. Nobody says so out loud, and everybody knows.',
    survivors: true,
  },
};

/**
 * Settles what a finished place means to the country around it.
 *
 * @param state Game state, mutated
 * @param instance The place that was finished
 * @returns What the country made of it
 */
export function settleConsequences(state: GameState, instance: Instance): GameEvent[] {
  const meaning = MEANING[instance.kind];
  const events: GameEvent[] = [];

  // Word travels to the parish that had to live next to it.
  const neighbours = state.settlements.filter((settlement) => {
    const away = Math.max(
      Math.abs(settlement.x - instance.x),
      Math.abs(settlement.y - instance.y)
    );
    return away <= RELIEF_RANGE;
  });

  if (neighbours.length === 0) {
    return events;
  }

  const shift = meaning.welcome ? REPUTATION_STEP : -REPUTATION_STEP;
  let moved = 0;

  for (const settlement of neighbours) {
    // The people of the place, if the character has met any of them, think differently
    // of them now. This is what makes a reputation rather than a counter.
    for (const person of peopleAt(state.people, settlement.x, settlement.y)) {
      person.disposition = Math.max(-100, Math.min(100, person.disposition + shift));
      moved++;
    }
    settlement.known = true;
  }

  if (moved > 0) {
    events.push({
      tick: state.tick,
      type: meaning.welcome ? 'system' : 'danger',
      message: `${meaning.word}`,
      data: {
        consequence: instance.kind,
        settlements: neighbours.map((settlement) => settlement.name),
        shift,
      },
    });
  }

  // And whoever got out of it takes it up. A grudge is not a system: it is the country
  // being slightly worse to cross for a while, near where it happened.
  if (meaning.survivors && instance.occupants.some((occupant) => occupant.fled)) {
    state.stalkedUntil = Math.max(state.stalkedUntil, state.tick + GRUDGE_RANGE);
    events.push({
      tick: state.tick,
      type: 'danger',
      message:
        'Not all of them were in there when you finished it, and the ones who were not have somewhere to be.',
      data: { grudge: instance.id, until: state.stalkedUntil },
    });
  }

  return events;
}

/**
 * Whether the character is somewhere the country is currently glad to see them.
 *
 * @param state Game state
 * @returns The settlement, if they are standing in a friendly one
 */
export function amongFriends(state: GameState, x: number, y: number): boolean {
  const here = settlementAt(state.settlements, x, y) ?? nearestSettlement(state.settlements, x, y, 2);
  if (!here) return false;
  return peopleAt(state.people, here.x, here.y).some((person) => person.disposition > 20);
}
