import type { RNG } from '../rng/SeededRNG';
import { abilityModifier } from './Abilities';
import { HIT_DIE, MAX_CHARACTER_LEVEL, XP_THRESHOLDS } from '../SimulationConstants';
import { roll } from './Dice';

/**
 * Experience and levels.
 *
 * A run in the Thornmarch is a long walk through country that gets worse the further in
 * you go, and a character who never grows cannot finish it: a first-level character
 * meeting a brigand is a first-level character dying to a brigand. Surviving a threat --
 * by killing it, driving it off, or getting away from it -- is what buys the levels that
 * make the far end of the map reachable.
 *
 * The ladder stops at five. This is not a game about becoming powerful; it is a game
 * about becoming just hard enough to kill to walk out.
 */

/**
 * The level a total of experience earns.
 * @param xp Experience earned so far
 * @returns The character level, from 1 to MAX_CHARACTER_LEVEL
 */
export function levelFor(xp: number): number {
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  }
  return Math.min(level, MAX_CHARACTER_LEVEL);
}

/**
 * Experience still owed before the next level.
 * @param xp Experience earned so far
 * @returns Experience remaining, or null at the top of the ladder
 */
export function xpToNext(xp: number): number | null {
  const level = levelFor(xp);
  if (level >= MAX_CHARACTER_LEVEL) return null;
  return XP_THRESHOLDS[level] - xp;
}

/**
 * Rolls the hit points gained on reaching a new level.
 *
 * A hit die plus the Constitution modifier, floored at one, exactly as the handbook has
 * it, so a frail character still gains something for surviving.
 *
 * @param rng Seeded generator
 * @param constitution The character's Constitution score
 * @returns Hit points gained
 */
export function hitPointsGained(rng: RNG, constitution: number): number {
  return Math.max(1, roll(rng, HIT_DIE).total + abilityModifier(constitution));
}
