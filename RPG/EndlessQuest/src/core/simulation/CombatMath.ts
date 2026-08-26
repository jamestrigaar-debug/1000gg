import type { RNG } from '../rng/SeededRNG';
import {
  COMBAT_CRIT_ALPHA,
  COMBAT_DAMAGE_MULTIPLIER_CAP,
  COMBAT_STAMINA_DECAY,
  COMBAT_STAMINA_THRESHOLD,
  COMBAT_BASE_HIT_PROBABILITY,
  COMBAT_CRIT_THRESHOLD,
} from '../SimulationConstants';
import { clamp } from '../../utils/math';

/**
 * Combat mathematics for EndlessQuest, implementing the models specified in
 * "Advanced Simulation Mathematics & Systems Theory" sections 11.3 and 11.4.
 *
 * All stochastic functions take an explicit RNG so that combat remains reproducible.
 */

/**
 * Samples a damage multiplier from a Pareto (power law) distribution.
 *
 * The design document specifies P(X > x) = (x_min / x)^alpha, which yields frequent
 * glancing blows and rare devastating ones. Inverse transform sampling with x_min = 1
 * gives x = U^(-1/alpha) for U uniform on (0, 1].
 *
 * The result is capped by COMBAT_DAMAGE_MULTIPLIER_CAP; the untruncated Pareto has
 * infinite support and would occasionally produce one-shot kills that read as bugs.
 *
 * @param rng Seeded generator
 * @param alpha Shape parameter; lower values produce a heavier tail
 * @returns Damage multiplier in [1, COMBAT_DAMAGE_MULTIPLIER_CAP]
 */
export function sampleDamageMultiplier(rng: RNG, alpha: number = COMBAT_CRIT_ALPHA): number {
  let u = rng.nextFloat();
  // nextFloat returns [0, 1); exclude 0 so the multiplier stays finite.
  if (u === 0) u = Number.EPSILON;
  const multiplier = Math.pow(u, -1 / alpha);
  return Math.min(multiplier, COMBAT_DAMAGE_MULTIPLIER_CAP);
}

/**
 * Applies one round of exponential stamina decay, S(t + 1) = S(t) * e^(-lambda).
 * @param stamina Current stamina
 * @param intensity Activity multiplier; attacking is more costly than defending
 * @returns Stamina after decay, never negative
 */
export function decayStamina(stamina: number, intensity: number = 1): number {
  return Math.max(0, stamina * Math.exp(-COMBAT_STAMINA_DECAY * intensity));
}

/**
 * Converts stamina into a combat effectiveness factor via 1 - exp(-S / S_threshold).
 *
 * The curve is near 1 while stamina is healthy and collapses sharply once a combatant
 * is spent, which is what makes long fights dangerous rather than merely slow.
 *
 * @param stamina Current stamina
 * @returns Effectiveness factor in [0, 1)
 */
export function staminaEffectiveness(stamina: number): number {
  return 1 - Math.exp(-Math.max(0, stamina) / COMBAT_STAMINA_THRESHOLD);
}

/**
 * Computes the probability that an attack lands.
 * @param attackerStamina Attacker's current stamina
 * @param defenderStamina Defender's current stamina
 * @returns Hit probability in [0.05, 0.98]
 */
export function hitProbability(attackerStamina: number, defenderStamina: number): number {
  const attack = staminaEffectiveness(attackerStamina);
  const evade = staminaEffectiveness(defenderStamina);
  // A tiring defender is easier to hit; a tiring attacker is less likely to connect.
  const p = COMBAT_BASE_HIT_PROBABILITY * attack * (1 - 0.35 * evade) + 0.2 * (1 - evade);
  return clamp(p, 0.05, 0.98);
}

/**
 * Resolves the damage dealt by a landed blow.
 * @param baseDamage Attacker's base damage
 * @param attackerStamina Attacker's current stamina
 * @param targetArmor Fraction of damage the target absorbs, in [0, 1)
 * @param rng Seeded generator
 * @returns Object carrying the integral damage dealt and whether it was a critical hit
 */
export function resolveDamage(
  baseDamage: number,
  attackerStamina: number,
  targetArmor: number,
  rng: RNG
): { damage: number; critical: boolean } {
  const multiplier = sampleDamageMultiplier(rng);
  const effectiveness = staminaEffectiveness(attackerStamina);
  const raw = baseDamage * multiplier * effectiveness;
  const afterArmor = raw * (1 - clamp(targetArmor, 0, 0.9));
  return {
    damage: Math.max(1, Math.round(afterArmor)),
    critical: multiplier >= COMBAT_CRIT_THRESHOLD,
  };
}
