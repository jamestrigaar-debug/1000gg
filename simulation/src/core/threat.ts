/* ============================================================================
 * THREAT — the zone value grid the on-ball decision runs on (xT-style).
 *
 * Every option a player weighs has to be priced in the same currency, and that
 * currency is "how likely is this possession to end in a goal". A shot prices
 * itself: it is its xG. A pass or a carry needs the value of the PLACE it puts
 * the ball, which is what this is.
 *
 * The shape is taken from published expected-threat grids: value is nearly
 * flat across a team's own half, climbs steeply through the final third, and
 * is worth roughly twice as much in the middle as it is by the touchline. The
 * quartic in progress is what produces that curve with one number.
 *
 * Without this the engine has no reason to prefer a forward pass to a square
 * one — every safe ball scores the same — and both sides pass along their own
 * back four for ninety minutes.
 * ========================================================================== */

import { PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import { clamp, type Vec2 } from "./math";
import type { Direction } from "./pitch";

/** Value of simply having the ball somewhere, before position is considered. */
export const BASE_THREAT = 0.004;
/** Value at the most dangerous point of the grid, before the shot term. */
export const PEAK_THREAT = 0.16;

/** How far up the pitch a point is for a team attacking in `dir`: 0 own goal
 *  line, 1 opponent goal line. */
export function progress(at: Vec2, dir: Direction): number {
  const x = dir === 1 ? at.x : PITCH_LENGTH - at.x;
  return clamp(x / PITCH_LENGTH, 0, 1);
}

/** 1 in the middle of the pitch, 0 on the touchline. */
export function centrality(at: Vec2): number {
  return clamp(1 - Math.abs(at.y - PITCH_WIDTH / 2) / (PITCH_WIDTH / 2), 0, 1);
}

/**
 * Expected threat of having the ball at `at`. Deliberately independent of who
 * is standing where: this is the value of the ZONE, and the option scorer
 * multiplies it by whether the ball will actually arrive.
 */
export function zoneThreat(at: Vec2, dir: Direction): number {
  const p = progress(at, dir);
  const c = centrality(at);
  return BASE_THREAT + PEAK_THREAT * Math.pow(p, 4) * (0.5 + 0.5 * c);
}
