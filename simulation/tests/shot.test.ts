/* The shot model is the oracle: if these numbers drift, every scoreline the
 * engine produces drifts with them. */
import { describe, expect, it } from "vitest";
import { PITCH_LENGTH } from "../src/core/constants";
import { expectedGoals, postShotXG, resolveShot, saveFailChance, PENALTY_XG } from "../src/core/shot";
import { Rng } from "../src/core/rng";

const from = (x: number, y = 34) => ({ x, y });
const ctx = (x: number, y = 34, extra: Partial<Parameters<typeof expectedGoals>[0]> = {}) => ({
  from: from(x, y),
  dir: 1 as const,
  header: false,
  pressure: 0.3,
  counter: false,
  penalty: false,
  ...extra,
});

describe("expected goals", () => {
  it("matches the shape of a real shot map", () => {
    const sixYard = expectedGoals(ctx(PITCH_LENGTH - 5));
    const penSpot = expectedGoals(ctx(PITCH_LENGTH - 11));
    const boxEdge = expectedGoals(ctx(PITCH_LENGTH - 16.5));
    const twentyYards = expectedGoals(ctx(PITCH_LENGTH - 18));
    const thirty = expectedGoals(ctx(PITCH_LENGTH - 27));

    expect(sixYard).toBeGreaterThan(0.35); // a tap-in is a tap-in
    expect(sixYard).toBeLessThan(0.6);
    expect(penSpot).toBeLessThan(sixYard);
    expect(boxEdge).toBeLessThan(0.1);
    expect(twentyYards).toBeLessThan(0.05); // "under 0.05 beyond 18 m"
    expect(thirty).toBeLessThan(0.03);
  });

  it("prices the angle, not just the distance", () => {
    const central = expectedGoals(ctx(PITCH_LENGTH - 8, 34));
    const byline = expectedGoals(ctx(PITCH_LENGTH - 8, 12));
    expect(byline).toBeLessThan(central * 0.6);
  });

  it("charges for pressure and pays for a counter", () => {
    expect(expectedGoals(ctx(PITCH_LENGTH - 12, 34, { pressure: 0.9 }))).toBeLessThan(
      expectedGoals(ctx(PITCH_LENGTH - 12, 34, { pressure: 0 })),
    );
    expect(expectedGoals(ctx(PITCH_LENGTH - 12, 34, { counter: true }))).toBeGreaterThan(
      expectedGoals(ctx(PITCH_LENGTH - 12)),
    );
  });

  it("uses the historical rate for penalties", () => {
    expect(expectedGoals(ctx(PITCH_LENGTH - 11, 34, { penalty: true }))).toBeCloseTo(PENALTY_XG, 5);
  });
});

describe("post-shot xG and saves", () => {
  it("rates a corner higher than the middle of the goal", () => {
    const corner = postShotXG(31, 0.4, 26, 12, false);
    const middle = postShotXG(34, 1.2, 26, 12, false);
    expect(corner).toBeGreaterThan(middle * 1.5);
  });

  it("rates pace", () => {
    expect(postShotXG(32, 0.6, 30, 12, false)).toBeGreaterThan(postShotXG(32, 0.6, 14, 12, false));
  });

  it("gives a better keeper a better chance of keeping it out", () => {
    const good = saveFailChance(0.4, { reflexes: 18, handling: 16, positioning: 17 });
    const poor = saveFailChance(0.4, { reflexes: 6, handling: 7, positioning: 6 });
    expect(good).toBeLessThan(poor);
  });
});

describe("resolveShot", () => {
  const shooter = { finishing: 14, technique: 14, composure: 13, longShots: 12 };
  const keeper = { reflexes: 13, handling: 13, positioning: 13 };

  it("converts close range far more often than long range, and both plausibly", () => {
    const rate = (x: number): { goals: number; onTarget: number; xg: number } => {
      const rng = new Rng("conversion");
      let goals = 0;
      let onTarget = 0;
      let xg = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const outcome = resolveShot(ctx(x), shooter, keeper, rng);
        xg += outcome.xg;
        if (outcome.kind === "goal") goals++;
        if (outcome.kind === "goal" || outcome.kind === "saved") onTarget++;
      }
      return { goals: goals / n, onTarget: onTarget / n, xg: xg / n };
    };

    const close = rate(PITCH_LENGTH - 6);
    const far = rate(PITCH_LENGTH - 25);
    expect(close.goals).toBeGreaterThan(0.25);
    expect(far.goals).toBeLessThan(0.06);
    // Conversion should track the model that produced it, within noise.
    expect(Math.abs(close.goals - close.xg)).toBeLessThan(0.12);
    expect(Math.abs(far.goals - far.xg)).toBeLessThan(0.04);
  });

  it("keeps roughly a third to a half of shots on target", () => {
    const rng = new Rng("accuracy");
    let onTarget = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const x = PITCH_LENGTH - (6 + (i % 20));
      const outcome = resolveShot(ctx(x), shooter, keeper, rng);
      if (outcome.kind === "goal" || outcome.kind === "saved") onTarget++;
    }
    const share = onTarget / n;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.55);
  });

  it("blocks shots when bodies are in the way", () => {
    const rng = new Rng("blocks");
    let blocked = 0;
    for (let i = 0; i < 2000; i++) {
      if (resolveShot(ctx(PITCH_LENGTH - 14), shooter, keeper, rng, 0.3).kind === "blocked") blocked++;
    }
    expect(blocked / 2000).toBeGreaterThan(0.24);
    expect(blocked / 2000).toBeLessThan(0.36);
  });
});
