import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';

describe('SeededRNG', () => {
  it('same seed produces identical sequences', () => {
    const rng1 = new SeededRNG('test-seed');
    const rng2 = new SeededRNG('test-seed');
    for (let i = 0; i < 100; i++) {
      expect(rng1.nextFloat()).toBe(rng2.nextFloat());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = new SeededRNG('seed-a');
    const rng2 = new SeededRNG('seed-b');
    const seq1 = Array.from({ length: 10 }, () => rng1.nextFloat());
    const seq2 = Array.from({ length: 10 }, () => rng2.nextFloat());
    expect(seq1).not.toEqual(seq2);
  });

  it('numeric seed deterministic', () => {
    const rng1 = new SeededRNG(12345);
    const rng2 = new SeededRNG(12345);
    for (let i = 0; i < 20; i++) {
      expect(rng1.nextInt(0, 100)).toBe(rng2.nextInt(0, 100));
    }
  });

  it('handles empty string and negative numeric seeds without errors', () => {
    const rngEmpty1 = new SeededRNG('');
    const rngEmpty2 = new SeededRNG('');
    expect(rngEmpty1.nextFloat()).toBe(rngEmpty2.nextFloat());

    const rngNeg1 = new SeededRNG(-42);
    const rngNeg2 = new SeededRNG(-42);
    expect(rngNeg1.nextFloat()).toBe(rngNeg2.nextFloat());
  });

  it('fork produces different sequences from parent but deterministic', () => {
    const parent1 = new SeededRNG('parent');
    const parent2 = new SeededRNG('parent');
    parent1.nextFloat();
    parent2.nextFloat();

    const child1 = parent1.fork();
    const child2 = parent2.fork();

    for (let i = 0; i < 10; i++) {
      expect(child1.nextFloat()).toBe(child2.nextFloat());
    }

    const parentVal = parent1.nextFloat();
    const childVal = child1.nextFloat();
    expect(parentVal).not.toBe(childVal);
  });

  it('nextInt bounds inclusive', () => {
    const rng = new SeededRNG('bounds');
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
    const rng2 = new SeededRNG('bounds2');
    let seenMin = false;
    let seenMax = false;
    for (let i = 0; i < 1000; i++) {
      const v = rng2.nextInt(0, 1);
      if (v === 0) seenMin = true;
      if (v === 1) seenMax = true;
    }
    expect(seenMin).toBe(true);
    expect(seenMax).toBe(true);
  });

  it('nextInt validates bounds and throws on invalid inputs', () => {
    const rng = new SeededRNG('invalid-bounds');
    expect(() => rng.nextInt(10, 5)).toThrow(/max \(5\) < min \(10\)/);
    expect(() => rng.nextInt(1.5, 5)).toThrow(/bounds must be integers/);
    expect(() => rng.nextInt(1, 4.2)).toThrow(/bounds must be integers/);
    expect(rng.nextInt(5, 5)).toBe(5);
  });

  it('nextFloat always in [0,1)', () => {
    const rng = new SeededRNG('float');
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextGaussian roughly normal (mean ~0, std ~1)', () => {
    const rng = new SeededRNG('gaussian');
    const samples = 10000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < samples; i++) {
      const v = rng.nextGaussian();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / samples;
    const variance = sumSq / samples - mean * mean;
    const std = Math.sqrt(variance);
    expect(mean).toBeCloseTo(0, 0);
    expect(std).toBeCloseTo(1, 0);
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(Math.abs(std - 1)).toBeLessThan(0.1);
  });

  it('getState and setState restore sequence', () => {
    const rng = new SeededRNG('state-test');
    for (let i = 0; i < 10; i++) rng.nextFloat();
    const state = rng.getState();
    const seq1: number[] = [];
    for (let i = 0; i < 10; i++) seq1.push(rng.nextFloat());

    rng.setState(state);
    const seq2: number[] = [];
    for (let i = 0; i < 10; i++) seq2.push(rng.nextFloat());

    expect(seq1).toEqual(seq2);
  });

  it('preserves gaussian spare state across getState and setState', () => {
    const rng1 = new SeededRNG('gaussian-state');
    // Generate 1 Gaussian (this generates 2 and caches 1)
    const g1 = rng1.nextGaussian();
    const savedState = rng1.getState();

    // In a fresh rng restored to that exact state, the nextGaussian() should return the cached spare
    const rng2 = new SeededRNG('other');
    rng2.setState(savedState);

    const g2_1 = rng1.nextGaussian();
    const g2_2 = rng2.nextGaussian();
    expect(g2_1).toBe(g2_2);

    // Subsequent values should continue identically
    for (let i = 0; i < 10; i++) {
      expect(rng1.nextGaussian()).toBe(rng2.nextGaussian());
    }
    expect(g1).toBeDefined();
  });

  it('setState validates state array length and non-zero state', () => {
    const rng = new SeededRNG('validation');
    expect(() => rng.setState(new Uint32Array(5))).toThrow(/must be Uint32Array of length 8 or 11/);
    expect(() => rng.setState(new Uint32Array(8))).toThrow(/cannot be all zeros/);
    expect(() => rng.setState(new Uint32Array(11))).toThrow(/cannot be all zeros/);
  });
});
