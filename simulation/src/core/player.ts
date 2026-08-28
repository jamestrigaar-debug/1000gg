/* ============================================================================
 * PLAYER — runtime entity and steering.
 *
 * Players are steered, not simulated: arrive/pursue/separation produce a
 * desired velocity, which is then clipped by what the player's body can
 * actually do this tick (acceleration ceiling, agility-limited turn rate,
 * carry penalty, fatigue). No physics engine, no collision resolution — two
 * players may briefly overlap and the separation term pushes them apart, which
 * is what FM's dots do and what keeps 22 entities cheap at 120 Hz.
 * ========================================================================== */

import {
  ACCEL_BASE,
  ACCEL_PER_ACCELERATION,
  ARRIVE_SLOW_RADIUS,
  ARRIVE_STOP_RADIUS,
  BRAKE_FACTOR,
  HEADING_HOLD_SPEED,
  TURN_EASE_AT_REST,
  TURN_FREE_BELOW,
  CARRY_SPEED_MAX,
  CARRY_SPEED_MIN,
  FATIGUE_SPEED_LOSS_MAX,
  FATIGUE_SPEED_LOSS_MIN,
  SEPARATION_RADIUS,
  SEPARATION_WEIGHT,
  SPEED_BASE,
  SPEED_PER_PACE,
  STAMINA_DRAIN_PER_SECOND,
  TURN_BASE,
  TURN_PER_AGILITY,
} from "./constants";
import { attr01, clamp, lerp, rotateTowards, sub, truncate, type Vec2 } from "./math";
import { SIM_MAX_X, SIM_MAX_Y, SIM_MIN_X, SIM_MIN_Y } from "./pitch";
import type { PlayerDef, TeamSide } from "./types";

/** Thin per-player FSM state. The brain picks it; movement reads it. */
export type PlayerState =
  | "HoldShape"
  | "Press"
  | "TrackRunner"
  | "Support"
  | "RunBehind"
  | "ChaseBall"
  | "Dribble"
  | "Contest"
  | "TendGoal"
  | "Distribute"
  | "Recover";

export interface Player {
  readonly def: PlayerDef;
  readonly side: TeamSide;
  /** Index in the starting XI / formation slot this player currently fills. */
  slot: number;
  readonly isKeeper: boolean;

  pos: Vec2;
  vel: Vec2;
  /** Facing, radians. Turn rate is capped by agility, so a player cannot
   *  reverse instantly — this is where "balance" and "agility" are felt. */
  heading: number;

  state: PlayerState;
  /** Where the steering is currently trying to get to. */
  target: Vec2;
  /** Tick on which this player's brain next runs (staggered at kick-off). */
  nextBrainTick: number;

  /** 1 = fresh, 0 = spent. Drains with work rate and distance covered. */
  stamina: number;
  /** Booking state, carried for the card persistence model. */
  yellowCards: number;
  sentOff: boolean;
  onPitch: boolean;

  /* Cached derived ceilings, recomputed when stamina changes materially. */
  vMax: number;
  aMax: number;
  turnRate: number;

  /* Desired velocity from the last steering update (40 Hz); the body chases
   *  it every physics tick. */
  steerX: number;
  steerY: number;

  /* Attribute-derived constants, computed once. They are read on the hottest
   *  path in the engine — 22 players, 120 times a second — and normalising a
   *  1-20 attribute there was measurably a chunk of a whole match. */
  readonly staminaWilling: number;
  readonly staminaCapacity: number;
  readonly carryFactor: number;
}

export function createPlayer(def: PlayerDef, side: TeamSide, slot: number, pos: Vec2): Player {
  const p: Player = {
    def,
    side,
    slot,
    isKeeper: def.position === "GK",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    heading: side === 0 ? 0 : Math.PI,
    state: "HoldShape",
    target: { ...pos },
    nextBrainTick: 0,
    stamina: 1,
    yellowCards: 0,
    sentOff: false,
    onPitch: true,
    vMax: 0,
    aMax: 0,
    turnRate: 0,
    steerX: 0,
    steerY: 0,
    staminaWilling: lerp(0.75, 1.25, attr01(def.attributes.workRate)),
    staminaCapacity: lerp(1.35, 0.65, attr01(def.attributes.stamina)),
    carryFactor: lerp(CARRY_SPEED_MIN, CARRY_SPEED_MAX, attr01(def.attributes.dribbling)),
  };
  refreshCeilings(p);
  return p;
}

/** Physical ceilings from attributes and current stamina. */
export function refreshCeilings(p: Player): void {
  const a = p.def.attributes;
  const fatigueLoss = lerp(
    FATIGUE_SPEED_LOSS_MAX,
    FATIGUE_SPEED_LOSS_MIN,
    clamp(p.stamina, 0, 1),
  );
  p.vMax = (SPEED_BASE + SPEED_PER_PACE * a.pace) * (1 - fatigueLoss);
  p.aMax = ACCEL_BASE + ACCEL_PER_ACCELERATION * a.acceleration;
  // Documented formula: rad/s = base + perAttr * agility, nudged by balance,
  // then eased down as the player tires (a spent player turns like a bus).
  p.turnRate =
    (TURN_BASE + TURN_PER_AGILITY * a.agility) *
    lerp(0.9, 1.05, attr01(a.balance)) *
    lerp(0.85, 1, clamp(p.stamina, 0, 1));
}

