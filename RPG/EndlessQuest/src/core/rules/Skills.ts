import { Ability } from './Abilities';

/**
 * Skills, each a focused aspect of one ability.
 *
 * Proficiency in a skill adds the proficiency bonus to checks of its governing
 * ability that involve that aspect, so a check is always named for both: a
 * Wisdom (Survival) check, a Charisma (Intimidation) check.
 *
 * Only the skills the Thornmarch actually calls for are listed. The full set exists in
 * the source rules, but a skill nothing ever rolls is dead weight on the character
 * sheet, and this is a game about walking, starving, and being hunted.
 */
export enum Skill {
  ATHLETICS = 'athletics',
  ACROBATICS = 'acrobatics',
  STEALTH = 'stealth',
  SLEIGHT_OF_HAND = 'sleight_of_hand',
  INVESTIGATION = 'investigation',
  NATURE = 'nature',
  RELIGION = 'religion',
  MEDICINE = 'medicine',
  PERCEPTION = 'perception',
  SURVIVAL = 'survival',
  INSIGHT = 'insight',
  ANIMAL_HANDLING = 'animal_handling',
  DECEPTION = 'deception',
  INTIMIDATION = 'intimidation',
  PERSUASION = 'persuasion',
}

/**
 * The ability that governs each skill.
 */
export const SKILL_ABILITY: Record<Skill, Ability> = {
  [Skill.ATHLETICS]: Ability.STR,
  [Skill.ACROBATICS]: Ability.DEX,
  [Skill.STEALTH]: Ability.DEX,
  [Skill.SLEIGHT_OF_HAND]: Ability.DEX,
  [Skill.INVESTIGATION]: Ability.INT,
  [Skill.NATURE]: Ability.INT,
  [Skill.RELIGION]: Ability.INT,
  [Skill.MEDICINE]: Ability.WIS,
  [Skill.PERCEPTION]: Ability.WIS,
  [Skill.SURVIVAL]: Ability.WIS,
  [Skill.INSIGHT]: Ability.WIS,
  [Skill.ANIMAL_HANDLING]: Ability.WIS,
  [Skill.DECEPTION]: Ability.CHA,
  [Skill.INTIMIDATION]: Ability.CHA,
  [Skill.PERSUASION]: Ability.CHA,
};

/**
 * Display names, for narrating which check was called for.
 */
export const SKILL_NAME: Record<Skill, string> = {
  [Skill.ATHLETICS]: 'Athletics',
  [Skill.ACROBATICS]: 'Acrobatics',
  [Skill.STEALTH]: 'Stealth',
  [Skill.SLEIGHT_OF_HAND]: 'Sleight of Hand',
  [Skill.INVESTIGATION]: 'Investigation',
  [Skill.NATURE]: 'Nature',
  [Skill.RELIGION]: 'Religion',
  [Skill.MEDICINE]: 'Medicine',
  [Skill.PERCEPTION]: 'Perception',
  [Skill.SURVIVAL]: 'Survival',
  [Skill.INSIGHT]: 'Insight',
  [Skill.ANIMAL_HANDLING]: 'Animal Handling',
  [Skill.DECEPTION]: 'Deception',
  [Skill.INTIMIDATION]: 'Intimidation',
  [Skill.PERSUASION]: 'Persuasion',
};

/**
 * Formats a check the way a table would call for it.
 * @param skill Skill being used
 * @returns A phrase such as "Wisdom (Survival)"
 */
export function describeCheck(skill: Skill): string {
  const ability = SKILL_ABILITY[skill];
  const full = {
    [Ability.STR]: 'Strength',
    [Ability.DEX]: 'Dexterity',
    [Ability.CON]: 'Constitution',
    [Ability.INT]: 'Intelligence',
    [Ability.WIS]: 'Wisdom',
    [Ability.CHA]: 'Charisma',
  }[ability];
  return `${full} (${SKILL_NAME[skill]})`;
}
