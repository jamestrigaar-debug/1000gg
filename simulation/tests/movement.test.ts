/* ============================================================================
 * MOVEMENT — the twitch, measured.
 *
 * The renderer's half of the jank is measured in tests/render.test.ts. This is
 * the other half: what the players themselves were doing.
 *
 * The old integrator worked like a tank. It kept a heading, turned that
 * heading towards where the player wanted to go, and then set the velocity to
 * speed * (cos heading, sin heading). Two consequences, both visible:
 *
 *   - travel was always exactly along the facing, so there was no momentum
 *     through a turn: the drawn path had a hard corner at every change of
 *     direction instead of an arc
 *   - the heading SNAPPED straight to the desired direction whenever the
 *     player was moving slower than 0.3 m/s — which, for a side holding its
 *     shape, is most of the pitch most of the time
 *
 * The second one is the twitch. A dot easing onto its position drops under
 * the threshold, the brain nudges its target, and the player pivots on the
 * spot. Twenty-two of them doing that is not a football match.
 *
 * The old integrator is reproduced below so the difference is measured rather
 * than asserted.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { DT, PHYSICS_HZ, TURN_EASE_AT_REST, TURN_FREE_BELOW } from "../src/core/constants";
import { angleDelta, clamp } from "../src/core/math";
import { createPlayer, integratePlayer, steerPlayer, type Player } from "../src/core/player";
import { MatchSim } from "../src/core/match";
import { buildMatchSetup } from "../src/manager/bridge";
import { demoFixture } from "../src/data/demo-fixture";
import { loadFormations } from "../src/data";
import type { PlayerDef } from "../src/core/types";

const setup = buildMatchSetup(demoFixture());
const formations = loadFormations();

/** An ordinary outfielder, so the numbers are not a freak of attributes. */
function testPlayer(): Player {
  const def = setup.home.players.find((p) => p.position !== "GK") as PlayerDef;
  return createPlayer(def, 0, 5, { x: 50, y: 34 });
}

/** The old body model, verbatim, for comparison. */
function legacyIntegrate(p: Player, maxSpeed: number, dt: number): void {
  const wx = p.steerX;
  const wy = p.steerY;
  const wantSq = wx * wx + wy * wy;
  const curSq = p.vel.x * p.vel.x + p.vel.y * p.vel.y;
  if (wantSq < 1e-6 && curSq < 1e-6) return;
  const wantSpeed = Math.min(Math.sqrt(wantSq), maxSpeed);
  const curSpeed = Math.sqrt(curSq);
  if (wantSpeed > 1e-4) {
    const wantHeading = Math.atan2(wy, wx);
    const d = angleDelta(p.heading, wantHeading);
    p.heading =
      curSpeed < 0.3 ? wantHeading : p.heading + clamp(d, -p.turnRate * dt, p.turnRate * dt);
  }
  const dv = clamp(wantSpeed - curSpeed, -p.aMax * dt * 1.6, p.aMax * dt);
  const newSpeed = clamp(curSpeed + dv, 0, maxSpeed);
  p.vel.x = Math.cos(p.heading) * newSpeed;
  p.vel.y = Math.sin(p.heading) * newSpeed;
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
}

describe("a player turning", () => {
  it("cannot reverse his direction of travel in a single tick", () => {
    const p = testPlayer();
    // At a jog, travelling along +x, suddenly asked to go the other way.
    p.vel = { x: 4, y: 0 };
    p.heading = 0;
    p.steerX = -p.vMax;
    p.steerY = 0;

    const before = Math.atan2(p.vel.y, p.vel.x);
    integratePlayer(p, p.vMax, DT);
    const after = Math.atan2(p.vel.y, p.vel.x);

    const turned = Math.abs(angleDelta(before, after));
    const allowed = p.turnRate * (1 + TURN_EASE_AT_REST) * DT;
    expect(turned).toBeLessThanOrEqual(allowed + 1e-9);
    // Nowhere near a reversal: a body at pace cannot simply be pointed.
    expect(turned).toBeLessThan(Math.PI / 2);
    // And it is a real turn, not a stand-still.
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeGreaterThan(0);
  });

  it("the old model snapped a slow player round instantly (this is the bug)", () => {
    const p = testPlayer();
    // Moving gently — which is what a player holding his shape is doing.
    p.vel = { x: 0.2, y: 0 };
    p.heading = 0;
    p.steerX = -p.vMax;
    p.steerY = 0;

    legacyIntegrate(p, p.vMax, DT);
    // A full half-turn of the facing, in one 120th of a second.
    expect(Math.abs(angleDelta(0, p.heading))).toBeCloseTo(Math.PI, 3);
  });

  it("keeps momentum through a turn rather than cornering", () => {
    // Running along +x and asked to go along +y: the path must bend, which
    // means he keeps covering ground in x while the turn happens.
    const p = testPlayer();
    p.pos = { x: 0, y: 0 };
    p.vel = { x: p.vMax, y: 0 };
    p.heading = 0;
    for (let i = 0; i < PHYSICS_HZ / 2; i++) {
      p.steerX = 0;
      p.steerY = p.vMax;
      integratePlayer(p, p.vMax, DT);
    }
    // Displacement in BOTH axes is the arc: he carried on forwards while the
    // turn happened, rather than cornering on the spot.
    expect(p.pos.x).toBeGreaterThan(0.3);
    expect(p.pos.y).toBeGreaterThan(0.3);
  });
});

