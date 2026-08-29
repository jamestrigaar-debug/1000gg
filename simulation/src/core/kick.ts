/* ============================================================================
 * KICK SOLVER — the one API through which the ball is ever struck.
 *
 * Passes, shots, clearances, crosses, goal kicks, corners and throws all come
 * through kick(). One solver means one place where flight time, error and
 * ball-tracking behaviour are tuned, and it means a pass and a shot never
 * disagree about how a ball moves.
 *
 * Method:
 *   1. Solve the drag-free ballistic launch for the requested target/loft.
 *      This is a closed form and gets us within ~10-15% at long range.
 *   2. Newton-correct 2-3 times *against the real integrator*: fire the shot,
 *      measure where it actually lands, scale the launch to close the gap.
 *      Correcting against the truth is what keeps the analytic approximation
 *      from mattering.
 *   3. Apply execution error sampled from task difficulty x (skill, pressure).
 *
 * Step 2 is deliberately a scalar correction on pace + a rotation on heading,
 * not a full 3-parameter solve: it converges in three passes and never
 * oscillates, which matters more here than the last few centimetres.
 * ========================================================================== */

import {
  BALL_RADIUS,
  GRAVITY,
  KICK_MAX_LAUNCH,
  KICK_MAX_PACE,
  KICK_MIN_LAUNCH,
  KICK_NEWTON_PASSES,
  PHYSICS_HZ,
} from "./constants";
import { attr01, clamp, lerp, type Vec2, type Vec3 } from "./math";
import { createBall, integrateBall, type BallState } from "./ball";
import type { Rng } from "./rng";

export interface KickRequest {
  /** Where the striker is trying to put it. z > 0 aims at a point in the air
   *  (a cross to a header height, a shot into the top corner). */
  target: Vec3;
  /** 0..1 of the player's maximum strike pace for this technique. */
  pace: number;
  /** 0 = drilled along the deck, 1 = hoofed. Chooses the launch angle. */
  loft: number;
  /** -1..1 sidespin. Sign is the direction of curl in +y. */
  spin: number;
}

export interface KickSkill {
  /** 0..1 how hard this technique is for this player, 1 = trivial. Built by
   *  the caller from the relevant attributes (passing, finishing, crossing…). */
  skill: number;
  /** 0..1 pressure on the striker; compresses accuracy and adds bias. */
  pressure: number;
  /** 0..1 intrinsic difficulty of the attempt (range, angle, first-time…). */
  difficulty: number;
}

export interface KickResult {
  vel: Vec3;
  spin: number;
  /** Predicted flight/roll time to the (errored) target, seconds. */
  travelTime: number;
  /** Metres between the aimed-at point and where it will actually arrive. */
  errorDistance: number;
}

/** Launch angle in radians for a loft request. */
export const launchAngle = (loft: number): number =>
  lerp(KICK_MIN_LAUNCH, KICK_MAX_LAUNCH, clamp(loft, 0, 1));

/**
 * Drag-free launch speed that puts a projectile from `from` through `target`
 * at angle `theta`. Returns null when the shot is geometrically impossible
 * (target too high for the angle), which the caller answers by lofting more.
 */
export function ballisticSpeed(from: Vec3, target: Vec3, theta: number): number | null {
  const dx = Math.hypot(target.x - from.x, target.y - from.y);
  const dz = target.z - from.z;
  if (dx < 1e-6) return null;
  const c = Math.cos(theta);
  const denom = 2 * c * c * (dx * Math.tan(theta) - dz);
  if (denom <= 1e-9) return null;
  const v2 = (GRAVITY * dx * dx) / denom;
  return v2 <= 0 ? null : Math.sqrt(v2);
}

/** Ground pass launch speed to cover `dist` and arrive at `arrivalSpeed`. */
export function rollSpeedFor(dist: number, friction: number, arrivalSpeed = 1.5): number {
  return Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * friction * dist);
}

/** Simulate a launch and report where the ball first reaches the target
 *  plane, so Newton has something true to correct against. */
