import type { Ability } from './Abilities';
import { Ability as A } from './Abilities';

/**
 * What a condition actually does.
 *
 * The catalog carries thirty-one condition cards -- wounds, survival states, states of
 * mind -- written as prose: "-2 attack, bleeding 1 HP/6 ticks". That prose is what the
 * player reads, and it stays exactly as authored. This is the same thing said in numbers,
 * so that the rest of the game can act on it.
 *
 * Every one of these was sitting in the catalog unreferenced by a single line of the
 * game. A wound that does not change what you can do is a sentence, not a wound.
 */

/** What holding a condition costs. */
export interface ConditionEffect {
  /** Added to attack rolls */
  readonly attack?: number;
  /** Added to every ability check and saving throw */
  readonly checks?: number;
  /** Added to particular abilities, before the modifier is worked out */
  readonly abilities?: Partial<Record<Ability, number>>;
  /** Hit points lost every this many hours; absent means no bleeding */
  readonly bleedEvery?: number;
  /** How much of it is lost each time */
  readonly bleedAmount?: number;
  /** Multiplier on how fast the character covers ground */
  readonly slows?: number;
  /** Cannot leave a fight */
  readonly cannotFlee?: boolean;
  /** Cannot use a weapon that wants both hands */
  readonly oneHanded?: boolean;
  /** Cannot travel at all until it is dealt with */
  readonly grounded?: boolean;
}

/**
 * The numbers behind the prose, keyed by the catalog's own identifiers.
 */
export const CONDITION_EFFECTS: Readonly<Record<string, ConditionEffect>> = {
  // --- wounds -------------------------------------------------------------------
  deep_cut_arm: { attack: -2, bleedEvery: 6, bleedAmount: 1 },
  deep_cut_leg: { abilities: { [A.DEX]: -1 }, slows: 0.5 },
  broken_arm: { attack: -3, oneHanded: true },
  broken_leg: { grounded: true, slows: 0.25 },
  concussion: { abilities: { [A.INT]: -2, [A.WIS]: -2 } },
  cracked_ribs: { abilities: { [A.CON]: -1 }, slows: 0.75 },
  gashed_leg: { bleedEvery: 6, bleedAmount: 2, slows: 0.5 },
  scalp_laceration: { bleedEvery: 12, bleedAmount: 1 },
  burn: { abilities: { [A.DEX]: -1 } },
  infected_wound: { abilities: { [A.CON]: -2 }, checks: -1 },
  frostbite: { abilities: { [A.DEX]: -2 }, attack: -2 },
  sprained_ankle: { abilities: { [A.DEX]: -1 }, slows: 0.6 },

  // --- what the body does to itself ---------------------------------------------
  hungry: { checks: -1 },
  starving: { checks: -2, bleedEvery: 24, bleedAmount: 1 },
  thirsty: { checks: -1 },
  dehydrated: { checks: -2, bleedEvery: 24, bleedAmount: 2 },
  exhausted: { checks: -2, slows: 0.75 },
  sleep_deprived: { checks: -1, abilities: { [A.WIS]: -2 } },
  cold: { abilities: { [A.DEX]: -1 } },
  frostbitten: { abilities: { [A.DEX]: -2 } },
  heat_stroke: { abilities: { [A.CON]: -2 } },

  // --- and what the mind does ----------------------------------------------------
  frightened: { attack: -1, checks: -1 },
  panicked: { checks: -2, attack: -2 },
  grief_stricken: { checks: -3 },
  enraged: { abilities: { [A.STR]: 2, [A.WIS]: -2 }, cannotFlee: true },
  hopeful: { checks: 1 },
  content: { abilities: { [A.CHA]: 1 } },
  depressed: { checks: -2 },
  paranoid: { abilities: { [A.CHA]: -1, [A.WIS]: -1 } },
};

/**
 * The wounds a blow can leave, by how bad the blow was.
 *
 * A scratch does not break a leg. What decides is the share of the character's whole
 * self the hit took: anything over a third of them is the sort of blow that leaves
 * something behind.
 */
export const WOUND_TABLE: readonly { readonly id: string; readonly severity: number }[] = [
  { id: 'scalp_laceration', severity: 0.18 },
  { id: 'deep_cut_arm', severity: 0.22 },
  { id: 'deep_cut_leg', severity: 0.24 },
  { id: 'sprained_ankle', severity: 0.24 },
  { id: 'gashed_leg', severity: 0.3 },
  { id: 'cracked_ribs', severity: 0.32 },
  { id: 'concussion', severity: 0.36 },
  { id: 'broken_arm', severity: 0.42 },
  { id: 'broken_leg', severity: 0.48 },
];

/** Which conditions a night's sleep sees to. */
export const REST_TREATS: readonly string[] = [
  'concussion',
  'cracked_ribs',
  'sprained_ankle',
  'exhausted',
  'sleep_deprived',
  'frightened',
  'panicked',
];

/** Which carried thing sees to which wound. */
export const TREATMENTS: Readonly<Record<string, readonly string[]>> = {
  bandage: ['deep_cut_arm', 'deep_cut_leg', 'gashed_leg', 'scalp_laceration'],
  herbal_poultice: ['deep_cut_arm', 'gashed_leg', 'infected_wound', 'burn'],
  burn_ointment: ['burn'],
  feverfew: ['infected_wound'],
  splint: ['broken_arm', 'broken_leg'],
  needle_thread: ['deep_cut_arm', 'deep_cut_leg', 'gashed_leg'],
  wool_cloak: ['cold'],
  fur_boots: ['frostbite', 'frostbitten'],
};

/**
 * Sums what a set of conditions costs, so the rest of the game asks once.
 *
 * @param held The identifiers the character is holding
 * @returns One effect standing for all of them
 */
export function totalEffect(held: readonly string[]): Required<Omit<ConditionEffect, 'abilities' | 'bleedEvery' | 'bleedAmount'>> & {
  abilities: Partial<Record<Ability, number>>;
} {
  const total = {
    attack: 0,
    checks: 0,
    slows: 1,
    cannotFlee: false,
    oneHanded: false,
    grounded: false,
    abilities: {} as Partial<Record<Ability, number>>,
  };

  for (const id of held) {
    const effect = CONDITION_EFFECTS[id];
    if (!effect) continue;

    total.attack += effect.attack ?? 0;
    total.checks += effect.checks ?? 0;
    // Slowing compounds: a gashed leg and a sprained ankle are worse than either.
    total.slows *= effect.slows ?? 1;
    total.cannotFlee ||= effect.cannotFlee ?? false;
    total.oneHanded ||= effect.oneHanded ?? false;
    total.grounded ||= effect.grounded ?? false;

    for (const [ability, amount] of Object.entries(effect.abilities ?? {})) {
      const key = ability as Ability;
      total.abilities[key] = (total.abilities[key] ?? 0) + amount;
    }
  }

  return total;
}

/**
 * What is bleeding out of the character this hour.
 *
 * @param held What they are holding
 * @param tick The hour
 * @returns Hit points lost this hour
 */
export function bleedingAt(held: readonly string[], tick: number): number {
  let lost = 0;
  for (const id of held) {
    const effect = CONDITION_EFFECTS[id];
    if (!effect?.bleedEvery) continue;
    if (tick % effect.bleedEvery === 0) lost += effect.bleedAmount ?? 1;
  }
  return lost;
}
