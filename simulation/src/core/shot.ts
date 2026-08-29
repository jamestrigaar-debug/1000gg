/* ============================================================================
 * SHOTS — xG is the oracle.
 *
 * A shot is not resolved by flying a ball at a goalkeeper and hoping the
 * physics produces football. It is resolved by a model, and the ball is then
 * sent where the model's answer says it went. That inversion is what makes the
 * engine tunable: conversion rates are a property of the logistic below and of
 * nothing else, so a balance run that says "too many goals from 25 yards"
 * points at one coefficient rather than at an emergent tangle.
 *
 *   xG    chance the shot is scored, before the keeper is considered
 *   PSxG  chance it is scored GIVEN where it ended up going — placement and
 *         pace, i.e. what the keeper is actually facing
 *   save  logistic on the keeper's reflexes and handling against PSxG
 *
 * Coefficients are fitted to public shot data rather than invented: roughly
 * 0.35+ conversion inside the six-yard box, under 0.05 beyond 18 metres, 0.76
 * for penalties, and a mean of 0.08-0.13 xG per shot across a match.
 * ========================================================================== */

import { GOAL_HEIGHT, GOAL_WIDTH } from "./constants";
import { attr01, clamp, sigmoid, type Vec2 } from "./math";
import { distanceToGoal, goalAngle, goalLineX, goalPostY, type Direction } from "./pitch";
import type { Rng } from "./rng";

export interface ShotContext {
  from: Vec2;
  dir: Direction;
  header: boolean;
  /** 0..1 how closed down the shooter is. */
  pressure: number;
  /** True if the move began with a turnover and the defence is unset. */
  counter: boolean;
  penalty: boolean;
}

/* Fitted coefficients. β0 is the intercept at zero distance and zero angle;
 * the distance term is the dominant one, as it is in every published model. */
/* Fitted by pinning three points a shot map has to hit — a tap-in from six
 * yards at ~0.45, the edge of the box at ~0.06, and 25 yards at ~0.025 — and
 * solving the linear system for the three coefficients. Re-fit rather than
 * nudged: moving one of these by hand moves the whole curve. */
const B0 = -1.872;
const B_DIST = -0.094; // per metre
const B_ANGLE = 1.865; // per radian of visible goal
const B_HEADER = -0.58;
const B_PRESSURE = -0.72;
const B_COUNTER = 0.42;
/** Penalties are not modelled geometrically; the historical rate is used. */
export const PENALTY_XG = 0.76;

export function expectedGoals(ctx: ShotContext): number {
  if (ctx.penalty) return PENALTY_XG;
  const dist = distanceToGoal(ctx.from, ctx.dir);
  const angle = goalAngle(ctx.from, ctx.dir);
  const z =
    B0 +
    B_DIST * dist +
    B_ANGLE * angle +
    (ctx.header ? B_HEADER : 0) +
    B_PRESSURE * clamp(ctx.pressure, 0, 1) +
    (ctx.counter ? B_COUNTER : 0);
  return clamp(sigmoid(z), 0.003, 0.95);
}

export interface ShotAttempt {
  /** Where in the goal mouth the shooter was aiming, in metres. */
  aimY: number;
  aimZ: number;
  /** Strike pace, m/s. */
  pace: number;
}

export type ShotOutcome =
  | { kind: "goal"; xg: number; psxg: number; aim: { y: number; z: number }; pace: number }
  | {
      kind: "saved";
      xg: number;
      psxg: number;
      aim: { y: number; z: number };
      pace: number;
      held: boolean;
    }
  | { kind: "off"; xg: number; psxg: number; aim: { y: number; z: number }; pace: number }
  | { kind: "post"; xg: number; psxg: number; aim: { y: number; z: number }; pace: number }
  | { kind: "blocked"; xg: number; psxg: number; aim: { y: number; z: number }; pace: number };

export interface ShooterSkill {
  /** finishing, or heading for a header (1..20). */
  finishing: number;
  technique: number;
  composure: number;
  longShots: number;
}

export interface KeeperSkill {
  reflexes: number;
  handling: number;
  positioning: number;
}

