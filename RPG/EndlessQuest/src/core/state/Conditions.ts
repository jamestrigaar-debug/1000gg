import type { GameState } from './GameState';
import type {
  ConditionsComponent,
  HeldCondition,
  StatsComponent,
} from '../ecs/Component';
import type { GameEvent } from '../../events/GameEvent';
import { getCondition } from '../lore/items/Conditions';
import { hurt } from './Harm';
import {
  CONDITION_EFFECTS,
  REST_TREATS,
  TREATMENTS,
  WOUND_TABLE,
  bleedingAt,
  totalEffect,
} from '../rules/Conditions';
import { HOURS_PER_DAY } from '../SimulationConstants';

/**
 * Carrying an injury.
 *
 * The catalog's thirty-one condition cards were written and never applied to anything.
 * This is the machinery that makes them real: a blow that takes a serious share of the
 * character leaves something behind, the meters put states of the body on and take them
 * off, and what is held is felt in every roll, every mile and every fight until it is
 * seen to.
 *
 * The point is that a run accumulates a history. A character on day forty is not a
 * character on day one with different numbers; they are a character with a limp.
 */

/** How long each kind of thing lasts, in hours, where the card gives a duration. */
const DURATIONS: Readonly<Record<string, number>> = {
  scalp_laceration: 12,
  deep_cut_arm: 24,
  deep_cut_leg: 24,
  gashed_leg: 24,
  burn: 48,
  concussion: 48,
  infected_wound: 72,
  sprained_ankle: 72,
  cracked_ribs: 7 * HOURS_PER_DAY,
  broken_arm: 7 * HOURS_PER_DAY,
  frostbite: 7 * HOURS_PER_DAY,
  broken_leg: 14 * HOURS_PER_DAY,
  frightened: 8,
  panicked: 4,
  enraged: 3,
  hopeful: 2 * HOURS_PER_DAY,
  content: HOURS_PER_DAY,
};

/** The states the meters put on and take off, rather than time. */
const NEED_STATES: readonly string[] = [
  'hungry',
  'starving',
  'thirsty',
  'dehydrated',
  'exhausted',
  'sleep_deprived',
];

/**
 * The conditions component, made if the character has not needed one yet.
 *
 * @param state Game state
 * @returns Where their conditions live
 */
export function conditionsOf(state: GameState): ConditionsComponent {
  const existing = state.entities.getComponent<ConditionsComponent>(
    state.playerId,
    'conditions'
  );
  if (existing) return existing;

  const made: ConditionsComponent = { type: 'conditions', held: [] };
  state.entities.addComponent(state.playerId, made);
  return made;
}

/** What the character is holding, by identifier. */
export function heldIds(state: GameState): string[] {
  return conditionsOf(state).held.map((held) => held.id);
}

/** Everything the character's conditions cost them, summed. */
export function conditionPenalties(state: GameState) {
  return totalEffect(heldIds(state));
}

/** Whether the character is holding a particular condition. */
export function holding(state: GameState, id: string): boolean {
  return conditionsOf(state).held.some((held) => held.id === id);
}

/**
 * Puts a condition on the character.
 *
 * @param state Game state
 * @param id Which card
 * @returns The line to log, or null if they already had it
 */
export function inflict(state: GameState, id: string): GameEvent | null {
  const conditions = conditionsOf(state);
  if (conditions.held.some((held) => held.id === id)) return null;

  const card = getCondition(id);
  if (!card) return null;

  const duration = DURATIONS[id];
  const held: HeldCondition = {
    id,
    since: state.tick,
    until: duration === undefined ? null : state.tick + duration,
  };
  conditions.held.push(held);

  return {
    tick: state.tick,
    type: 'danger',
    message: `${card.name}. ${card.effect}.`,
    data: { condition: id, until: held.until },
  };
}

/**
 * Takes a condition off.
 *
 * @param state Game state
 * @param id Which card
 * @param how What saw to it, for the line
 * @returns The line to log, or null if they were not holding it
 */
export function relieve(state: GameState, id: string, how: string): GameEvent | null {
  const conditions = conditionsOf(state);
  const index = conditions.held.findIndex((held) => held.id === id);
  if (index < 0) return null;

  conditions.held.splice(index, 1);
  const card = getCondition(id);

  return {
    tick: state.tick,
    type: 'system',
    message: `${card?.name ?? id}: ${how}`,
    data: { relieved: id },
  };
}

/**
 * Decides whether a blow leaves something behind, and what.
 *
 * A scratch does not break a leg. What decides is the share of the whole character the
 * blow took, so the same sword is far more dangerous to a man who is already half gone.
 *
 * @param state Game state
 * @param damage What the blow took
 * @returns The wound taken, or null
 */
