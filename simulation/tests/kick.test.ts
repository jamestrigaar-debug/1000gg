import { describe, expect, it } from "vitest";
import { solveKick, kickSkill, ballisticSpeed, launchAngle } from "../src/core/kick";
import { Rng } from "../src/core/rng";

const FRICTION = 5;

describe("kick solver", () => {
  it("lands a lofted ball on its target across the whole useful range", () => {
    for (const range of [8, 15, 25, 35, 45]) {
      for (const loft of [0.25, 0.5, 0.75]) {
        const from = { x: 5, y: 34, z: 0.11 };
        const target = { x: 5 + range, y: 34, z: 0 };
        const r = solveKick(from, { target, pace: 0.7, loft, spin: 0 }, { friction: FRICTION });
        expect(Number.isFinite(r.vel.x)).toBe(true);
        // Within a metre at every range is well inside a player's own error.
        expect(r.errorDistance).toBeLessThan(1.0);
      }
    }
  });

  it("falls short rather than exceeding the pace ceiling", () => {
    // 55 m on a flat trajectory is not a kick a human can hit; the solver must
    // clamp at maxPace and under-hit, never invent the speed to get there.
    const from = { x: 5, y: 34, z: 0.11 };
    const r = solveKick(
      from,
      { target: { x: 60, y: 34, z: 0 }, pace: 1, loft: 0.25, spin: 0 },
      { friction: FRICTION, maxPace: 34 },
    );
    expect(Math.hypot(r.vel.x, r.vel.y, r.vel.z)).toBeLessThanOrEqual(34 + 1e-6);
    expect(r.errorDistance).toBeGreaterThan(1);
  });

  it("gets a ground pass to its target", () => {
    for (const range of [6, 12, 20, 30]) {
      const from = { x: 10, y: 20, z: 0.11 };
      const target = { x: 10 + range, y: 20, z: 0 };
      const r = solveKick(from, { target, pace: 0, loft: 0, spin: 0 }, { friction: FRICTION });
      expect(r.errorDistance).toBeLessThan(1.5);
      expect(r.vel.z).toBe(0);
      expect(r.travelTime).toBeGreaterThan(0);
    }
  });

  it("is perfectly repeatable without an rng, and repeatable with a seeded one", () => {
    const from = { x: 0, y: 0, z: 0.11 };
    const target = { x: 30, y: 6, z: 1 };
    const req = { target, pace: 0.8, loft: 0.4, spin: 0.2 };
    const a = solveKick(from, req, { friction: FRICTION });
    const b = solveKick(from, req, { friction: FRICTION });
    expect(a).toEqual(b);

    const withRng = (): number =>
      solveKick(from, req, {
        friction: FRICTION,
        skill: kickSkill(12, 0.4, 0.5),
        rng: new Rng("kick"),
      }).vel.x;
    expect(withRng()).toBe(withRng());
  });

  it("puts better players closer to the target than worse ones", () => {
    const from = { x: 20, y: 34, z: 0.11 };
    const target = { x: 50, y: 34, z: 0 };
    const spread = (attribute: number): number => {
      const rng = new Rng("spread");
      let total = 0;
      for (let i = 0; i < 400; i++) {
        const r = solveKick(
          from,
          { target, pace: 0.6, loft: 0.3, spin: 0 },
          { friction: FRICTION, skill: kickSkill(attribute, 0.3, 0.5), rng },
        );
        total += r.errorDistance;
      }
      return total / 400;
    };
    expect(spread(18)).toBeLessThan(spread(6));
  });

  it("pressure widens the error", () => {
    const from = { x: 20, y: 34, z: 0.11 };
    const target = { x: 45, y: 34, z: 0 };
    const mean = (pressure: number): number => {
      const rng = new Rng("pressure");
      let total = 0;
      for (let i = 0; i < 400; i++) {
        total += solveKick(
          from,
          { target, pace: 0.6, loft: 0.2, spin: 0 },
          { friction: FRICTION, skill: kickSkill(12, pressure, 0.4), rng },
        ).errorDistance;
      }
      return total / 400;
    };
    expect(mean(0.9)).toBeGreaterThan(mean(0));
  });

  it("reports an impossible ballistic solve rather than guessing", () => {
    // Aiming above the launch angle's reach has no solution.
    expect(ballisticSpeed({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 40 }, launchAngle(0.2))).toBeNull();
  });
});
