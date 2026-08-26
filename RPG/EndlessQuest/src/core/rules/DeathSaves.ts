import type { RNG } from '../rng/SeededRNG';
import { rollD20 } from './Dice';

/**
 * Death saving throws.
 *
 * Dropping to zero hit points does not kill you; it puts you on the floor and hands the
 * outcome to fate. Each turn at zero you roll a plain d20 against 10. Three successes
 * and you stabilise, three failures and you die. The rolls need not be consecutive.
 *
 * This is the single most dramatic mechanic in the source rules and it earns its place
 * here: a run does not end on a number reaching zero, it ends on three failed rolls
 * while you are face down in the mud with something standing over you.
 */

/** Target number for a death saving throw. */
export const DEATH_SAVE_DC = 10;
/** Successes needed to stabilise. */
export const DEATH_SAVE_SUCCESSES = 3;
/** Failures that kill. */
export const DEATH_SAVE_FAILURES = 3;

/**
 * A creature's running tally at zero hit points.
 */
export interface DeathSaveState {
  successes: number;
  failures: number;
  /** True once stabilised: still unconscious, but no longer rolling */
  stable: boolean;
}

/**
 * A fresh tally.
 * @returns Zeroed death save state
 */
export function newDeathSaves(): DeathSaveState {
  return { successes: 0, failures: 0, stable: false };
}

/**
 * How a single death saving throw came out.
 */
export type DeathSaveOutcome =
  | 'success'
  | 'failure'
  | 'stabilised'
  | 'died'
  | 'revived';

/**
 * The result of one death saving throw.
 */
export interface DeathSaveResult {
  /** The die face */
  readonly natural: number;
  /** What it meant */
  readonly outcome: DeathSaveOutcome;
  /** Narration for the log */
  readonly message: string;
}

/**
 * Narration for an ordinary success, sampled so a long stretch at zero does not read
 * as the same line four times.
 */
const SUCCESS_LINES: readonly string[] = [
  'You are still breathing. It is not much of a claim but you are making it.',
  'Something in you refuses. Not yet.',
  'The dark comes up and stops short of closing.',
  'You hold on, without deciding to.',
];

/**
 * Narration for an ordinary failure.
 */
const FAILURE_LINES: readonly string[] = [
  'You are going. You can feel the edges of it.',
  'The cold is working inward and you cannot answer it.',
  'Your grip on this is coming loose, finger by finger.',
  'Something lets go, and you do not get it back.',
];

/**
 * Makes one death saving throw and applies it to the tally.
 *
 * A natural 20 puts the character back on their feet with a single hit point. A natural
 * 1 counts as two failures. Neither the successes nor the failures need be consecutive.
 *
 * @param rng Seeded generator
 * @param saves Running tally, mutated in place
 * @returns What the roll meant, with narration
 */
export function rollDeathSave(rng: RNG, saves: DeathSaveState): DeathSaveResult {
  const natural = rollD20(rng);

  if (natural === 20) {
    saves.successes = 0;
    saves.failures = 0;
    saves.stable = false;
    return {
      natural,
      outcome: 'revived',
      message: 'You come back. You are not sure to what, or why, but you are up.',
    };
  }

  if (natural === 1) {
    saves.failures += 2;
    if (saves.failures >= DEATH_SAVE_FAILURES) {
      return { natural, outcome: 'died', message: 'That is the end of it.' };
    }
    return {
      natural,
      outcome: 'failure',
      message: 'You go under hard, and come back up with less of yourself.',
    };
  }

  if (natural >= DEATH_SAVE_DC) {
    saves.successes += 1;
    if (saves.successes >= DEATH_SAVE_SUCCESSES) {
      saves.stable = true;
      return {
        natural,
        outcome: 'stabilised',
        message: 'The bleeding slows. You are not dead. You are not much else either.',
      };
    }
    return {
      natural,
      outcome: 'success',
      message: SUCCESS_LINES[rng.nextInt(0, SUCCESS_LINES.length - 1)],
    };
  }

  saves.failures += 1;
  if (saves.failures >= DEATH_SAVE_FAILURES) {
    return { natural, outcome: 'died', message: 'That is the end of it.' };
  }
  return {
    natural,
    outcome: 'failure',
    message: FAILURE_LINES[rng.nextInt(0, FAILURE_LINES.length - 1)],
  };
}

/**
 * Records damage taken while at zero hit points.
 *
 * Any hit is a failed save, and a critical hit is two. Damage at or above the
 * character's hit point maximum kills outright.
 *
 * @param saves Running tally, mutated in place
 * @param critical Whether the blow was a critical hit
 * @returns true if the tally has reached death
 */
export function damageAtZero(saves: DeathSaveState, critical: boolean): boolean {
  saves.stable = false;
  saves.failures += critical ? 2 : 1;
  return saves.failures >= DEATH_SAVE_FAILURES;
}

/**
 * Reports whether a tally has reached death.
 * @param saves Running tally
 * @returns true once three failures are accumulated
 */
export function isDead(saves: DeathSaveState): boolean {
  return saves.failures >= DEATH_SAVE_FAILURES;
}
