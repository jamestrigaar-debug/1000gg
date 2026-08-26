import type { RNG } from '../rng/SeededRNG';
import { rollD20 } from './Dice';

/**
 * The d20 test: roll a die, add a modifier, compare to a Difficulty Class.
 *
 * This one rule resolves nearly everything uncertain in the game -- ability checks,
 * saving throws, and attack rolls are all the same operation with different names for
 * the target number.
 *
 * Two departures from a bare pass/fail are deliberate. The source rules state that a
 * failed check means either no progress or "progress combined with a setback", which
 * is exactly the graded outcome this game wants, so a near miss is modelled as a
 * setback rather than a blank. And a natural 20 or 1 is called out separately, because
 * fate blessing the novice and cursing the veteran is part of the feel.
 */

/**
 * Whether a roll is made straight, or with a second die.
 */
export enum RollMode {
  NORMAL = 'normal',
  ADVANTAGE = 'advantage',
  DISADVANTAGE = 'disadvantage',
}

/**
 * Degrees of outcome, ordered worst to best.
 */
export enum CheckOutcome {
  CRITICAL_FAILURE = 'critical_failure',
  FAILURE = 'failure',
  SETBACK = 'setback',
  SUCCESS = 'success',
  CRITICAL_SUCCESS = 'critical_success',
}

/**
 * Ordered worst to best, for comparisons and for indexing narration tables.
 */
export const OUTCOME_ORDER: readonly CheckOutcome[] = [
  CheckOutcome.CRITICAL_FAILURE,
  CheckOutcome.FAILURE,
  CheckOutcome.SETBACK,
  CheckOutcome.SUCCESS,
  CheckOutcome.CRITICAL_SUCCESS,
];

/**
 * The standard ladder of Difficulty Classes.
 */
export const DC = {
  VERY_EASY: 5,
  EASY: 10,
  MEDIUM: 15,
  HARD: 20,
  VERY_HARD: 25,
  NEARLY_IMPOSSIBLE: 30,
} as const;

/**
 * How far short of the DC a roll may fall and still count as a setback rather than a
 * clean failure.
 */
export const SETBACK_MARGIN = 4;

/**
 * The result of a d20 test.
 */
export interface CheckResult {
  /** Every d20 rolled; two when rolling with advantage or disadvantage */
  readonly dice: readonly number[];
  /** The die actually used */
  readonly natural: number;
  /** Total modifier applied */
  readonly modifier: number;
  /** Natural die plus modifier */
  readonly total: number;
  /** Target number */
  readonly dc: number;
  /** How the roll was made */
  readonly mode: RollMode;
  /** Whether the total met or beat the DC */
  readonly success: boolean;
  /** Graded outcome, including the natural 20 and natural 1 cases */
  readonly outcome: CheckOutcome;
}

/**
 * Combines two sources of advantage or disadvantage.
 *
 * Per the source rules, having both at once cancels to a straight roll no matter how
 * many of each apply, and multiple sources of the same kind do not stack.
 *
 * @param a First source
 * @param b Second source
 * @returns The mode the roll is actually made at
 */
export function combineModes(a: RollMode, b: RollMode): RollMode {
  if (a === b) return a;
  if (a === RollMode.NORMAL) return b;
  if (b === RollMode.NORMAL) return a;
  // One of each: they cancel.
  return RollMode.NORMAL;
}

/**
 * Folds a list of modes into the one the roll is made at.
 * @param modes Modes from every applicable source
 * @returns The resulting mode
 */
export function resolveModes(modes: readonly RollMode[]): RollMode {
  const advantage = modes.includes(RollMode.ADVANTAGE);
  const disadvantage = modes.includes(RollMode.DISADVANTAGE);
  if (advantage && disadvantage) return RollMode.NORMAL;
  if (advantage) return RollMode.ADVANTAGE;
  if (disadvantage) return RollMode.DISADVANTAGE;
  return RollMode.NORMAL;
}

/**
 * Rolls the d20 for a test, applying advantage or disadvantage.
 *
 * Exactly one extra die is rolled, never more, however many sources apply.
 *
 * @param rng Seeded generator
 * @param mode How the roll is made
 * @returns Every die rolled and the one that counts
 */
export function rollD20Mode(rng: RNG, mode: RollMode): { dice: number[]; natural: number } {
  const first = rollD20(rng);
  if (mode === RollMode.NORMAL) {
    return { dice: [first], natural: first };
  }

  const second = rollD20(rng);
  const natural =
    mode === RollMode.ADVANTAGE ? Math.max(first, second) : Math.min(first, second);
  return { dice: [first, second], natural };
}

/**
 * Makes a d20 test against a DC.
 *
 * @param rng Seeded generator
 * @param modifier Total modifier: ability modifier, proficiency if any, and situation
 * @param dc Target number
 * @param mode How the roll is made
 * @returns The dice, the total, and the graded outcome
 */
export function check(
  rng: RNG,
  modifier: number,
  dc: number,
  mode: RollMode = RollMode.NORMAL
): CheckResult {
  const { dice, natural } = rollD20Mode(rng, mode);
  const total = natural + modifier;
  const success = total >= dc;

  return {
    dice,
    natural,
    modifier,
    total,
    dc,
    mode,
    success,
    outcome: gradeCheck(natural, total, dc),
  };
}

/**
 * Grades a total against a DC.
 *
 * A natural 20 or 1 is decisive regardless of the modifier; otherwise meeting the DC
 * is a success, falling short by a little is a setback, and falling short by a lot is
 * a clean failure.
 *
 * @param natural The die face used
 * @param total Die plus modifier
 * @param dc Target number
 * @returns The graded outcome
 */
export function gradeCheck(natural: number, total: number, dc: number): CheckOutcome {
  if (natural === 20) return CheckOutcome.CRITICAL_SUCCESS;
  if (natural === 1) return CheckOutcome.CRITICAL_FAILURE;
  if (total >= dc) return CheckOutcome.SUCCESS;
  if (total >= dc - SETBACK_MARGIN) return CheckOutcome.SETBACK;
  return CheckOutcome.FAILURE;
}

/**
 * Reports whether an outcome yielded anything.
 * @param outcome Graded outcome
 * @returns true for setbacks and better
 */
export function isAnySuccess(outcome: CheckOutcome): boolean {
  return (
    outcome === CheckOutcome.SETBACK ||
    outcome === CheckOutcome.SUCCESS ||
    outcome === CheckOutcome.CRITICAL_SUCCESS
  );
}

/**
 * Reports whether an outcome came at a cost.
 * @param outcome Graded outcome
 * @returns true when the outcome should carry a complication
 */
export function hasComplication(outcome: CheckOutcome): boolean {
  return outcome !== CheckOutcome.SUCCESS && outcome !== CheckOutcome.CRITICAL_SUCCESS;
}

/**
 * Formats an attack roll, which is read against Armour Class rather than a DC.
 * @param result The attack to describe
 * @returns A phrase such as "d20 17+2 = 19 vs AC 15"
 */
export function describeAttack(result: CheckResult): string {
  return describeRoll(result).replace('vs DC', 'vs AC');
}


/**
 * Formats a roll the way a table would read it aloud.
 * @param result The check to describe
 * @returns A phrase such as "d20 17+2 = 19 vs DC 15"
 */
export function describeRoll(result: CheckResult): string {
  const dice =
    result.dice.length > 1
      ? `${result.dice.join('/')}→${result.natural}`
      : `${result.natural}`;
  const sign = result.modifier >= 0 ? `+${result.modifier}` : `${result.modifier}`;
  return `d20 ${dice}${sign} = ${result.total} vs DC ${result.dc}`;
}
