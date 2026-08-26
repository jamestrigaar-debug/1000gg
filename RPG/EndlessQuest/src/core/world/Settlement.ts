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
