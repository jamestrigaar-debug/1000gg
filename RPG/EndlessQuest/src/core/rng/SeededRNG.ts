/**
 * SeededRNG - xoshiro256++ 1.0 implementation with Box-Muller Gaussian support.
 *
 * Based on the algorithm by David Blackman and Sebastiano Vigna (2021).
 * Reference: http://prng.di.unimi.it/xoshiro256plusplus.c
 * Paper: Blackman & Vigna, "Scrambled Linear Pseudorandom Number Generators"
 *
 * xoshiro256++ is a high-speed, 64-bit multi-generator with a period of 2^256 - 1,
 * passing BigCrush and stringent randomness test batteries.
 *
 * Internal state uses 4x 64-bit words represented as JavaScript BigInt.
 * Box-Muller transform is used for standard normal deviates with complete state serialization.
 */

export interface RNG {
  /**
   * Generates a random integer in the range [min, max] (inclusive).
   * @param min Minimum integer bound
   * @param max Maximum integer bound
   * @returns Uniformly distributed integer between min and max
   */
  nextInt(min: number, max: number): number;

  /**
   * Generates a random floating-point number in [0, 1).
   * Uses 53 bits of precision matching IEEE 754 double precision.
   * @returns Uniformly distributed float in [0, 1)
   */
  nextFloat(): number;

  /**
   * Generates a standard normal random variable (mean = 0, standard deviation = 1)
   * using the Box-Muller polar transform.
   * @returns Gaussian distributed number with mean 0 and std 1
   */
  nextGaussian(): number;

  /**
   * Creates an independent child RNG stream deterministically derived from current state.
   * @returns New independent SeededRNG instance
   */
  fork(): SeededRNG;

  /**
   * Serializes current RNG state and cached Gaussian deviate into a Uint32Array.
   * @returns Uint32Array representation of state
   */
  getState(): Uint32Array;

  /**
   * Restores RNG state from a previously serialized Uint32Array.
   * @param state Uint32Array containing serialized state
   */
  setState(state: Uint32Array): void;
}

export class SeededRNG implements RNG {
  // 4 x 64-bit state words
  private s: [bigint, bigint, bigint, bigint];
  // Cached second value from Box-Muller transform
  private gaussianSpare: number | null = null;

  private static readonly MASK64 = (1n << 64n) - 1n;

  /**
   * Constructs a new SeededRNG from a string or numeric seed.
   * String seeds are hashed deterministically via xmur3 followed by splitmix64 expansion.
   * @param seed Seed identifier (string or number)
   */
  constructor(seed: string | number) {
    this.s = SeededRNG.seedToState(seed);
  }

  /**
   * Converts a seed into a 256-bit (4x 64-bit) initial state vector.
   * @param seed Input seed
   * @returns 4-element BigInt tuple representing internal state
   */
  private static seedToState(seed: string | number): [bigint, bigint, bigint, bigint] {
    let seedNum: number;
    if (typeof seed === 'string') {
      seedNum = SeededRNG.xmur3(seed);
    } else {
      seedNum = seed >>> 0;
      if (!Number.isFinite(seedNum)) seedNum = 0;
    }

    // Expand 32-bit seed via splitmix64
    let x = BigInt(seedNum) + 0x9e3779b97f4a7c15n;
    const states: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      x = SeededRNG.splitmix64(x);
      states.push(x);
    }

    // xoshiro256++ requires at least one non-zero state word
    let allZero = true;
    for (let i = 0; i < 4; i++) {
      if (states[i] !== 0n) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      states[0] = 1n;
    }