/* --- Steering behaviours ------------------------------------------------- */

/** Arrive: full pelt until ARRIVE_SLOW_RADIUS, then ease in so players settle
 *  onto an anchor rather than jittering across it. */
export function arrive(p: Player, target: Vec2, maxSpeed: number): Vec2 {
  const to = sub(target, p.pos);
  const d = Math.hypot(to.x, to.y);
  if (d < ARRIVE_STOP_RADIUS) return { x: 0, y: 0 };
  const speed = d < ARRIVE_SLOW_RADIUS ? maxSpeed * (d / ARRIVE_SLOW_RADIUS) : maxSpeed;
  const dir = { x: to.x / d, y: to.y / d };
  return { x: dir.x * speed, y: dir.y * speed };
}

/** Separation: push out of neighbours' personal space, weighted by closeness. */
export function separation(p: Player, neighbours: readonly Player[]): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const n of neighbours) {
    if (n === p || !n.onPitch) continue;
    const dx = p.pos.x - n.pos.x;
    const dy = p.pos.y - n.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > SEPARATION_RADIUS || d < 1e-4) continue;
    const push = (SEPARATION_RADIUS - d) / SEPARATION_RADIUS;
    sx += (dx / d) * push;
    sy += (dy / d) * push;
  }
  return { x: sx * SEPARATION_WEIGHT, y: sy * SEPARATION_WEIGHT };
}

/** Stamina drain scales with the cube-ish of effort, so sprinting is what
 *  actually costs; work rate makes a player spend more of it, willingly. */
function drainStamina(p: Player, speed: number, dt: number): void {
  const effort = clamp(speed / Math.max(p.vMax, 0.1), 0, 1);
  // Cubed effort: jogging is nearly free, sprinting is what actually costs.
  const load = 0.25 + effort * effort * effort * 2.4;
  const drain = STAMINA_DRAIN_PER_SECOND * load * p.staminaWilling * p.staminaCapacity;
  p.stamina = clamp(p.stamina - drain * dt, 0, 1);
}

/** Steering convenience: desired velocity towards a target with separation. */
export function seekWithSeparation(
  p: Player,
  target: Vec2,
  neighbours: readonly Player[],
  maxSpeed: number,
): Vec2 {
  const a = arrive(p, target, maxSpeed);
  const s = separation(p, neighbours);
  const combined = { x: a.x + s.x * maxSpeed * 0.5, y: a.y + s.y * maxSpeed * 0.5 };
  return truncate(combined, maxSpeed);
}

/**
 * Steering half of the hot path: arrive + separation, fused and allocation
 * free, writing the desired velocity onto the player. Same maths as
 * `seekWithSeparation`, which the tests hold it to; this version exists
 * because it runs 22 times per steering update for 90 minutes of match, and
 * at that volume the intermediate vectors were most of the cost.
 *
 * Runs at STEER_HZ, not the physics rate — see the constant.
 */
export function steerPlayer(
  p: Player,
  targetX: number,
  targetY: number,
  neighbours: readonly Player[],
  maxSpeed: number,
): void {
  // --- arrive ---
  let dx = targetX - p.pos.x;
  let dy = targetY - p.pos.y;
  const d = Math.hypot(dx, dy);
  let wx = 0;
  let wy = 0;
  if (d >= ARRIVE_STOP_RADIUS) {
    const speed = d < ARRIVE_SLOW_RADIUS ? maxSpeed * (d / ARRIVE_SLOW_RADIUS) : maxSpeed;
    wx = (dx / d) * speed;
    wy = (dy / d) * speed;
  }

  // --- separation, weighted into the desired velocity as before ---
  let sx = 0;
  let sy = 0;
  for (const n of neighbours) {
    if (n === p || !n.onPitch) continue;
    dx = p.pos.x - n.pos.x;
    dy = p.pos.y - n.pos.y;
    const nd = Math.hypot(dx, dy);
    if (nd > SEPARATION_RADIUS || nd < 1e-4) continue;
    const push = (SEPARATION_RADIUS - nd) / SEPARATION_RADIUS;
    sx += (dx / nd) * push;
    sy += (dy / nd) * push;
  }
  wx += sx * SEPARATION_WEIGHT * maxSpeed * 0.5;
  wy += sy * SEPARATION_WEIGHT * maxSpeed * 0.5;

  // --- truncate to the speed ceiling ---
  const wantSpeed = Math.hypot(wx, wy);
  if (wantSpeed > maxSpeed && wantSpeed > 1e-9) {
    const k = maxSpeed / wantSpeed;
    wx *= k;
    wy *= k;
  }
  p.steerX = wx;
  p.steerY = wy;
}

