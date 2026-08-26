import { MAX_CHARACTER_LEVEL } from '../SimulationConstants';

/**
 * Building an encounter to a budget.
 *
 * The Dungeon Master's Guide sizes a fight against the people who will be in it: every
 * character level has four experience thresholds, one for each grade of encounter, and
 * the monsters are chosen to fit under whichever threshold the table is aiming at. A
 * hard encounter is hard *for these characters*, not hard in the abstract.
 *
 * This game had no such notion. What could be met was decided by the Gallowsmark alone,
 * so a swordsman of the Iron Chain -- a thing worth four hundred and fifty experience --
 * turned up on schedule around the fifth day and killed a second-level character in two
 * blows, which is not a difficulty curve, it is a countdown.
 *
 * So the Mark no longer chooses the monster. It chooses the *grade*: cold country throws
 * easy things, a burning mark throws deadly ones. What can actually appear at that grade
 * is then whatever fits the character's own budget, which climbs as they do.
 */

/** The four grades of encounter, in the source's own terms. */
export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
  DEADLY = 'deadly',
}

/** Difficulty in ascending order, for stepping up and down the scale. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = [
  Difficulty.EASY,
  Difficulty.MEDIUM,
  Difficulty.HARD,
  Difficulty.DEADLY,
];

/**
 * Experience thresholds by character level, straight from the source.
 *
 * Indexed by level, so index 0 is unused and level 1 is the first row. The game stops
 * at fifth level, so the table does too.
 */
const THRESHOLDS: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
];

/**
 * The most experience an encounter of a given grade may be worth for a character.
 *
 * @param level The character's level
 * @param difficulty The grade being aimed at
 * @returns The budget, in the source's experience points
 */
export function budgetFor(level: number, difficulty: Difficulty): number {
  const row = THRESHOLDS[Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(level)))];
  return row[DIFFICULTY_ORDER.indexOf(difficulty)];
}

/**
 * The grade of encounter a stretch of country is throwing at present.
 *
 * The Gallowsmark's five bands map onto the four grades, with the top two bands both
 * deadly: once the mark is open, the country has nothing worse left to send.
 *
 * @param band The Gallowsmark band, from 0 to 4
 * @returns The grade being aimed at
 */
export function difficultyForBand(band: number): Difficulty {
  const index = Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, Math.floor(band)));
  return DIFFICULTY_ORDER[index];
}

/**
 * Reports whether something is worth meeting at a given grade, for a given character.
 *
 * A creature is eligible when it fits the budget. It is also allowed to be a little
 * under, because an encounter that cannot possibly hurt anybody is not an encounter --
 * but only a little, or a fifth-level character would spend the game swatting grave-wicks.
 *
 * @param threatXp What the creature is worth
 * @param level The character's level
 * @param difficulty The grade being aimed at
 * @returns true if it belongs in this fight
 */
export function fitsBudget(
  threatXp: number,
  level: number,
  difficulty: Difficulty
): boolean {
  const ceiling = budgetFor(level, difficulty);
  const floor = budgetFor(level, Difficulty.EASY) / 2;
  return threatXp <= ceiling && threatXp >= floor;
}