/**
 * Resolve a shot end to end.
 *
 * The order matters: accuracy first (does it even hit the target), then
 * placement quality (PSxG), then the keeper. A shot's xG is recorded whatever
 * happens to it, because xG is a property of the chance, not of the outcome —
 * every stat panel downstream depends on that distinction.
 */
export function resolveShot(
  ctx: ShotContext,
  shooter: ShooterSkill,
  keeper: KeeperSkill,
  rng: Rng,
  blockChance = 0,
): ShotOutcome {
  const xg = expectedGoals(ctx);
  const dist = distanceToGoal(ctx.from, ctx.dir);

  const skill = ctx.penalty
    ? attr01(shooter.composure) * 0.5 + attr01(shooter.finishing) * 0.5
    : attr01(dist > 18 ? shooter.longShots : shooter.finishing) * 0.6 +
      attr01(shooter.technique) * 0.25 +
      attr01(shooter.composure) * 0.15;

  // Where he means to put it: the further from goal and the more pressure,
  // the closer to the middle he aims, because the corners stop being worth it.
  const { near, far } = goalPostY();
  const halfWidth = GOAL_WIDTH / 2;
  const ambition = clamp(skill * 1.1 - clamp(ctx.pressure, 0, 1) * 0.45 - dist / 60, 0.05, 0.95);
  const side = rng.chance(0.5) ? -1 : 1;
  const aimY = (near + far) / 2 + side * ambition * halfWidth * 0.82;
  /* A header is aimed low and across the keeper — you cannot place a header
   * into the top corner the way you can place a shot — and it scatters more,
   * because the ball arrives on someone else's terms. */
  const aimZ = ctx.header
    ? clamp(rng.clampedNormal(0.8, 0.65), 0.1, GOAL_HEIGHT * 0.72)
    : ctx.penalty
      ? rng.range(0.15, GOAL_HEIGHT * 0.75)
      : clamp(rng.clampedNormal(GOAL_HEIGHT * 0.35, GOAL_HEIGHT * 0.28), 0.05, GOAL_HEIGHT * 0.95);

  // Execution error, in metres of miss at the goal line.
  /* Shooting error is ANGULAR, not a fixed number of metres: a footballer
   * misses by a few degrees, which is centimetres from six yards and metres
   * from twenty-five. Written as a constant plus a distance term it made a
   * tap-in as wild as a thirty-yarder, and close-range conversion fell through
   * the floor the shot map is pinned to. */
  const spray = ctx.header
    ? (0.8 + dist * 0.48) * (1.4 - skill) * (1 + clamp(ctx.pressure, 0, 1) * 0.6)
    : (0.6 + dist * 0.42) * (1.35 - skill) * (1 + clamp(ctx.pressure, 0, 1) * 0.6);
  const missY = rng.clampedNormal(0, spray);
  /* Vertical error is much smaller than horizontal: a footballer's shots
   * scatter across the goal far more than they scatter up and down it. At the
   * old 0.7 every shot was either along the ground or over the bar. */
  /* A header's error is mostly sideways: the technique is to direct it down
   * across the keeper, and a coached header that misses tends to miss WIDE
   * rather than sail over. A shot with the feet scatters more evenly. */
  const missZ = rng.clampedNormal(0, spray * (ctx.header ? 0.2 : 0.32));
  const finalY = aimY + missY;
  /* A shot dragged below the bar's zero is not a miss — it is a low drive
   * along the ground, and along the ground is on target. Treating z <= 0 as
   * "off" was the engine's largest single source of phantom goals: the shot
   * was recorded as a miss and the ball then rolled over the line anyway. */
  const finalZ = Math.max(Math.abs(clamp(aimZ + missZ, -1.5, 6)), 0.06);

  if (blockChance > 0 && rng.chance(blockChance)) {
    return { kind: "blocked", xg, psxg: 0, aim: { y: finalY, z: Math.max(finalZ, 0) }, pace: 0 };
  }

  const pace = clamp(
    (ctx.header ? 14 : 22) + attr01(shooter.technique) * 12 - dist * 0.05,
    8,
    36,
  );

  // Woodwork: within a ball's width of a post or the bar.
  const postSlack = 0.35;
  const hitsPost =
    (Math.abs(finalY - near) < postSlack || Math.abs(finalY - far) < postSlack) &&
    finalZ > 0 &&
    finalZ < GOAL_HEIGHT + postSlack;
  const onTarget = finalY > near && finalY < far && finalZ > 0 && finalZ < GOAL_HEIGHT;

  if (hitsPost && !onTarget) {
    return { kind: "post", xg, psxg: 0, aim: { y: finalY, z: Math.max(finalZ, 0) }, pace };
  }
  if (!onTarget) {
    return { kind: "off", xg, psxg: 0, aim: { y: finalY, z: Math.max(finalZ, 0) }, pace };
  }

  const psxg = postShotXG(finalY, finalZ, pace, dist, ctx.header);
  const saved = !rng.chance(saveFailChance(psxg, keeper));
  if (!saved) {
    return { kind: "goal", xg, psxg, aim: { y: finalY, z: finalZ }, pace };
  }
  // Handling decides whether it sticks or spills into a live rebound.
  // Keepers hold roughly two thirds of what they save; the rest is a live
  // rebound. Parrying more than that turns every save into a second chance
  // and the shot count runs away with itself.
  const held = rng.chance(0.55 + attr01(keeper.handling) * 0.35 - psxg * 0.25);
  return { kind: "saved", xg, psxg, aim: { y: finalY, z: finalZ }, pace, held };
}

