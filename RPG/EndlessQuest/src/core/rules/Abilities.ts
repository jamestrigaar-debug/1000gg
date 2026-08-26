/**
 * The six abilities.
 *
 * A character in this tradition is fundamentally six numbers; attack rolls, checks,
 * saving throws, carrying capacity, and how long you last without food all derive from
 * them. Scores run 1 to 20 for people, and the modifier is (score - 10) / 2 rounded
 * down.
 */
export enum Ability {
  STR = 'str',
  DEX = 'dex',
  CON = 'con',
  INT = 'int',
  WIS = 'wis',
  CHA = 'cha',
}

/** The abilities in their conventional order. */
export const ABILITY_ORDER: readonly Ability[] = [
  Ability.STR,
  Ability.DEX,
  Ability.CON,
  Ability.INT,
  Ability.WIS,
  Ability.CHA,
];

/** Display names, in the conventional three-letter form. */
export const ABILITY_LABEL: Record<Ability, string> = {
  [Ability.STR]: 'STR',
  [Ability.DEX]: 'DEX',
  [Ability.CON]: 'CON',
  [Ability.INT]: 'INT',
  [Ability.WIS]: 'WIS',
  [Ability.CHA]: 'CHA',
};

/** Full names, for narration. */
export const ABILITY_NAME: Record<Ability, string> = {
  [Ability.STR]: 'Strength',
  [Ability.DEX]: 'Dexterity',
  [Ability.CON]: 'Constitution',
  [Ability.INT]: 'Intelligence',
  [Ability.WIS]: 'Wisdom',
  [Ability.CHA]: 'Charisma',
};

/**
 * A full set of ability scores.
 */
export type AbilityScores = Record<Ability, number>;

/** The standard array, assigned rather than rolled. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Lowest score a character can have. */
export const MIN_ABILITY_SCORE = 1;
/** Highest score an ordinary person reaches. */
export const MAX_ABILITY_SCORE = 20;

/**
 * The modifier for an ability score.
 *
 * @param score Ability score
 * @returns Modifier, (score - 10) / 2 rounded down
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * The modifier for one ability of a set.
 * @param scores Full set of scores
 * @param ability Ability to read
 * @returns The modifier
 */
export function modifierFor(scores: AbilityScores, ability: Ability): number {
  return abilityModifier(scores[ability]);
}

/**
 * Builds a set of scores, defaulting anything unspecified to the human average.
 * @param partial Scores to set
 * @returns A complete set
 */
export function makeAbilityScores(partial: Partial<AbilityScores> = {}): AbilityScores {
  return {
    [Ability.STR]: partial.str ?? 10,
    [Ability.DEX]: partial.dex ?? 10,
    [Ability.CON]: partial.con ?? 10,
    [Ability.INT]: partial.int ?? 10,
    [Ability.WIS]: partial.wis ?? 10,
    [Ability.CHA]: partial.cha ?? 10,
  };
}

/**
 * Proficiency bonus by level.
 *
 * The bonus is +2 at first level and rises by one every four levels thereafter.
 *
 * @param level Character level, at least 1
 * @returns Proficiency bonus
 */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}
