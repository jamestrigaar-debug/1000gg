/**
 * A named inhabited place in the Thornmarch.
 *
 * Settlements are sanctuary: the Gallowsmark cools within reach of their hearthfires
 * and the encounter rate collapses. They are also the only place to resupply, which
 * makes reaching one the closest thing the alpha has to an objective.
 *
 * Settlements are a deterministic product of the world seed, so they are regenerated
 * on load rather than stored in saves.
 */
export interface Settlement {
  /** Map X coordinate */
  x: number;
  /** Map Y coordinate */
  y: number;
  /** Generated place name */
  name: string;
  /**
   * Whether the character knows this place is there.
   *
   * A village nobody has told you about is not a destination, it is an accident waiting
   * to happen. Knowing of somewhere is what makes it somewhere to go: the nearest is
   * known at the start because it is the parish that hanged you, and the rest are
   * learned from smoke on the horizon, from finger-posts at crossroads, and from asking.
   */
  known: boolean;
}

/**
 * Learns of the places near a point.
 *
 * How word travels. Standing at a crossroads with a finger-post on it, or in a village
 * where people talk about the next one along, puts those places on the character's map.
 * Before this, the only way to learn of anywhere was to walk within sight of its smoke,
 * which over a stress run of forty worlds meant the character knew of exactly one
 * village at the end of thirty-eight days -- a country of sixty-four places with no way
 * to hear about sixty-three of them.
 *
 * @param settlements Settlement registry, mutated
 * @param x Where the word is heard
 * @param y Where the word is heard
 * @param radius How far the talk carries
 * @returns The names newly learned
 */
export function learnPlacesNear(
  settlements: readonly Settlement[],
  x: number,
  y: number,
  radius: number
): string[] {
  const learned: string[] = [];

  for (const settlement of settlements) {
    if (settlement.known) continue;
    const away = Math.max(Math.abs(settlement.x - x), Math.abs(settlement.y - y));
    if (away > radius) continue;
    settlement.known = true;
    learned.push(settlement.name);
  }

  return learned;
}

/**
 * The places the character knows of.
 * @param settlements Settlement registry
 * @returns Those they could actually set out for
 */
export function knownSettlements(settlements: readonly Settlement[]): Settlement[] {
  return settlements.filter((settlement) => settlement.known);
}

/**
 * Finds the settlement occupying a coordinate, if any.
 * @param settlements Settlement registry
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns The settlement on that tile, or undefined
 */
export function settlementAt(
  settlements: readonly Settlement[],
  x: number,
  y: number
): Settlement | undefined {
  return settlements.find((s) => s.x === x && s.y === y);
}

/**
 * Finds the settlement nearest a coordinate within a Chebyshev radius.
 * @param settlements Settlement registry
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @param radius Maximum Chebyshev distance to consider
 * @returns The nearest settlement in range, or undefined
 */
export function nearestSettlement(
  settlements: readonly Settlement[],
  x: number,
  y: number,
  radius: number
): Settlement | undefined {
  let best: Settlement | undefined;
  let bestDistance = Infinity;

  for (const s of settlements) {
    const distance = Math.max(Math.abs(s.x - x), Math.abs(s.y - y));
    if (distance <= radius && distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }

  return best;
}