/**
 * PSxG: how good the finish was, given it was on target. Corners are worth
 * far more than the middle of the goal, pace matters, and a shot from close
 * range is harder to react to whatever else is true of it.
 */
export function postShotXG(
  y: number,
  z: number,
  pace: number,
  dist: number,
  header: boolean,
): number {
  const { near, far } = goalPostY();
  const centreY = (near + far) / 2;
  // 0 in the middle of the goal, 1 tight against a post.
  const cornerY = clamp(Math.abs(y - centreY) / (GOAL_WIDTH / 2), 0, 1);
  // Along the ground and in the top corner are both hard; mid-height is not.
  const heightWork = clamp(Math.abs(z - GOAL_HEIGHT * 0.45) / (GOAL_HEIGHT * 0.55), 0, 1);
  const placement = clamp(cornerY * 0.72 + heightWork * 0.28, 0, 1);
  /* Distance is the dominant term here too, and it enters as a SQUARE ROOT.
   *
   * Linear in distance cannot fit the real curve: the keeper's job gets much
   * harder very quickly as the shooter closes, then flattens out. Fitted
   * against the xG model itself — realised conversion has to match the xG that
   * priced the chance, or the two numbers on the stats panel contradict each
   * other. Before this the engine converted at 1.4-1.6x its own xG through the
   * nine-to-twenty-metre band, which is where most shots are taken. */
  const z0 =
    0.165 +
    2.8 * placement +
    (pace - 20) * 0.045 -
    0.853 * Math.sqrt(Math.max(dist, 0.5)) +
    // Point blank: the keeper has no time at all, and the square root alone
    // does not fall fast enough to say so.
    1.5 * Math.max(0, 1 - dist / 7) +
    (header ? -0.2 : 0);
  return clamp(sigmoid(z0), 0.02, 0.97);
}

/** Probability the keeper fails to keep it out, given PSxG and his ability. */
export function saveFailChance(psxg: number, keeper: KeeperSkill): number {
  const ability = attr01(keeper.reflexes) * 0.62 + attr01(keeper.positioning) * 0.38;
  // A league-average keeper (ability 0.5) sits on the model's own PSxG; a
  // great one takes about a fifth off it, a poor one gives a tenth back.
  const adjusted = psxg * (1.12 - 0.42 * ability);
  return clamp(adjusted, 0.01, 0.98);
}

/** Where in the goal mouth a shot ended up, as a pitch point. */
export function goalMouthPoint(
  dir: Direction,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  return { x: goalLineX(dir), y, z };
}
