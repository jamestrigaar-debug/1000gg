import { describe, expect, it } from "vitest";
import { DT, GRAVITY } from "../src/core/constants";
import { createBall, integrateBall, rollTimeToDistance } from "../src/core/ball";

const FRICTION = 5;

describe("ball physics", () => {
  it("a rolling ball decelerates and stops at the predicted distance", () => {
    const b = createBall({ x: 0, y: 0, z: 0 });
    b.vel = { x: 10, y: 0, z: 0 };
    for (let i = 0; i < 120 * 10; i++) integrateBall(b, DT, FRICTION);
    // d = v^2 / 2f = 100 / 10 = 10 m
    expect(b.pos.x).toBeCloseTo(10, 0);
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeLessThan(0.05);
  });

  it("a lofted ball comes back down and settles", () => {
    const b = createBall({ x: 0, y: 0, z: 0 });
    b.vel = { x: 12, y: 0, z: 12 };
    let maxZ = 0;
    for (let i = 0; i < 120 * 20; i++) {
      integrateBall(b, DT, FRICTION);
      maxZ = Math.max(maxZ, b.pos.z);
      expect(Number.isFinite(b.pos.x)).toBe(true);
    }
    // Drag-free apex would be v^2/2g = 7.3 m; drag takes a little off it.
    expect(maxZ).toBeGreaterThan(5);
    expect(maxZ).toBeLessThan((12 * 12) / (2 * GRAVITY) + 0.1);
    expect(b.pos.z).toBeLessThan(0.2);
  });

  it("never puts the ball below the ground", () => {
    const b = createBall({ x: 0, y: 0, z: 3 });
    b.vel = { x: 4, y: 1, z: -6 };
    for (let i = 0; i < 120 * 15; i++) {
      integrateBall(b, DT, FRICTION);
      expect(b.pos.z).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("bounces lose height every time", () => {
    const b = createBall({ x: 0, y: 0, z: 4 });
    const apexes: number[] = [];
    let rising = false;
    let last = b.pos.z;
    for (let i = 0; i < 120 * 12; i++) {
      integrateBall(b, DT, FRICTION);
      if (b.pos.z > last) rising = true;
      else if (rising) {
        apexes.push(last);
        rising = false;
      }
      last = b.pos.z;
    }
    expect(apexes.length).toBeGreaterThan(2);
    for (let i = 1; i < apexes.length; i++) expect(apexes[i]!).toBeLessThan(apexes[i - 1]!);
  });

  it("agrees with the analytic roll time", () => {
    expect(rollTimeToDistance(10, 10, 5)).toBeCloseTo(2, 3);
    expect(rollTimeToDistance(10, 50, 5)).toBe(Infinity);
  });

  it("an owned ball is not integrated — the carrier moves it", () => {
    const b = createBall({ x: 5, y: 5, z: 0 });
    b.owner = 1;
    b.vel = { x: 9, y: 0, z: 0 };
    integrateBall(b, DT, FRICTION);
    expect(b.pos.x).toBe(5);
  });
});
