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
import {
  attr01,
  clamp,
  lerp,
  rotateTowards,
  sub,
  truncate,
  type Vec2,
} from "./math";
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
  if (d < 0.05) return { x: 0, y: 0 };
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
  if (d >= 0.05) {
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
 * Body half of the hot path, run every physics tick: turn towards the desired
 * velocity as fast as agility allows, accelerate towards its magnitude, move,
 * and pay the stamina.
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
  const wantSpeed = Math.min(Math.sqrt(wantSq), maxSpeed);
  const curSpeed = Math.sqrt(curSq);
  if (wantSpeed > 1e-4) {
    const wantHeading = Math.atan2(wy, wx);
    p.heading =
      curSpeed < 0.3 ? wantHeading : rotateTowards(p.heading, wantHeading, p.turnRate * dt);
  }
  const dv = clamp(wantSpeed - curSpeed, -p.aMax * dt * 1.6, p.aMax * dt);
  const newSpeed = clamp(curSpeed + dv, 0, maxSpeed);
  p.vel.x = Math.cos(p.heading) * newSpeed;
  p.vel.y = Math.sin(p.heading) * newSpeed;

  p.pos.x = clamp(p.pos.x + p.vel.x * dt, SIM_MIN_X, SIM_MAX_X);
  p.pos.y = clamp(p.pos.y + p.vel.y * dt, SIM_MIN_Y, SIM_MAX_Y);

  drainStamina(p, newSpeed, dt);
}

