/* ============================================================================
 * MATH — small, allocation-light vector helpers.
 *
 * Vectors are plain objects, not a class: they go into snapshots, get
 * structured-cloned across the worker boundary, and JSON-round-trip in
 * replays. Mutating helpers (*Into) exist for the hot per-tick paths.
 * ========================================================================== */

import { ATTR_MAX, ATTR_MIN } from "./constants";

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 extends Vec2 {
  z: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Vector length, the fast way.
 *
 * Math.hypot is the correct general answer: it rescales its arguments so an
 * intermediate square cannot overflow or underflow. That care is not free —
 * measured on this runtime it is 4.3x slower than the naive form — and it buys
 * us nothing, because every magnitude in this engine is a pitch coordinate or
 * a velocity. The largest number that can reach here is about 120; squaring it
 * is nowhere near the edge of a double.
 *
 * It is called several million times per simulated match, from the steering
 * and integration loops that the profiler puts at a third of all engine time,
 * so this is worth having as its own function rather than as a comment.
 */
export const len2 = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const len3 = (x: number, y: number, z: number): number =>
  Math.sqrt(x * x + y * y + z * z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const dist = (a: Vec2, b: Vec2): number => len2(a.x - b.x, a.y - b.y);
export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function normalise(a: Vec2): Vec2 {
  const l = len2(a.x, a.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Clamp a vector's magnitude, keeping direction. */
export function truncate(a: Vec2, max: number): Vec2 {
  const l = len2(a.x, a.y);
  if (l <= max || l < 1e-9) return { x: a.x, y: a.y };
  const s = max / l;
  return { x: a.x * s, y: a.y * s };
}

/** Signed shortest angle from a to b, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate `from` towards `to` by at most maxStep radians. */
export function rotateTowards(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  return from + clamp(d, -maxStep, maxStep);
}

/** Closest point on segment ab to p, and the distance to it. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-12) return { x: a.x, y: a.y };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const c = closestPointOnSegment(p, a, b);
  return len2(p.x - c.x, p.y - c.y);
}

/* --- Attribute helpers --------------------------------------------------- */

/** FM attribute (1..20) -> 0..1. Every mechanic that reads an attribute goes
 *  through here so the scale is changed in exactly one place. */
export const attr01 = (v: number): number =>
  clamp((v - ATTR_MIN) / (ATTR_MAX - ATTR_MIN), 0, 1);

/** Logistic. Used by the shot model, the save model and every duel. */
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
