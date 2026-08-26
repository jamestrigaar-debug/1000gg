import type { RNG } from '../rng/SeededRNG';
import { Ability } from '../rules/Abilities';
import type { AbilityScores } from '../rules/Abilities';
import { Skill } from '../rules/Skills';
import { ABILITY_ORDER, STANDARD_ARRAY } from '../rules/Abilities';

/**
 * Who you were before the rope.
 *
 * A run needs a reason, not just a starting position. Each character is dealt an
 * origin, a goal, a bond, and a flaw: the origin decides what you walk away from the
 * tree carrying, the goal is what keeps you walking, the bond is who you are walking
 * towards, and the flaw is the thing that will eventually cost you.
 *
 * These are narrative first and mechanical second, but they are not decoration: the
 * origin grants starting equipment and a standing modifier, and the flaw takes one
 * back under a named circumstance.
 */

/**
 * Circumstances a flaw can bite under.
 */
export enum FlawTrigger {
  /** When the Gallowsmark is burning */
  MARK_BURNING = 'mark_burning',
  /** When wounded below half */
  WOUNDED = 'wounded',
  /** When something is engaged with you */
  ENGAGED = 'engaged',
  /** After dark */
  NIGHT = 'night',
}

/**
 * What you were, and what it left you with.
 */
export interface Origin {
  readonly id: string;
  readonly name: string;
  /** First-person line, shown in the opening narration */
  readonly line: string;
  /** Catalog item keys granted at embark */
  readonly startingItems: readonly string[];
  /**
   * How the standard array is assigned, best score first.
   *
   * Every character gets the same six numbers; what the origin decides is where they
   * go. A poacher's best score is Dexterity, a soldier's is Strength, and that single
   * choice shapes what the character is good at for the whole run.
   */
  readonly abilityPriority: readonly Ability[];
  /** Skills the origin is trained in, adding the proficiency bonus to those checks */
  readonly skills: readonly Skill[];
  /** Saving throws the origin is trained in */
  readonly saves: readonly Ability[];
}

/**
 * What you are walking towards.
 */
export interface Goal {
  readonly id: string;
  readonly name: string;
  readonly line: string;
}

/**
 * Who you are walking towards.
 */
export interface Bond {
  readonly id: string;
  readonly name: string;
  readonly line: string;
}

/**
 * What will eventually cost you.
 */
export interface Flaw {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  /** Circumstance under which the penalty applies */
  readonly trigger: FlawTrigger;
  /** Penalty applied to checks made under that circumstance; negative */
  readonly modifier: number;
}

/**
 * A dealt character background.
 */
export interface CharacterBackground {
  readonly origin: Origin;
  readonly goal: Goal;
  readonly bond: Bond;
  readonly flaw: Flaw;
}

/**
 * The origins a Thornmarch character can be dealt.
 */
export const ORIGINS: readonly Origin[] = [
  {
    id: 'poacher',
    name: 'Poacher',
    line: 'I took deer off a lord’s land for eleven years. They hanged me for the twelfth.',
    startingItems: ['hunting_knife', 'rope', 'dried_meat'],
    abilityPriority: [Ability.DEX, Ability.WIS, Ability.CON, Ability.STR, Ability.INT, Ability.CHA],
    skills: [Skill.SURVIVAL, Skill.STEALTH, Skill.NATURE],
    saves: [Ability.DEX, Ability.WIS],
  },
  {
    id: 'free_company',
    name: 'Free Company',
    line: 'I carried a bill for whoever was paying. The contract ended. I did not.',
    startingItems: ['short_sword', 'gambeson', 'stale_bread'],
    abilityPriority: [Ability.STR, Ability.CON, Ability.DEX, Ability.CHA, Ability.WIS, Ability.INT],
    skills: [Skill.ATHLETICS, Skill.INTIMIDATION, Skill.PERCEPTION],
    saves: [Ability.STR, Ability.CON],
  },
  {
    id: 'grave_digger',
    name: 'Grave-Digger',
    line: 'I buried this parish for thirty years. They decided I had been putting some aside.',
    startingItems: ['shovel', 'rusty_knife', 'ancient_coin'],
    abilityPriority: [Ability.CON, Ability.STR, Ability.WIS, Ability.INT, Ability.DEX, Ability.CHA],
    skills: [Skill.RELIGION, Skill.ATHLETICS, Skill.INSIGHT],
    saves: [Ability.CON, Ability.WIS],
  },
  {
    id: 'herbalist',
    name: 'Herbalist',
    line: 'I sold cures. One of them failed on the wrong man’s wife, and that was witchcraft.',
    startingItems: ['herbal_poultice', 'feverfew', 'stone_knife'],
    abilityPriority: [Ability.WIS, Ability.INT, Ability.DEX, Ability.CON, Ability.CHA, Ability.STR],
    skills: [Skill.MEDICINE, Skill.NATURE, Skill.SURVIVAL],
    saves: [Ability.WIS, Ability.INT],
  },
  {
    id: 'penitent',
    name: 'Penitent',
    line: 'I confessed to everything they asked. It made no difference to the sentence.',
    startingItems: ['patched_cloak', 'stone_knife', 'waterskin'],
    abilityPriority: [Ability.CHA, Ability.CON, Ability.WIS, Ability.STR, Ability.DEX, Ability.INT],
    skills: [Skill.PERSUASION, Skill.DECEPTION, Skill.INSIGHT],
    saves: [Ability.CHA, Ability.CON],
  },
  {
    id: 'reeve',
    name: 'Reeve',
    line: 'I kept the village accounts. When the tithe came up short, they needed a name to give.',
    startingItems: ['iron_knife', 'copper_coins', 'bread'],
    abilityPriority: [Ability.INT, Ability.CHA, Ability.WIS, Ability.CON, Ability.DEX, Ability.STR],
    skills: [Skill.INVESTIGATION, Skill.PERSUASION, Skill.INSIGHT],
    saves: [Ability.INT, Ability.CHA],
  },
  {
    id: 'drover',
    name: 'Drover',
    line: 'I walked cattle from the high pasture to market and back for twenty years. I knew every road they hanged me on.',
    startingItems: ['walking_stick', 'wool_cloak', 'cheese'],
    abilityPriority: [Ability.CON, Ability.WIS, Ability.STR, Ability.CHA, Ability.DEX, Ability.INT],
    skills: [Skill.ANIMAL_HANDLING, Skill.SURVIVAL, Skill.ATHLETICS],
    saves: [Ability.CON, Ability.STR],
  },
];

