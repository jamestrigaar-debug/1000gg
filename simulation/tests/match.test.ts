/* ============================================================================
 * MATCH INTEGRATION — the things that must be true of any simulated match.
 *
 * These are the M0-M1 gates: the world stays finite, the ball stays on the
 * planet, players stay on the map, the clock advances, restarts happen and
 * the event stream is the only thing anyone needs to read.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  APRON,
  PHYSICS_HZ,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "../src/core/constants";
import { makeSim } from "./helpers";

describe("match simulation", () => {
  it("never produces a NaN anywhere in the world", () => {
    const sim = makeSim("nan-hunt");
    for (let i = 0; i < PHYSICS_HZ * 300; i++) {
      sim.step();
      if (i % 137 !== 0) continue;
      expect(Number.isFinite(sim.ball.pos.x)).toBe(true);
      expect(Number.isFinite(sim.ball.pos.y)).toBe(true);
      expect(Number.isFinite(sim.ball.pos.z)).toBe(true);
      expect(Number.isFinite(sim.ball.vel.x)).toBe(true);
      for (const p of sim.players) {
        expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)).toBe(true);
        expect(Number.isFinite(p.vel.x) && Number.isFinite(p.vel.y)).toBe(true);
        expect(Number.isFinite(p.heading)).toBe(true);
      }
    }
  });

  it("keeps players inside the simulated area and the ball out of the ground", () => {
    const sim = makeSim("bounds");
    for (let i = 0; i < PHYSICS_HZ * 120; i++) {
      sim.step();
      expect(sim.ball.pos.z).toBeGreaterThanOrEqual(-1e-6);
      if (i % 11 !== 0) continue;
      for (const p of sim.players) {
        expect(p.pos.x).toBeGreaterThanOrEqual(-APRON - 1e-6);
        expect(p.pos.x).toBeLessThanOrEqual(PITCH_LENGTH + APRON + 1e-6);
        expect(p.pos.y).toBeGreaterThanOrEqual(-APRON - 1e-6);
        expect(p.pos.y).toBeLessThanOrEqual(PITCH_WIDTH + APRON + 1e-6);
      }
    }
  });

  it("kicks off, restarts the ball, and advances the clock", () => {
    const sim = makeSim("flow");
    sim.stepSeconds(240);
    const types = new Set(sim.log.all().map((e) => e.type));
    expect(types.has("KickOff")).toBe(true);
    expect(sim.matchSecond).toBeCloseTo(240, 3);
    // Something put the ball out of play in four minutes of football.
    expect(sim.log.all().some((e) => e.type === "Restart" || e.type === "Goal")).toBe(true);
  });

  it("never leaves the ball dead and unattended for more than the watchdog", () => {
    const sim = makeSim("watchdog");
    let deadRun = 0;
    let worst = 0;
    for (let i = 0; i < PHYSICS_HZ * 300; i++) {
      sim.step();
      const stationary =
        sim.ball.owner === null && Math.hypot(sim.ball.vel.x, sim.ball.vel.y) < 0.25;
      deadRun = stationary ? deadRun + 1 : 0;
      worst = Math.max(worst, deadRun);
    }
    // 8 s watchdog plus the dead-ball settling time for a restart.
    expect(worst / PHYSICS_HZ).toBeLessThan(12);
  });

  it("hands the render thread each event exactly once", () => {
    const sim = makeSim("snapshots");
    let delivered = 0;
    for (let i = 0; i < 40; i++) {
      sim.stepSeconds(3);
      delivered += sim.renderSnapshot().events.length;
    }
    expect(delivered).toBe(sim.log.length);
  });

  it("reaches full time, having swapped ends at the break", () => {
    const sim = makeSim("full-match");
    const firstHalfDir = sim.dirFor(0);
    sim.runToEnd();
    expect(sim.finished).toBe(true);
    expect(sim.period).toBe(2);
    expect(sim.dirFor(0)).toBe(-firstHalfDir);
    expect(sim.dirFor(1)).toBe(firstHalfDir);
    expect(sim.log.all().some((e) => e.type === "Whistle" && e.kind === "halfTime")).toBe(true);
    expect(sim.log.all().some((e) => e.type === "Whistle" && e.kind === "fullTime")).toBe(true);
  }, 120_000);
});
