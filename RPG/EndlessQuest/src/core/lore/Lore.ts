/**
 * Canonical world constants for the Thornmarch setting.
 *
 * These are the fixed proper nouns of the world. Systems reference them so that
 * player-facing text stays consistent as new features are added. Narrative
 * background lives in LORE.md.
 */

/** Name of the borderland the simulation takes place in. */
export const WORLD_NAME = 'the Thornmarch';

/** Name of the current age. */
export const ERA_NAME = 'the Long Dusk';

/** The mark the player character carries. */
export const MARK_NAME = 'the Gallowsmark';

/** The dominant religious institution. */
export const CHURCH_NAME = 'the Church of the Sealed Wound';

/** The Church's inquisitorial arm. */
export const INQUISITION_NAME = 'the Iron Chain';

/** Those who accepted the Choir's bargain. */
export const APOSTLE_NAME = 'the Sated';

/** The five voices that answer an opened Coin. */
export const CHOIR_NAME = 'the Choir';

/** The talisman that opens at the floor of despair. */
export const COIN_NAME = "a Widow's Coin";

/**
 * Season names in calendar order. The simulation year is four 90-day seasons.
 */
export const SEASON_NAMES = ['Thaw', 'High Sun', 'Rot', 'Hard Dark'] as const;

/** Season identifier derived from SEASON_NAMES. */
export type SeasonName = (typeof SEASON_NAMES)[number];

/**
 * Opening text shown when a new character wakes into the world.
 * Rendered once by SimulationLoop at tick 0.
 */
export const OPENING_LINES: readonly string[] = [
  'The rope did not finish its work.',
  'You come to face-down in wet ground with no memory of being cut loose, a black weal closed around your throat that will not fade.',
  `This is ${WORLD_NAME}, in the years men have taken to calling ${ERA_NAME}.`,
  'Something was owed at that tree, and it was not collected. It has not stopped looking.',
];

/**
 * What the character is told about the debt at embark.
 *
 * The bearing is given because the weal knows where it was cut: the one thing the Mark
 * is good for is that it always points home.
 */
export const RECKONING_OPENING: readonly string[] = [
  'You know where the tree is. You have always known, since you woke; the weal tightens when you face it and eases when you turn away.',
  'There are older places between here and there where a debt like yours can be argued down. Find them, or arrive owing all of it.',
];

/**
 * Narration for the reckoning at the tree, kept apart from the tables because it is
 * the one piece of prose in the game that only ever plays once.
 */
export const RECKONING_LINES: readonly string[] = [
  'The tree is smaller than it has been in your head for all these weeks. It is only a tree. The rope is still on it, cut, swinging a little.',
  'You put your hand on the bark and the weal at your throat opens like a mouth.',
];

/** What is said over the character when the debt is finally cut loose. */
export const RECKONING_VICTORY: readonly string[] = [
  'The weal closes. Not fades -- closes, the way a wound closes, leaving the white line of itself behind.',
  'Whatever was owed here has been paid, or refused, and the difference stopped mattering some time ago.',
  'You walk out of the Thornmarch. The road south is only a road, and you are on it, and nothing is following.',
];

/** What is said when the debt is called in instead. */
export const RECKONING_FAILURE: readonly string[] = [
  'The rope does not need to be put round you. You have been wearing it since the day they cut you down.',
  'It collects what it is owed. It takes its time about it.',
];
