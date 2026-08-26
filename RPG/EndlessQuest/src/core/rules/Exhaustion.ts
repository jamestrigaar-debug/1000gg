import { RollMode } from './Check';

/**
 * Exhaustion, measured in six levels.
 *
 * This replaces the bespoke fatigue bar the simulation used to carry. The ladder is a
 * far better fit for a survival game than a percentage: each level bites in a specific,
 * legible way, the effects accumulate, and the sixth is death. A player can look at
 * "Exhaustion 3" and know exactly what is wrong with them.
 *
 * A creature suffers the effect of its current level and every level below it.
 */

/** The level at which a creature dies. */
export const MAX_EXHAUSTION = 6;

/**
 * What each level does, in the order the levels are gained.
 */
export const EXHAUSTION_EFFECTS: readonly string[] = [
  'None',
  'Disadvantage on ability checks',
  'Speed halved',
  'Disadvantage on attack rolls and saving throws',
  'Hit point maximum halved',
  'Speed reduced to zero',
  'Death',
];

/**
 * Narration for arriving at each level, in the register of the setting.
 */
export const EXHAUSTION_LINES: readonly string[] = [
  'The weight comes off you. You can think again.',
  'You are past tired. Small things take two attempts.',
  'Your legs have stopped taking instruction. Every mile is two.',
  'Your hands shake badly enough that you notice it mid-swing.',
  'Something in you is failing. You can feel how much less of you there is.',
  'You cannot go on. You get down because there is nothing else left to do.',
  'You stop.',
];

/**
 * Clamps a level into the valid range.
 * @param level Proposed level
 * @returns Level in [0, MAX_EXHAUSTION]
 */
export function clampExhaustion(level: number): number {
  return Math.max(0, Math.min(MAX_EXHAUSTION, Math.floor(level)));
}

/**
 * Whether this level of exhaustion imposes disadvantage on ability checks.
 * @param level Current level
 * @returns The mode to apply to ability checks
 */
export function checkModeFor(level: number): RollMode {
  return level >= 1 ? RollMode.DISADVANTAGE : RollMode.NORMAL;
}

/**
 * Whether this level imposes disadvantage on attack rolls and saving throws.
 * @param level Current level
 * @returns The mode to apply to attacks and saves
 */
export function attackModeFor(level: number): RollMode {
  return level >= 3 ? RollMode.DISADVANTAGE : RollMode.NORMAL;
}

/**
 * The multiplier applied to hit point maximum at this level.
 * @param level Current level
 * @returns 0.5 once the fourth level is reached, otherwise 1
 */
export function hpMaxMultiplier(level: number): number {
  return level >= 4 ? 0.5 : 1;
}

/**
 * The multiplier applied to travel speed at this level.
 * @param level Current level
 * @returns 0 once the fifth level is reached, 0.5 from the second, otherwise 1
 */
export function speedMultiplier(level: number): number {
  if (level >= 5) return 0;
  if (level >= 2) return 0.5;
  return 1;
}

/**
 * Whether this level of exhaustion is fatal.
 * @param level Current level
 * @returns true at the sixth level
 */
export function isFatal(level: number): boolean {
  return level >= MAX_EXHAUSTION;
}

/**
 * A short label for the status readout.
 * @param level Current level
 * @returns Label such as "Exhausted 3"
 */
export function exhaustionLabel(level: number): string {
  if (level <= 0) return 'Rested';
  return `Exhausted ${level}`;
}
