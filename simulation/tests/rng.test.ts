import { describe, expect, it } from "vitest";
import { Rng, hashSeed } from "../src/core/rng";

describe("seeded rng", () => {
  it("is reproducible from a seed", () => {
    const a = new Rng("abc");
    const b = new Rng("abc");
    const xs = Array.from({ length: 500 }, () => a.next());
    const ys = Array.from({ length: 500 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it("separates different seeds", () => {
    const a = new Rng("abc");
    const b = new Rng("abd");
    expect(a.next()).not.toBe(b.next());
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });

  it("round-trips its state, which is what makes seeking possible", () => {
    const r = new Rng("seek");
    for (let i = 0; i < 37; i++) r.next();
    const state = r.getState();
    const expected = Array.from({ length: 20 }, () => r.next());
    r.setState(state);
    expect(Array.from({ length: 20 }, () => r.next())).toEqual(expected);
  });

  it("produces a roughly uniform stream", () => {
    const r = new Rng("uniform");
    const buckets = new Array(10).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) expect(Math.abs(b / n - 0.1)).toBeLessThan(0.01);
  });

  it("keeps clamped normals inside their limit", () => {
    const r = new Rng("normal");
    for (let i = 0; i < 10_000; i++) {
      const v = r.clampedNormal(0, 1, 2.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(2.5);
    }
  });
});