describe("a player arriving", () => {
  it("settles on his position instead of hunting across it", () => {
    const p = testPlayer();
    p.pos = { x: 40, y: 34 };
    const target = { x: 50, y: 34 };

    for (let i = 0; i < PHYSICS_HZ * 6; i++) {
      steerPlayer(p, target.x, target.y, [], p.vMax);
      integratePlayer(p, p.vMax, DT);
    }
    expect(Math.hypot(p.pos.x - target.x, p.pos.y - target.y)).toBeLessThan(1);

    // ...and having arrived, he stops, rather than jittering about on it.
    const restingSpeeds: number[] = [];
    for (let i = 0; i < PHYSICS_HZ; i++) {
      steerPlayer(p, target.x, target.y, [], p.vMax);
      integratePlayer(p, p.vMax, DT);
      restingSpeeds.push(Math.hypot(p.vel.x, p.vel.y));
    }
    expect(Math.max(...restingSpeeds)).toBeLessThan(0.5);
  });
});

describe("a whole match", () => {
  /* The property the old model broke on every other tick, checked against a
   * real match rather than a contrived one: nobody's direction of travel ever
   * changes faster than his legs allow. */
  it("never turns anybody faster than his own turn rate", () => {
    const sim = new MatchSim({ ...setup, seed: "turning" }, { formations });
    /* The constraint that applied to a tick is the one for the speed the
     * player was ALREADY going when it began — that is what momentum means —
     * so the previous speed is what has to be recorded, not the new one. */
    const last = new Map<number, { heading: number; speed: number }>();
    let checked = 0;
    let violations = 0;
    let worst = 0;

    for (let tick = 0; tick < PHYSICS_HZ * 150; tick++) {
      sim.step();
      for (const p of sim.players) {
        if (!p.onPitch) continue;
        const speed = Math.hypot(p.vel.x, p.vel.y);
        const now = Math.atan2(p.vel.y, p.vel.x);
        const was = last.get(p.def.id);
        last.set(p.def.id, { heading: now, speed });
        // Setting off from a standstill in any direction is free.
        if (was === undefined || was.speed < TURN_FREE_BELOW) continue;
        checked++;
        const allowed = p.turnRate * (1 + TURN_EASE_AT_REST) * DT + 1e-6;
        const turned = Math.abs(angleDelta(was.heading, now));
        worst = Math.max(worst, turned / allowed);
        if (turned > allowed) violations++;
      }
    }

    expect(checked).toBeGreaterThan(10_000);
    expect(violations).toBe(0);
    // And the limit is genuinely biting, not vacuously satisfied.
    expect(worst).toBeGreaterThan(0.9);
  }, 120_000);

  it("leaves nobody vibrating on the spot", () => {
    /* The twitch, counted. A "flip" is a player whose direction of travel
     * reverses by more than 120 degrees in one tick while he is moving —
     * physically impossible, and the signature of the old snap.
     *
     * Restarts are excluded, and only restarts: a corner or a kick-off puts
     * everybody on their marks and zeroes their velocity, which is a cut, not
     * a twitch. They are identified by the player having been MOVED rather
     * than having run — a step larger than his legs could have taken. */
    const sim = new MatchSim({ ...setup, seed: "twitch" }, { formations });
    const heading = new Map<number, number>();
    const seen = new Map<number, { x: number; y: number }>();
    let flips = 0;
    let samples = 0;

    for (let tick = 0; tick < PHYSICS_HZ * 150; tick++) {
      sim.step();
      for (const p of sim.players) {
        const last = seen.get(p.def.id);
        seen.set(p.def.id, { x: p.pos.x, y: p.pos.y });
        if (!p.onPitch) continue;

        const speed = Math.hypot(p.vel.x, p.vel.y);
        const now = Math.atan2(p.vel.y, p.vel.x);
        const was = heading.get(p.def.id);
        // A teleport: he was placed, not run. Forget the old heading with him.
        const moved = last ? Math.hypot(p.pos.x - last.x, p.pos.y - last.y) : 0;
        if (moved > p.vMax * DT * 2) {
          heading.delete(p.def.id);
          continue;
        }
        heading.set(p.def.id, now);
        if (was === undefined || speed < TURN_FREE_BELOW) continue;
        samples++;
        if (Math.abs(angleDelta(was, now)) > (120 * Math.PI) / 180) flips++;
      }
    }

    expect(samples).toBeGreaterThan(10_000);
    expect(flips).toBe(0);
  }, 120_000);
});