function simulateLanding(
  from: Vec3,
  vel: Vec3,
  spin: number,
  friction: number,
  targetZ: number,
  maxSeconds = 6,
): { at: Vec2; time: number } {
  const b: BallState = createBall(from);
  b.vel = { ...vel };
  b.spin = spin;
  const dt = 1 / PHYSICS_HZ;
  const steps = Math.ceil(maxSeconds * PHYSICS_HZ);
  let prev: Vec3 = { ...b.pos };
  for (let i = 0; i < steps; i++) {
    integrateBall(b, dt, friction);
    const descending = b.vel.z <= 0;
    const crossedPlane = prev.z > targetZ && b.pos.z <= targetZ;
    if (descending && crossedPlane) {
      const span = prev.z - b.pos.z;
      const t = span > 1e-9 ? (prev.z - targetZ) / span : 0;
      return {
        at: { x: lerp(prev.x, b.pos.x, t), y: lerp(prev.y, b.pos.y, t) },
        time: (i + t) * dt,
      };
    }
    // A grounded, near-stopped ball has arrived wherever it is.
    if (b.pos.z <= BALL_RADIUS && Math.hypot(b.vel.x, b.vel.y) < 0.2) {
      return { at: { x: b.pos.x, y: b.pos.y }, time: (i + 1) * dt };
    }
    prev = { ...b.pos };
  }
  return { at: { x: b.pos.x, y: b.pos.y }, time: maxSeconds };
}

/**
 * Solve a kick. `maxPace` is the player's strike ceiling in m/s (built from
 * strength/technique by the caller); `rng` may be omitted for a perfect,
 * error-free strike, which is what the calibration harness and tests use.
 */
export function solveKick(
  from: Vec3,
  req: KickRequest,
  opts: {
    friction: number;
    maxPace?: number;
    skill?: KickSkill;
    rng?: Rng;
  },
): KickResult {
  const friction = opts.friction;
  const maxPace = opts.maxPace ?? KICK_MAX_PACE;

  const aim = opts.skill && opts.rng ? applyError(from, req, opts.skill, opts.rng) : req.target;

  const flat = req.loft <= 0.02 && aim.z <= BALL_RADIUS * 2;
  const dist = Math.hypot(aim.x - from.x, aim.y - from.y);
  const heading = Math.atan2(aim.y - from.y, aim.x - from.x);

  if (flat) {
    // Ground pass: pace 0..1 interpolates between "just gets there" and
    // "drilled", so a tempo instruction has something to move. The analytic
    // roll speed ignores the little skip the ball takes off the boot, so the
    // same Newton correction as the lofted case cleans it up.
    const minSpeed = rollSpeedFor(dist, friction, 0.8);
    let speed = clamp(lerp(minSpeed, Math.max(minSpeed, maxPace), req.pace), 0.5, maxPace);
    let vel: Vec3 = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed, z: 0 };
    if (req.pace < 0.999) {
      for (let pass = 0; pass < KICK_NEWTON_PASSES; pass++) {
        const probe = simulateLanding(from, vel, req.spin, friction, BALL_RADIUS);
        const reached = Math.hypot(probe.at.x - from.x, probe.at.y - from.y);
        if (reached < 0.05) break;
        const ratio = dist / reached;
        if (Math.abs(ratio - 1) < 0.004) break;
        speed = clamp(speed * Math.pow(ratio, 0.5 * DAMPING), 0.5, maxPace);
        vel = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed, z: 0 };
      }
    }
    const landing = simulateLanding(from, vel, req.spin, friction, BALL_RADIUS);
    return {
      vel,
      spin: req.spin,
      travelTime: landing.time,
      errorDistance: Math.hypot(landing.at.x - req.target.x, landing.at.y - req.target.y),
    };
  }

  const theta = launchAngle(Math.max(req.loft, 0.05));
  // Analytic seed, then clamp into what this player can actually hit.
  let speed = ballisticSpeed(from, aim, theta) ?? maxPace;
  speed = clamp(speed * lerp(0.85, 1.15, req.pace), 1, maxPace);

  let landing = { at: { x: from.x, y: from.y }, time: 0 };
  for (let pass = 0; pass < KICK_NEWTON_PASSES; pass++) {
    const vel = velocityFrom(heading, theta, speed);
    landing = simulateLanding(from, vel, req.spin, friction, Math.max(aim.z, BALL_RADIUS));
    const reached = Math.hypot(landing.at.x - from.x, landing.at.y - from.y);
    const wanted = Math.hypot(aim.x - from.x, aim.y - from.y);
    if (reached < 0.05) break;
    const ratio = wanted / reached;
    if (Math.abs(ratio - 1) < 0.004) break;
    // Range scales roughly with v^2 without drag; sqrt is the right step, and
    // damping it keeps drag (which grows with v) from overshooting.
    speed = clamp(speed * Math.pow(ratio, 0.5 * DAMPING), 1, maxPace);
  }

  const vel = velocityFrom(heading, theta, speed);
  const final = simulateLanding(from, vel, req.spin, friction, Math.max(aim.z, BALL_RADIUS));
  return {
    vel,
    spin: req.spin,
    travelTime: final.time,
    errorDistance: Math.hypot(final.at.x - req.target.x, final.at.y - req.target.y),
  };
}

