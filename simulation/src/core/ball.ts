/* ============================================================================
 * BALL — 2.5D state and integration.
 *
 * The ball is the one object in the sim with real physics. Everything else
 * steers. It carries {x,y,z} + velocity and lives in one of two regimes:
 *
 *   airborne  gravity + quadratic drag + a Magnus-ish lateral term from spin
 *   rolling   z = 0, constant deceleration from grass friction, no gravity
 *
 * Both regimes run in the same integrator so a low driven pass that skims,
 * bounces and settles is one continuous trajectory, not three special cases.
 * ========================================================================== */

import {
  AIR_DRAG_K,
  BALL_DEAD_SPEED,
  BALL_RADIUS,
  BOUNCE_RESTITUTION,
  BOUNCE_SETTLE_SPEED,
  BOUNCE_TANGENT_KEEP,
  GRAVITY,
  GROUND_FRICTION_MAX,
  GROUND_FRICTION_MIN,
  SPIN_ACCEL_K,
} from "./constants";
import { lerp, type Vec3, len2, len3 } from "./math";

export type BallOwner = number | null;

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Normalised sidespin in [-1, 1]; negative curls towards -y. Decays in air. */
  spin: number;
  /** Player id in possession, or null for a loose ball. */
  owner: BallOwner;
  /** Last player to touch it — decides throw/corner/goal-kick and own goals. */
  lastTouch: BallOwner;
  /** Team of the last touch (0 home, 1 away), or null before kick-off. */
  lastTouchTeam: 0 | 1 | null;
  /** Was this ball deliberately put in the air — a cross, a clearance, a ball
   *  over the top? Only those are contested in the air. A chipped five-yard
   *  pass passes through head height too, and heading it would be absurd. */
  lofted: boolean;
}

export function createBall(pos: Vec3): BallState {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    spin: 0,
    owner: null,
    lastTouch: null,
    lastTouchTeam: null,
    lofted: false,
  };
}

/** In flight if it is off the deck, or moving vertically fast enough to be —
 *  including *downwards*: a ball a centimetre above the grass falling at 9 m/s
 *  is still a flighted ball, and treating it as rolling would swallow the
 *  bounce entirely. */
export const isAirborne = (b: BallState): boolean =>
  b.pos.z > BALL_RADIUS * 0.5 || Math.abs(b.vel.z) > BOUNCE_SETTLE_SPEED;

export const speed2d = (b: BallState): number => len2(b.vel.x, b.vel.y);

export const isDead = (b: BallState): boolean =>
  b.owner === null && !isAirborne(b) && speed2d(b) < BALL_DEAD_SPEED;

/** Pitch condition 0 (quick, dry) .. 1 (heavy, wet) -> rolling deceleration. */
export const frictionFor = (pitchCondition: number): number =>
  lerp(GROUND_FRICTION_MIN, GROUND_FRICTION_MAX, pitchCondition);

/**
 * Advance the ball by dt. Semi-implicit Euler: accelerations are evaluated at
 * the current velocity, then position uses the *new* velocity. At 120 Hz that
 * is stable to well under a centimetre over a 40 m pass, and unlike RK4 it is
 * cheap enough to run 3x inside the kick solver's Newton corrections.
 *
 * Ground contact is resolved by rewinding to the exact crossing time so the
 * bounce point does not depend on the timestep — determinism demands it.
 */
export function integrateBall(b: BallState, dt: number, friction: number): void {
  if (b.owner !== null) return; // an owned ball is moved by its carrier

  if (isAirborne(b)) {
    integrateAir(b, dt);
    if (b.pos.z <= 0) resolveGroundContact(b, dt, friction);
  } else {
    integrateRoll(b, dt, friction);
  }
}

function integrateAir(b: BallState, dt: number): void {
  const v = b.vel;
  const sp = len3(v.x, v.y, v.z);

  // Quadratic drag opposing the velocity vector.
  const d = AIR_DRAG_K * sp;
  let ax = -d * v.x;
  let ay = -d * v.y;
  const az = -d * v.z - GRAVITY;

  // Magnus: lateral acceleration perpendicular to the horizontal heading,
  // proportional to spin and to pace. This is what bends a free kick.
  if (b.spin !== 0 && sp > 0.01) {
    const h = len2(v.x, v.y) || 1;
    const px = -v.y / h;
    const py = v.x / h;
    const m = SPIN_ACCEL_K * b.spin * sp * sp;
    ax += px * m;
    ay += py * m;
  }

  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;
  b.pos.x += v.x * dt;
  b.pos.y += v.y * dt;
  b.pos.z += v.z * dt;

  // Spin bleeds off in flight; a ball does not curl forever.
  b.spin *= 1 - 0.35 * dt;
}

function integrateRoll(b: BallState, dt: number, friction: number): void {
  const v = b.vel;
  const sp = len2(v.x, v.y);
  b.pos.z = 0;
  v.z = 0;
  if (sp <= 1e-6) {
    v.x = 0;
    v.y = 0;
    return;
  }
  const drop = friction * dt;
  const scaleF = sp <= drop ? 0 : (sp - drop) / sp;
  v.x *= scaleF;
  v.y *= scaleF;
  b.pos.x += v.x * dt;
  b.pos.y += v.y * dt;
  // A rolling ball keeps a little sidespin so a bobbling ball still drifts.
  b.spin *= 1 - 1.5 * dt;
}

/**
 * The ball ended the step at or below ground level. Rewind to the crossing,
 * bounce, then spend the remaining time in whichever regime it lands in.
 */
function resolveGroundContact(b: BallState, dt: number, friction: number): void {
  const v = b.vel;
  // Fraction of the step already spent below ground, from the post-step z.
  const overshoot = -b.pos.z;
  const back = v.z !== 0 ? Math.min(dt, overshoot / Math.max(Math.abs(v.z), 1e-6)) : 0;
  b.pos.x -= v.x * back;
  b.pos.y -= v.y * back;
  b.pos.z = 0;

  const impact = Math.abs(v.z);
  if (impact < BOUNCE_SETTLE_SPEED) {
    v.z = 0;
    if (back > 0) integrateRoll(b, back, friction);
    return;
  }

  v.z = impact * BOUNCE_RESTITUTION;
  v.x *= BOUNCE_TANGENT_KEEP;
  v.y *= BOUNCE_TANGENT_KEEP;
  // Sidespin bites on contact: a curling ball kicks on off the deck.
  if (b.spin !== 0) {
    const h = len2(v.x, v.y);
    if (h > 0.01) {
      const px = -v.y / h;
      const py = v.x / h;
      const kick = b.spin * h * 0.08;
      v.x += px * kick;
      v.y += py * kick;
    }
    b.spin *= 0.7;
  }
  if (back > 0) integrateAir(b, back);
}

/** Time for a ball to travel `distance` along the ground from `speed`, or
 *  Infinity if it stops short. The interception-time primitive the AI runs on. */
export function rollTimeToDistance(
  speed: number,
  distance: number,
  friction: number,
): number {
  if (distance <= 0) return 0;
  const maxDist = (speed * speed) / (2 * friction);
  if (distance > maxDist) return Infinity;
  // d = v t - 0.5 f t^2  ->  solve for the first root.
  const disc = speed * speed - 2 * friction * distance;
  return (speed - Math.sqrt(Math.max(disc, 0))) / friction;
}