/**
 * The goals a character can be dealt.
 */
export const GOALS: readonly Goal[] = [
  { id: 'find_who', name: 'The Names', line: 'I mean to find the men who put me on that tree.' },
  { id: 'go_south', name: 'The Road South', line: 'I mean to get out of the Thornmarch alive.' },
  { id: 'understand', name: 'The Debt', line: 'I mean to learn what was owed at that tree, and to whom.' },
  { id: 'atone', name: 'The Ledger', line: 'I mean to be worth the rope not finishing.' },
  { id: 'find_her', name: 'The Search', line: 'I mean to find the one they took while I was hanging.' },
];

/**
 * The bonds a character can be dealt.
 */
export const BONDS: readonly Bond[] = [
  { id: 'daughter', name: 'A Daughter', line: 'My daughter was sent away before it happened. She is somewhere south, if she is anywhere.' },
  { id: 'brother', name: 'A Brother', line: 'My brother cut me down and ran. I have not forgiven him and I want him alive.' },
  { id: 'priest', name: 'A Priest', line: 'A priest of the Sealed Wound gave me water at the tree, against his orders. I owe him.' },
  { id: 'dog', name: 'A Dog', line: 'The dog waited at the foot of the tree for two days. It is still with me.' },
  { id: 'village', name: 'A Village', line: 'The village that hanged me has children in it. That still counts for something.' },
];

/**
 * The flaws a character can be dealt.
 */
export const FLAWS: readonly Flaw[] = [
  {
    id: 'drink',
    name: 'The Drink',
    line: 'I drink when I am afraid, and I am afraid most nights.',
    trigger: FlawTrigger.NIGHT,
    modifier: -1,
  },
  {
    id: 'rage',
    name: 'The Rage',
    line: 'Once it starts I do not stop, and I do not always know who I have hit.',
    trigger: FlawTrigger.ENGAGED,
    modifier: -1,
  },
  {
    id: 'rope_dreams',
    name: 'The Dreams',
    line: 'I feel the rope every time the mark burns. It takes something out of me.',
    trigger: FlawTrigger.MARK_BURNING,
    modifier: -2,
  },
  {
    id: 'bleeder',
    name: 'The Bleeding',
    line: 'Something in me never closed properly. I bleed longer than other men.',
    trigger: FlawTrigger.WOUNDED,
    modifier: -2,
  },
  {
    id: 'coward',
    name: 'The Fear',
    line: 'I have learned exactly what I will do to keep breathing, and I am not proud of it.',
    trigger: FlawTrigger.ENGAGED,
    modifier: -1,
  },
];

/**
 * Deals a character background.
 * @param rng Seeded generator, so a seed produces the same character
 * @returns The dealt origin, goal, bond, and flaw
 */
export function rollBackground(rng: RNG): CharacterBackground {
  return {
    origin: ORIGINS[rng.nextInt(0, ORIGINS.length - 1)],
    goal: GOALS[rng.nextInt(0, GOALS.length - 1)],
    bond: BONDS[rng.nextInt(0, BONDS.length - 1)],
    flaw: FLAWS[rng.nextInt(0, FLAWS.length - 1)],
  };
}

/**
 * Assigns the standard array according to an origin's priorities.
 *
 * Every character is dealt the same six numbers; the origin decides only where they
 * land. That keeps runs comparable while making the origin the thing that determines
 * what the character is actually good at.
 *
 * @param origin The dealt origin
 * @returns A full set of ability scores
 */
export function assignAbilityScores(origin: Origin): AbilityScores {
  const scores = {} as AbilityScores;
  origin.abilityPriority.forEach((ability, index) => {
    scores[ability] = STANDARD_ARRAY[index] ?? 10;
  });
  // Anything an origin failed to rank falls back to the human average.
  for (const ability of ABILITY_ORDER) {
    if (scores[ability] === undefined) scores[ability] = 10;
  }
  return scores;
}

/**
 * Renders a background as the lines shown at embark.
 * @param background Dealt background
 * @returns Narration lines, in the order they should be shown
 */
export function describeBackground(background: CharacterBackground): string[] {
  return [
    background.origin.line,
    background.goal.line,
    background.bond.line,
    background.flaw.line,
  ];
}
