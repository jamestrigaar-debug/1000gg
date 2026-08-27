/**
 * How hard the Thornmarch is.
 *
 * A difficulty setting that only changes a word on a menu is a lie told to the player.
 * Each of these moves numbers the rest of the game already reads: how fast the weal
 * burns, how often the country sends something, how much a body can take, and what is
 * asked of you at the tree.
 *
 * The middle setting is the game as it was measured and balanced -- every multiplier is
 * one. The other two are that game made kinder or crueller, not a different game.
 */
export enum Difficulty {
  /** For somebody learning the country */
  HUNTED = 'hunted',
  /** The game as balanced */
  MARKED = 'marked',
  /** For somebody who has walked out once already */
  DAMNED = 'damned',
}

/**
 * What a difficulty is worth, in the terms the systems use.
 */
export interface DifficultySettings {
  readonly id: Difficulty;
  readonly name: string;
  /** One line on the selection screen */
  readonly line: string;
  /** What it actually changes, said plainly, so the choice is informed */
  readonly terms: readonly string[];
  /** Hit points added at embark */
  readonly bonusHitPoints: number;
  /** Multiplier on how fast the Gallowsmark rises */
  readonly markRise: number;
  /** Multiplier on the hourly chance of meeting something */
  readonly encounterRate: number;
  /** Added to the difficulty of the reckoning at the tree */
  readonly reckoningDC: number;
  /** Multiplier on how fast hunger, thirst and fatigue accrue */
  readonly needsRate: number;
}

/**
 * The three settings.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultySettings> = {
  [Difficulty.HUNTED]: {
    id: Difficulty.HUNTED,
    name: 'Hunted',
    line: 'The rope left its mark, but the country has not made up its mind about you yet.',
    terms: [
      'Eight more hit points at the start',
      'The weal burns slower',
      'Less on the roads, and it finds you less often',
      'The reckoning at the tree asks two less of you',
    ],
    bonusHitPoints: 8,
    markRise: 0.7,
    encounterRate: 0.7,
    reckoningDC: -2,
    needsRate: 0.85,
  },
  [Difficulty.MARKED]: {
    id: Difficulty.MARKED,
    name: 'Marked',
    line: 'The Thornmarch as it is. What was owed is owed in full.',
    terms: [
      'The game as it was balanced and measured',
      'Roughly one run in three is walked out of, if you prepare',
    ],
    bonusHitPoints: 0,
    markRise: 1,
    encounterRate: 1,
    reckoningDC: 0,
    needsRate: 1,
  },
  [Difficulty.DAMNED]: {
    id: Difficulty.DAMNED,
    name: 'Damned',
    line: 'It has stopped waiting to see what you will do.',
    terms: [
      'Four fewer hit points at the start',
      'The weal burns faster and cools harder',
      'More on the roads, and it is looking',
      'The reckoning asks three more of you',
      'Hunger and thirst come on quicker',
    ],
    bonusHitPoints: -4,
    markRise: 1.35,
    encounterRate: 1.4,
    reckoningDC: 3,
    needsRate: 1.2,
  },
};

/**
 * Looks up a setting, defaulting to the balanced one.
 *
 * @param difficulty Which setting, if any
 * @returns What it is worth
 */
export function settingsFor(difficulty: Difficulty | undefined): DifficultySettings {
  return DIFFICULTIES[difficulty ?? Difficulty.MARKED];
}