/** Under-relaxation on the Newton step. 0.85 converges in 3 passes without
 *  ringing; 1.0 overshoots at long range where drag is strongest. */
const DAMPING = 0.85;

function velocityFrom(heading: number, theta: number, speed: number): Vec3 {
  const h = Math.cos(theta) * speed;
  return { x: Math.cos(heading) * h, y: Math.sin(heading) * h, z: Math.sin(theta) * speed };
}

/**
 * Execution error. Difficulty sets the size of the miss; skill shrinks it;
 * pressure both widens it and pulls the strike short, because a player being
 * closed down leans back and under-hits.
 */
export function applyError(
  from: Vec3,
  req: KickRequest,
  skill: KickSkill,
  rng: Rng,
): Vec3 {
  const dist = Math.hypot(req.target.x - from.x, req.target.y - from.y);
  const s = clamp(skill.skill, 0, 1);
  const p = clamp(skill.pressure, 0, 1);
  const d = clamp(skill.difficulty, 0, 1);

  // Angular sd in radians: a 20-skill player unpressured on an easy pass is
  // ~0.6°, a poor player under pressure on a hard one is ~9°.
  const sd = (0.012 + 0.14 * d) * (1.25 - 0.85 * s) * (1 + 0.55 * p);
  const dTheta = rng.clampedNormal(0, sd);
  // Weight error: under-hitting is more common than over-hitting.
  const paceBias = 1 + rng.clampedNormal(-0.02 * p, 0.06 + 0.1 * d * (1 - s));

  const heading = Math.atan2(req.target.y - from.y, req.target.x - from.x) + dTheta;
  const reach = dist * paceBias;
  return {
    x: from.x + Math.cos(heading) * reach,
    y: from.y + Math.sin(heading) * reach,
    z: Math.max(0, req.target.z * paceBias),
  };
}

/** Skill helper: turn an attribute (1..20) plus context into a KickSkill. */
export function kickSkill(
  attribute: number,
  pressure: number,
  difficulty: number,
): KickSkill {
  return {
    skill: attr01(attribute),
    pressure: clamp(pressure, 0, 1),
    difficulty: clamp(difficulty, 0, 1),
  };
}

/**
 * The launch angle that puts a ball travelling at `speed` through `target`,
 * taking the flatter of the two solutions — the one a footballer would strike.
 * Returns null when the target is out of range at that speed.
 *
 * Guessing an angle and then asking for the speed (the other way round) is the
 * wrong way to solve a shot: the pace of a strike is a property of the striker,
 * and a shot into the top corner from fifteen metres at three degrees needs
 * fifty metres a second, which nobody has. Clamped to the pace ceiling, such a
 * shot simply falls short of the goal — which is exactly what the engine's
 * "goal" outcomes were doing before this existed.
 */
export function launchAngleFor(from: Vec3, target: Vec3, speed: number): number | null {
  const dx = Math.hypot(target.x - from.x, target.y - from.y);
  const dz = target.z - from.z;
  if (dx < 1e-6) return null;
  const v2 = speed * speed;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * dx * dx + 2 * dz * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * dx));
}

/**
 * Velocity for a ball struck AT a point rather than ONTO it.
 *
 * solveKick lands the ball on its target — right for a pass, a cross or a
 * clearance, and wrong for a shot, which passes through the goal mouth on the
 * way to the net. Asking the lander to solve a shot makes it scale the pace
 * down until the ball drops onto the goal line, which is how a struck effort
 * ends up trickling out at two metres a second.
 *
 * The drag margin is a flat uplift rather than a solve: over the fifteen-odd
 * metres a shot travels, quadratic drag costs a few per cent of pace, and the
 * outcome has already been decided by the model anyway.
 */
export function strikeVelocity(from: Vec3, target: Vec3, pace: number): Vec3 {
  const dragMargin = 1.08;
  const speed = pace * dragMargin;
  const heading = Math.atan2(target.y - from.y, target.x - from.x);
  const theta = launchAngleFor(from, target, speed) ?? 0.08;
  const horizontal = Math.cos(theta) * speed;
  return {
    x: Math.cos(heading) * horizontal,
    y: Math.sin(heading) * horizontal,
    z: Math.sin(theta) * speed,
  };
}

/** The slowest strike that can reach `target` at all, ignoring drag. */
export function minimumSpeedFor(from: Vec3, target: Vec3): number {
  const dx = Math.hypot(target.x - from.x, target.y - from.y);
  const dz = target.z - from.z;
  return Math.sqrt(GRAVITY * (dz + Math.hypot(dx, dz)));
}
