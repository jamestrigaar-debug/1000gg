import type { RNG } from '../rng/SeededRNG';

/**
 * Draws from a table without immediately repeating the last answer.
 *
 * Small tables consulted often start to sound like a machine: a playtest drew the same
 * shepherd's crook eight times in one run. A single re-draw when the first pick matches
 * what was last drawn is enough to break that up while keeping the cost in random
 * numbers bounded and predictable, which matters because the draw has to stay
 * deterministic for a given seed.
 *
 * The memory lives on the game state rather than in this module, so it is saved with
 * the run and a loaded game goes on drawing exactly as an uninterrupted one would.
 *
 * @param pool Entries to choose among
 * @param rng Seeded generator
 * @param memory Map of table key to the identity of the last entry drawn
 * @param key Identifies which table is being drawn from
 * @param identify Reduces an entry to a stable string, for comparison
 * @returns The entry drawn
 */
export function drawWithoutRepeat<T>(
  pool: readonly T[],
  rng: RNG,
  memory: Record<string, string>,
  key: string,
  identify: (entry: T) => string
): T {
  if (pool.length === 0) throw new Error(`Cannot draw from the empty table "${key}"`);
  if (pool.length === 1) return pool[0];

  let choice = pool[rng.nextInt(0, pool.length - 1)];
  if (identify(choice) === memory[key]) {
    choice = pool[rng.nextInt(0, pool.length - 1)];
  }

  memory[key] = identify(choice);
  return choice;
}