/**
 * How far a player may swing his direction of travel this tick.
 *
 * Two terms, and the second one is the point. The first is the ordinary turn
 * rate, eased upwards the slower he is going — you can turn more sharply at a
 * jog than at a sprint. The second RELAXES the limit smoothly to nothing as
 * he approaches a standstill, because a player who is not running is not
 * constrained by momentum he does not have: he can simply set off whichever
 * way he likes.
 *
 * It matters that this is smooth rather than a threshold. The old integrator
 * had a hard one — under 0.3 m/s the heading snapped instantly — and a side
 * holding its shape sits in that band almost permanently, so the smallest
 * nudge to a target span a player on the spot. Any hard cutoff reintroduces
 * that twitch at whatever speed you put it; a ramp has no edge to sit on.
 */
function turnStep(p: Player, speed: number, dt: number): number {
  const ease = 1 + TURN_EASE_AT_REST * clamp(1 - speed / Math.max(p.vMax, 0.1), 0, 1);
  const running = p.turnRate * ease * dt;
  const atRest = clamp(1 - speed / TURN_FREE_BELOW, 0, 1) * Math.PI;
  return running + atRest;
}

/**
 * Body half of the hot path, run every physics tick.
 *
 * WHY THIS IS A VECTOR AND NOT AN ANGLE PLUS A SPEED
 *
 * It used to work like a tank: pick a heading, turn towards it, then set the
 * velocity to `speed * (cos heading, sin heading)`. Two things fall out of
 * that, and both of them are visible.
 *
 *   - Travel is ALWAYS exactly along the facing, so a player has no momentum
 *     through a turn. The drawn path has a hard corner at every heading
 *     change rather than an arc, and a defender who wants to move sideways
 *     has to rotate his whole body first.
 *   - The heading SNAPPED to the desired direction whenever speed dropped
 *     below 0.3 m/s. A player easing onto his position crosses that threshold
 *     constantly, so the smallest change of target spun him on the spot. With
 *     twenty-two of them doing it, that twitch is most of what "janky" meant.
 *
 * So instead: a steering force, capped by what the legs can do, is added to
 * the velocity VECTOR — Reynolds' vehicle model. The turn-rate limit is then
 * applied to the direction of travel, which is where a real constraint lives:
 * you may turn freely from a standstill, less and less the faster you are
 * going, and at a sprint you must arc. Facing follows travel, and is simply
 * held when a player is too slow for his velocity to have a direction worth
 * reading.
 */
export function integratePlayer(p: Player, maxSpeed: number, dt: number): void {
  const wx = p.steerX;
  const wy = p.steerY;
  const wantSq = wx * wx + wy * wy;
  const curSq = p.vel.x * p.vel.x + p.vel.y * p.vel.y;
  // A player standing on his anchor with nowhere to go is most of the pitch
  // most of the time; there is nothing to integrate for him.
  if (wantSq < 1e-6 && curSq < 1e-6) {
    drainStamina(p, 0, dt);
    return;
  }

  const curSpeed = Math.sqrt(curSq);
  const wantSpeed = Math.min(Math.sqrt(wantSq), maxSpeed);

  /* DIRECTION and SPEED are limited separately, and that separation is the
   * whole design.
   *
   * Turning is rate-limited, so the direction of travel sweeps round rather
   * than snapping: that is what removes the twitch and what draws an arc
   * instead of a corner. But turning does NOT eat the acceleration budget.
   * A footballer changing direction plants a foot and pushes off it; he is
   * not a puck being nudged sideways. Charging the turn to the same budget as
   * the acceleration - which is what a naive steering-force integrator does -
   * quietly halves everybody's agility, and a defence that cannot change
   * direction concedes. Measured, on the balance harness: it doubled the
   * shots in a match and took goals from 2.4 to 4.2.
   */
  let heading = curSpeed > TURN_FREE_BELOW ? Math.atan2(p.vel.y, p.vel.x) : p.heading;
  if (wantSpeed > 1e-4) {
    heading = rotateTowards(heading, Math.atan2(wy, wx), turnStep(p, curSpeed, dt));
  }

  const dv = clamp(wantSpeed - curSpeed, -p.aMax * dt * BRAKE_FACTOR, p.aMax * dt);
  const speed = clamp(curSpeed + dv, 0, maxSpeed);

  p.vel.x = Math.cos(heading) * speed;
  p.vel.y = Math.sin(heading) * speed;
  // Facing follows travel, and is left alone when there is no travel to read.
  if (speed > HEADING_HOLD_SPEED) p.heading = heading;

  p.pos.x = clamp(p.pos.x + p.vel.x * dt, SIM_MIN_X, SIM_MAX_X);
  p.pos.y = clamp(p.pos.y + p.vel.y * dt, SIM_MIN_Y, SIM_MAX_Y);

  drainStamina(p, speed, dt);
}
