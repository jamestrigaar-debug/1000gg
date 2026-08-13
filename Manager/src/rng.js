/* ============================================================================
 * FOOTBALL MANAGER — SEEDED RNG
 *
 * Transposed from 1000goals' xorshift stream (src/game.js), with one change:
 * the state lives on an instance instead of on the global career state, so the
 * world simulation, the manager draft and the UI can each hold their own
 * independent stream. A world built from the same seed must produce the same
 * twenty seasons on every machine, which is impossible if one stray UI draw
 * can shift the shared cursor.
 *
 * Every random draw in this game goes through one of these instances. Nothing
 * calls Math.random except cosmetic reel flicker (see draft.js).
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  function hashSeed(input) {
    let h = 2166136261;
    const s = String(input == null ? Date.now() : input);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* A named sub-stream of a seed. Two sub-streams of the same seed never draw
   * the same sequence, so adding a system (say, youth intake) cannot shift the
   * numbers an existing system (say, the fixture list) was already drawing. */
  function createRng(seed, stream) {
    let s = hashSeed(stream ? `${seed}|${stream}` : seed) || 1;

    const api = {
      get state() { return s; },
      set state(v) { s = (v >>> 0) || 1; },

      /** Uniform [0, 1). */
      next() {
        let x = s >>> 0;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        s = x >>> 0;
        return (s || 1) / 4294967296;
      },
      /** Integer in [min, max], inclusive both ends. */
      int(min, max) {
        if (min > max) { const t = min; min = max; max = t; }
        return Math.floor(api.next() * (max - min + 1)) + min;
      },
      /** Float in [min, max). */
      between(min, max) { return api.next() * (max - min) + min; },
      /** True with probability p. */
      chance(p) { return api.next() < p; },
      /** Uniform pick from an array. */
      pick(arr) {
        if (!arr || !arr.length) return undefined;
        return arr[Math.floor(api.next() * arr.length)];
      },
      /** Pick from [{ item, weight }] — weights need not sum to anything. */
      weighted(items) {
        if (!items || !items.length) return undefined;
        let total = 0;
        for (const it of items) total += Math.max(0, it.weight || 0);
        if (total <= 0) return items[Math.floor(api.next() * items.length)].item;
        let roll = api.next() * total;
        for (const it of items) {
          roll -= Math.max(0, it.weight || 0);
          if (roll <= 0) return it.item;
        }
        return items[items.length - 1].item;
      },
      /** Pick from an object of { key: weight }. */
      weightedKey(map) {
        return api.weighted(Object.keys(map).map((k) => ({ item: k, weight: map[k] })));
      },
      /** In-place Fisher-Yates. Returns the same array. */
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(api.next() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      /** Knuth's Poisson sampler — the goal draw, same as 1000goals. */
      poisson(lambda) {
        if (!(lambda > 0)) return 0;
        if (lambda > 30) lambda = 30; // guards the loop below
        const L = Math.exp(-lambda);
        let k = 0, p = 1;
        do { k++; p *= api.next(); } while (p > L);
        return k - 1;
      },
      /** Roughly normal, mean 0, sd 1 (sum of 3 uniforms — cheap and bounded). */
      gauss() {
        return ((api.next() + api.next() + api.next()) - 1.5) * 1.1547;
      },
      /** A fresh independent stream derived from this one's current position. */
      fork(name) { return createRng(`${s}|${name}`); },
    };
    return api;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function sum(arr, fn) { let t = 0; for (const x of arr) t += fn ? fn(x) : x; return t; }
  function mean(arr, fn) { return arr.length ? sum(arr, fn) / arr.length : 0; }

  MG.hashSeed = hashSeed;
  MG.createRng = createRng;
  MG.util = { clamp, round1, round2, sum, mean };
})(typeof globalThis !== "undefined" ? globalThis : this);
