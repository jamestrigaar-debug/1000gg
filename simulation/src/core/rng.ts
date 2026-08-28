/* ============================================================================
 * SEEDED RNG — the simulation's only source of randomness.
 *
 * mulberry32: 32-bit state, one multiply-xorshift round, uniform enough for a
 * match engine and — the point — trivially serialisable. The whole match's
 * randomness is one number, so a replay is {seed, squads, tactics, commands}.
 *
 * Math.random() is banned in src/core. There is a test that greps for it.
 * ========================================================================== */

/** FNV-1a over a string, so seeds can be human-readable ("arsenal-v-spurs-1"). */
export function hashSeed(input: string | number): number {
  let h = 2166136261 >>> 0;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  }

  /** Serialise/restore: a snapshot must be able to carry the stream cursor. */
  getState(): number {
    return this.state >>> 0;
  }
  setState(state: number): void {
    this.state = state >>> 0;
  }
  clone(): Rng {
    const r = new Rng(0);
    r.setState(this.state);
    return r;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller. Two draws per call, no caching — caching
   *  the spare would make the stream position depend on call parity, which
   *  makes determinism fragile under refactors. */
  normal(mean = 0, sd = 1): number {
    const u1 = Math.max(this.next(), Number.MIN_VALUE);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Normal clamped to ±limit sd — execution error should not produce a shot
   *  aimed at the corner flag once in a thousand. */
  clampedNormal(mean: number, sd: number, limitSd = 2.5): number {
    const z = Math.max(-limitSd, Math.min(limitSd, this.normal()));
    return mean + sd * z;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i] as T;
      items[i] = items[j] as T;
      items[j] = a;
    }
    return items;
  }
}
