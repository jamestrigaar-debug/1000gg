/* ============================================================================
 * PITCH — geometry, zones and line-crossing.
 *
 * Coordinate system: origin at the top-left corner of the field of play,
 * +x runs towards the right-hand goal, +y runs down the screen. Metres.
 * Teams swap ends at half time, so "attacking direction" is a team property,
 * never baked into geometry.
 *
 *   (0,0) ---------------- (105,0)
 *     |                       |
 *     |                       |
 *   (0,68) --------------- (105,68)
 * ========================================================================== */

import {
  APRON,
  CENTRE_CIRCLE_RADIUS,
  GOAL_WIDTH,
  PEN_AREA_DEPTH,
  PEN_AREA_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_LENGTH,
  PITCH_WIDTH,
  SIX_YARD_DEPTH,
  SIX_YARD_WIDTH,
} from "./constants";
import { clamp, type Vec2, len2 } from "./math";

/** Which goal a team attacks. LeftToRight attacks x = PITCH_LENGTH. */
export type Direction = 1 | -1;

export const CENTRE: Vec2 = { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };
export const CENTRE_CIRCLE_R = CENTRE_CIRCLE_RADIUS;

/** Simulated bounds including the out-of-play apron. */
export const SIM_MIN_X = -APRON;
export const SIM_MAX_X = PITCH_LENGTH + APRON;
export const SIM_MIN_Y = -APRON;
export const SIM_MAX_Y = PITCH_WIDTH + APRON;

/** x of the goal line a team attacking in `dir` is shooting at. */
export const goalLineX = (dir: Direction): number => (dir === 1 ? PITCH_LENGTH : 0);
/** Centre of the goal being attacked / defended. */
export const goalCentre = (dir: Direction): Vec2 => ({
  x: goalLineX(dir),
  y: PITCH_WIDTH / 2,
});
export const goalPostY = (): { near: number; far: number } => ({
  near: PITCH_WIDTH / 2 - GOAL_WIDTH / 2,
  far: PITCH_WIDTH / 2 + GOAL_WIDTH / 2,
});

/** Penalty spot for the goal at `dir`'s end. */
export const penaltySpot = (dir: Direction): Vec2 => ({
  x: dir === 1 ? PITCH_LENGTH - PENALTY_SPOT_DIST : PENALTY_SPOT_DIST,
  y: PITCH_WIDTH / 2,
});

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Penalty area in front of the goal at `dir`'s end. */
export function penaltyArea(dir: Direction): Box {
  const gx = goalLineX(dir);
  return {
    minX: dir === 1 ? gx - PEN_AREA_DEPTH : gx,
    maxX: dir === 1 ? gx : gx + PEN_AREA_DEPTH,
    minY: PITCH_WIDTH / 2 - PEN_AREA_WIDTH / 2,
    maxY: PITCH_WIDTH / 2 + PEN_AREA_WIDTH / 2,
  };
}

export function sixYardBox(dir: Direction): Box {
  const gx = goalLineX(dir);
  return {
    minX: dir === 1 ? gx - SIX_YARD_DEPTH : gx,
    maxX: dir === 1 ? gx : gx + SIX_YARD_DEPTH,
    minY: PITCH_WIDTH / 2 - SIX_YARD_WIDTH / 2,
    maxY: PITCH_WIDTH / 2 + SIX_YARD_WIDTH / 2,
  };
}

export const inBox = (p: Vec2, b: Box): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Is p inside the field of play (touchlines and goal lines inclusive)? */
export const inPlayArea = (p: Vec2): boolean =>
  p.x >= 0 && p.x <= PITCH_LENGTH && p.y >= 0 && p.y <= PITCH_WIDTH;

/** Clamp a point into the field of play — used for anchors, never for the ball. */
export const clampToPitch = (p: Vec2): Vec2 => ({
  x: clamp(p.x, 0, PITCH_LENGTH),
  y: clamp(p.y, 0, PITCH_WIDTH),
});

/** Clamp into the simulated area including the apron — used for players. */
export const clampToSim = (p: Vec2): Vec2 => ({
  x: clamp(p.x, SIM_MIN_X, SIM_MAX_X),
  y: clamp(p.y, SIM_MIN_Y, SIM_MAX_Y),
});

/** Straight-line distance to the centre of the goal at `dir`'s end. */
export const distanceToGoal = (p: Vec2, dir: Direction): number => {
  const g = goalCentre(dir);
  return len2(p.x - g.x, p.y - g.y);
};

/** Radians of goal visible from p, ignoring bodies. The angle term of the xG
 *  model: 0 on the goal line outside the posts, ~pi from a yard out centrally. */
export function goalAngle(p: Vec2, dir: Direction): number {
  const gx = goalLineX(dir);
  const { near, far } = goalPostY();
  const a = Math.atan2(near - p.y, gx - p.x);
  const b = Math.atan2(far - p.y, gx - p.x);
  return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
}

/** Which line, if any, the segment a->b crosses, and where.
 *  Returned in travel order: the first crossing wins. */
export type LineCross =
  | { line: "goal"; side: Direction; at: Vec2; t: number }
  | { line: "touch"; side: "top" | "bottom"; at: Vec2; t: number }
  | null;

export function crossedLine(a: Vec2, b: Vec2): LineCross {
  const candidates: NonNullable<LineCross>[] = [];

  const axisCross = (
    from: number,
    to: number,
    value: number,
  ): number | null => {
    if (from === to) return null;
    if ((from < value && to >= value) || (from > value && to <= value)) {
      return (value - from) / (to - from);
    }
    return null;
  };

  const at = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  const tLeft = axisCross(a.x, b.x, 0);
  if (tLeft !== null) candidates.push({ line: "goal", side: -1, at: at(tLeft), t: tLeft });
  const tRight = axisCross(a.x, b.x, PITCH_LENGTH);
  if (tRight !== null) candidates.push({ line: "goal", side: 1, at: at(tRight), t: tRight });
  const tTop = axisCross(a.y, b.y, 0);
  if (tTop !== null) candidates.push({ line: "touch", side: "top", at: at(tTop), t: tTop });
  const tBottom = axisCross(a.y, b.y, PITCH_WIDTH);
  if (tBottom !== null)
    candidates.push({ line: "touch", side: "bottom", at: at(tBottom), t: tBottom });

  if (candidates.length === 0) return null;
  let best = candidates[0] as NonNullable<LineCross>;
  for (const c of candidates) if (c.t < best.t) best = c;
  return best;
}

/** Nearest corner arc to a point — where a corner is taken from. */
export function nearestCorner(p: Vec2, attackingDir: Direction): Vec2 {
  return {
    x: goalLineX(attackingDir),
    y: p.y < PITCH_WIDTH / 2 ? 0 : PITCH_WIDTH,
  };
}