    return states as [bigint, bigint, bigint, bigint];
  }

  /**
   * xmur3 string hash producing a 32-bit unsigned integer.
   * @param str Input string
   * @returns 32-bit hash value
   */
  private static xmur3(str: string): number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * splitmix64 generator for initial state expansion.
   * @param x Current 64-bit BigInt state
   * @returns Next 64-bit BigInt state
   */
  private static splitmix64(x: bigint): bigint {
    let z = (x + 0x9e3779b97f4a7c15n) & SeededRNG.MASK64;
    z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & SeededRNG.MASK64;
    z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & SeededRNG.MASK64;
    return (z ^ (z >> 31n)) & SeededRNG.MASK64;
  }

  /**
   * 64-bit bitwise left rotation.
   * @param x 64-bit value
   * @param k Number of bits to rotate
   * @returns Rotated 64-bit value
   */
  private static rotl(x: bigint, k: bigint): bigint {
    return ((x << k) | (x >> (64n - k))) & SeededRNG.MASK64;
  }

  /**
   * Computes the next 64-bit pseudorandom integer and advances state.
   * @returns 64-bit BigInt random word
   */
  private nextU64(): bigint {
    const result =
      (SeededRNG.rotl(this.s[0] + this.s[3], 23n) + this.s[0]) & SeededRNG.MASK64;

    const t = (this.s[1] << 17n) & SeededRNG.MASK64;

    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];

    this.s[2] ^= t;
    this.s[3] = SeededRNG.rotl(this.s[3], 45n);

    return result;
  }

  /**
   * Returns a pseudorandom floating-point number in [0, 1) with 53 bits of precision.
   * @returns Float in [0, 1)
   */
  nextFloat(): number {
    const v = this.nextU64() >> 11n; // upper 53 bits
    return Number(v) / Math.pow(2, 53);
  }

  /**
   * Returns a pseudorandom integer in [min, max] (inclusive).
   * @param min Minimum integer
   * @param max Maximum integer
   * @throws Error if min/max are not integers or if max < min
   * @returns Uniformly distributed integer in [min, max]
   */
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error('nextInt bounds must be integers');
    }
    if (max < min) {
      throw new Error(`max (${max}) < min (${min})`);
    }
    if (min === max) return min;
    const range = max - min + 1;
    return min + Math.floor(this.nextFloat() * range);
  }

  /**
   * Generates a standard normal random variable (mean = 0, std = 1) using Box-Muller transform.
   * @returns Gaussian random number
   */
  nextGaussian(): number {
    if (this.gaussianSpare !== null) {
      const val = this.gaussianSpare;
      this.gaussianSpare = null;
      return val;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.nextFloat();
    while (v === 0) v = this.nextFloat();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    const z1 = mag * Math.sin(2.0 * Math.PI * v);
    this.gaussianSpare = z1;
    return z0;
  }

  /**
   * Forks the generator to create an independent, deterministic child stream.
   * @returns Independent child SeededRNG
   */
  fork(): SeededRNG {
    const s0 = this.nextU64();
    const s1 = this.nextU64();
    const child = new SeededRNG(0);
    let x = s0 ^ s1;
    const states: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      x = SeededRNG.splitmix64(x + BigInt(i) * 0x9e3779b97f4a7c15n);
      states.push(x);
    }
    child.s = states as [bigint, bigint, bigint, bigint];
    child.gaussianSpare = null;
    return child;
  }

  /**
   * Returns state as a Uint32Array (11 elements: 8 state words + 1 spare flag + 2 spare float words).
   * @returns Serialized Uint32Array
   */
  getState(): Uint32Array {
    const arr = new Uint32Array(11);
    for (let i = 0; i < 4; i++) {
      const v = this.s[i];
      arr[i * 2] = Number(v & 0xffffffffn);
      arr[i * 2 + 1] = Number((v >> 32n) & 0xffffffffn);
    }
    if (this.gaussianSpare !== null) {
      arr[8] = 1;
      const floatBuf = new Float64Array(1);
      floatBuf[0] = this.gaussianSpare;
      const uintBuf = new Uint32Array(floatBuf.buffer);
      arr[9] = uintBuf[0];
      arr[10] = uintBuf[1];
    } else {
      arr[8] = 0;
      arr[9] = 0;
      arr[10] = 0;
    }
    return arr;
  }

  /**
   * Restores state from a Uint32Array (supports length 8 or 11).
   * @param state Serialized Uint32Array
   * @throws Error if length is invalid or state words are all zeros
   */
  setState(state: Uint32Array): void {
    if (state.length !== 8 && state.length !== 11) {
      throw new Error(`State must be Uint32Array of length 8 or 11 (received length ${state.length})`);
    }
    const newS: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      const low = BigInt(state[i * 2]);
      const high = BigInt(state[i * 2 + 1]);
      newS.push((high << 32n) | low);
    }
    if (newS.every((v: bigint) => v === 0n)) {
      throw new Error('State cannot be all zeros');
    }
    this.s = newS as [bigint, bigint, bigint, bigint];

    if (state.length === 11 && state[8] === 1) {
      const uintBuf = new Uint32Array(2);
      uintBuf[0] = state[9];
      uintBuf[1] = state[10];
      const floatBuf = new Float64Array(uintBuf.buffer);
      this.gaussianSpare = floatBuf[0];
    } else {
      this.gaussianSpare = null;
    }
  }

  /**
   * Creates an exact clone of this RNG instance.
   * @returns Cloned SeededRNG
   */
  clone(): SeededRNG {
    const c = new SeededRNG(0);
    c.s = [...this.s] as [bigint, bigint, bigint, bigint];
    c.gaussianSpare = this.gaussianSpare;
    return c;
  }
}
