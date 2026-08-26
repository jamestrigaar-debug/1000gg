import type { RNG } from '../rng/SeededRNG';

/**
 * Skill checks with degrees of success.
 *
 * A binary pass or fail tells the player only whether a number cleared a threshold.
 * A graded outcome tells them a story: the twig that snapped, the bandit who half
 * heard it, the pot they put a foot through. Every uncertain action in the Thornmarch
 * resolves through this so that failure is usually a complication rather than a full
 * stop, in the manner of the solo tabletop games this is modelled on.
 *
 * The curve is 2d6 plus a modifier, which is deliberately bell-shaped: middling,
 * complicated results are common and the extremes are rare.
 */

/**
 * Degrees of success, ordered from worst to best.
 */
export enum CheckOutcome {
  CRITICAL_FAILURE = 'critical_failure',
  FAILURE = 'failure',
  PARTIAL = 'partial',
  SUCCESS = 'success',
  CRITICAL_SUCCESS = 'critical_success',
}

/**
 * Ordered worst to best, for comparisons and for indexing narrative tables.
 */
export const OUTCOME_ORDER: readonly CheckOutcome[] = [
  CheckOutcome.CRITICAL_FAILURE,
  CheckOutcome.FAILURE,
  CheckOutcome.PARTIAL,
  CheckOutcome.SUCCESS,
  CheckOutcome.CRITICAL_SUCCESS,
];

/** Lowest total that still counts as a plain failure rather than a critical one. */
export const FAILURE_THRESHOLD = 3;
/** Lowest total that counts as a partial success. */
export const PARTIAL_THRESHOLD = 6;
/** Lowest total that counts as a success. */
export const SUCCESS_THRESHOLD = 9;
/** Lowest total that counts as a critical success. */
export const CRITICAL_SUCCESS_THRESHOLD = 12;

/**
 * The result of a single check.
 */
export interface CheckResult {
  /** The two individual die faces, kept so the roll can be shown to the player */
  readonly dice: readonly [number, number];
  /** Modifier applied to the dice */
  readonly modifier: number;
  /** Dice plus modifier */
  readonly total: number;
  /** Which band the total fell into */
  readonly outcome: CheckOutcome;
}

/**
 * Rolls 2d6 plus a modifier and classifies the total.
 *
 * @param rng Seeded generator, so a check is reproducible for a given seed
 * @param modifier Situational bonus or penalty applied to the roll
 * @returns The dice, the total, and the degree of success
 */
export function rollCheck(rng: RNG, modifier: number = 0): CheckResult {
  const a = rng.nextInt(1, 6);
  const b = rng.nextInt(1, 6);
  const total = a + b + modifier;

  return {
    dice: [a, b],
    modifier,
    total,
    outcome: classifyTotal(total),
  };
}

/**
 * Maps a check total onto a degree of success.
 * @param total Dice plus modifier
 * @returns The matching outcome band
 */
export function classifyTotal(total: number): CheckOutcome {
  if (total >= CRITICAL_SUCCESS_THRESHOLD) return CheckOutcome.CRITICAL_SUCCESS;
  if (total >= SUCCESS_THRESHOLD) return CheckOutcome.SUCCESS;
  if (total >= PARTIAL_THRESHOLD) return CheckOutcome.PARTIAL;
  if (total >= FAILURE_THRESHOLD) return CheckOutcome.FAILURE;
  return CheckOutcome.CRITICAL_FAILURE;
}

/**
 * Reports whether an outcome yielded anything at all.
 * @param outcome Degree of success
 * @returns true for partial successes and better
 */
export function isAnySuccess(outcome: CheckOutcome): boolean {
  return (
    outcome === CheckOutcome.PARTIAL ||
    outcome === CheckOutcome.SUCCESS ||
    outcome === CheckOutcome.CRITICAL_SUCCESS
  );
}

/**
 * Reports whether an outcome came at a cost.
 *
 * Partial successes count: the point of the band is that the player got what they
 * wanted and something went wrong anyway.
 *
 * @param outcome Degree of success
 * @returns true when the outcome should carry a complication
 */
export function hasComplication(outcome: CheckOutcome): boolean {
  return outcome !== CheckOutcome.SUCCESS && outcome !== CheckOutcome.CRITICAL_SUCCESS;
}

/**
 * Narration for each degree of success, indexed by outcome.
 */
export type OutcomeNarration = Record<CheckOutcome, string>;

/**
 * Selects the narration matching a result.
 * @param narration Table of lines keyed by outcome
 * @param result The check to narrate
 * @returns The line for that degree of success
 */
export function narrate(narration: OutcomeNarration, result: CheckResult): string {
  return narration[result.outcome];
}