export function woundFrom(state: GameState, damage: number): GameEvent | null {
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (!stats || stats.maxHp <= 0) return null;

  const share = damage / stats.maxHp;
  const candidates = WOUND_TABLE.filter((wound) => share >= wound.severity);
  if (candidates.length === 0) return null;

  // The worst thing the blow could have done, then a roll against how bad it was: even
  // a serious hit usually leaves nothing but the hit itself.
  const worst = candidates[candidates.length - 1];
  if (state.rng.nextFloat() > share) return null;

  return inflict(state, worst.id);
}

/**
 * Runs the conditions for the hours that have passed.
 *
 * Bleeding is taken here so that it happens whether the character is fighting, walking
 * or asleep; what has run its course is taken off; and the states of the body are put on
 * and off to match the meters.
 *
 * @param state Game state
 * @param from The last hour already run
 * @param to The hour now
 * @returns Everything worth saying about it
 */
export function tickConditions(state: GameState, from: number, to: number): GameEvent[] {
  const events: GameEvent[] = [];
  const conditions = conditionsOf(state);
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (!stats) return events;

  for (let tick = from + 1; tick <= to; tick++) {
    const bleeding = bleedingAt(heldIds(state), tick);
    if (bleeding === 0) continue;

    // Bleeding out is dying, and dying is dying: it goes through the one place that
    // knows what nought hit points means, exactly as a blow does.
    const done = hurt(state, bleeding, {
      cause: 'You bled out somewhere nobody was going to find you.',
      canWound: false,
    });

    events.push({
      tick,
      type: 'danger',
      message: `You are still bleeding. (\u2212${bleeding})`,
      data: { bleeding },
    });
    events.push(...done.events);

    if (done.downed) break;
  }

  // What has run its course.
  const lifted = conditions.held.filter((held) => held.until !== null && held.until <= to);
  for (const held of lifted) {
    const event = relieve(state, held.id, 'it has healed as much as it is going to.');
    if (event) events.push(event);
  }

  events.push(...matchNeedStates(state, stats));
  return events;
}

/**
 * Puts the states of the body on and off to match the meters.
 */
function matchNeedStates(state: GameState, stats: StatsComponent): GameEvent[] {
  const events: GameEvent[] = [];

  // The catalog states these as a meter running down; this game counts them up, so the
  // thresholds are read the other way round.
  const wanted = new Set<string>();
  if (stats.hunger >= 70) wanted.add('hungry');
  if (stats.hunger >= 90) wanted.add('starving');
  if (stats.thirst >= 70) wanted.add('thirsty');
  if (stats.thirst >= 90) wanted.add('dehydrated');
  if (stats.fatigue >= 80) wanted.add('exhausted');
  if (stats.fatigue >= 95) wanted.add('sleep_deprived');

  for (const id of NEED_STATES) {
    const has = holding(state, id);
    if (wanted.has(id) && !has) {
      const event = inflict(state, id);
      if (event) events.push(event);
    } else if (!wanted.has(id) && has) {
      const event = relieve(state, id, 'that has passed.');
      if (event) events.push(event);
    }
  }

  return events;
}

/**
 * Sees to whatever a night's sleep sees to.
 *
 * @param state Game state
 * @returns What the rest mended
 */
export function restTreats(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const id of REST_TREATS) {
    if (!holding(state, id)) continue;
    const event = relieve(state, id, 'sleep has taken care of it.');
    if (event) events.push(event);
  }
  return events;
}

/**
 * What a carried thing will see to, if anything.
 *
 * @param itemId What they used
 * @returns The conditions it treats
 */
export function treatedBy(itemId: string): readonly string[] {
  return TREATMENTS[itemId] ?? [];
}

/**
 * Uses a thing on whatever it is good for.
 *
 * @param state Game state
 * @param itemId What was used
 * @returns What it mended
 */
export function applyTreatment(state: GameState, itemId: string): GameEvent[] {
  const events: GameEvent[] = [];
  for (const id of treatedBy(itemId)) {
    if (!holding(state, id)) continue;
    const card = getCondition(id);
    const event = relieve(state, id, `seen to. (${card?.treatment ?? itemId})`);
    if (event) events.push(event);
  }
  return events;
}

/** Whether anything the character holds forbids something. */
export function forbids(state: GameState, what: 'flee' | 'travel' | 'twoHanded'): boolean {
  const total = conditionPenalties(state);
  if (what === 'flee') return total.cannotFlee;
  if (what === 'travel') return total.grounded;
  return total.oneHanded;
}

/** How much a condition slows the character down, as a multiplier on their pace. */
export function pace(state: GameState): number {
  return conditionPenalties(state).slows;
}

/** Whether an identifier names something the game knows how to apply. */
export function isKnownCondition(id: string): boolean {
  return CONDITION_EFFECTS[id] !== undefined;
}
